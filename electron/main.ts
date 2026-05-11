import {app, BrowserWindow, dialog, shell, utilityProcess} from 'electron';
import type {UtilityProcess} from 'electron';
import http from 'node:http';
import net from 'node:net';
import {execSync} from 'node:child_process';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let apiChild: UtilityProcess | null = null;

/** 与 `dev:desktop` 一致：由 concurrently 起 Vite + deploy-api，Electron 只连 3000 */
const useViteDevServer = process.env.ELECTRON_IS_DEV === '1';

const API_PORT = Number(process.env.DEPLOY_API_PORT || 8787);

/**
 * 打包后 __dirname 指向 asar 虚拟路径（…/app.asar/dist-electron），
 * 但 spawn 走原生系统调用，不受 Electron 的 asar hook 保护，会因
 * app.asar 是文件而非目录报 ENOTDIR。
 * asarUnpack 已将 dist-electron/** 解压至 app.asar.unpacked/dist-electron，
 * 打包模式下必须用该真实磁盘路径。
 */
function distElectronRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron');
  }
  return path.resolve(__dirname);
}

/** 检查端口是否空闲 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * 若端口被占用，通过 lsof 找到 PID 并 kill，等待端口释放。
 * 最多等 3 秒；若仍不可用则直接继续（api.cjs 自己会打印 EADDRINUSE）。
 */
async function ensurePortFree(port: number): Promise<void> {
  if (await isPortFree(port)) return;
  try {
    const pids = execSync(`lsof -ti TCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {encoding: 'utf8'})
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        /* 进程可能已退出 */
      }
    }
  } catch {
    /* lsof 不可用时忽略 */
  }
  // 最多等 3 秒让端口释放
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isPortFree(port)) return;
  }
}

function waitForHttpOk(host: string, port: number, pathname: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request(
        {host, port, path: pathname, method: 'GET', timeout: 2000},
        (res) => {
          res.resume();
          if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            scheduleRetry(new Error(`HTTP ${res.statusCode}`));
          }
        },
      );
      req.on('error', scheduleRetry);
      req.end();

      function scheduleRetry(err: Error) {
        if (Date.now() >= deadline) {
          reject(err);
          return;
        }
        setTimeout(tryOnce, 350);
      }
    };
    tryOnce();
  });
}

async function startBundledApi(): Promise<void> {
  const root = distElectronRoot();
  const spaRoot = path.join(root, 'dist');
  const apiScript = path.join(root, 'api.cjs');
  const configPath = path.join(process.resourcesPath, 'config', 'deploy-projects.json');

  // 确保端口空闲，避免残留进程导致 EADDRINUSE → exit code=1
  await ensurePortFree(API_PORT);

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderrBuf = '';
    let stdoutBuf = '';

    const tryResolve = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const tryReject = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    // utilityProcess.fork 在打包后无需 RunAsNode fuse，是 Electron 22+ 推荐的子进程方案
    const child = utilityProcess.fork(path.resolve(apiScript), [], {
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        SERVE_SPA_ROOT: path.resolve(spaRoot),
        DEPLOY_PROJECT_CONFIG_PATH: path.resolve(configPath),
        DEPLOY_API_PORT: String(API_PORT),
      },
      cwd: path.resolve(root),
      stdio: 'pipe',
    });
    apiChild = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    child.on('exit', (code) => {
      // 拼出最后 1200 字符的输出供诊断
      const lastOut = (stderrBuf + stdoutBuf).trim().slice(-1200);
      const detail = lastOut ? `\n\n${lastOut}` : '';

      if (code !== 0) {
        // 启动期退出：立即 reject（不再等 45 秒超时）
        tryReject(new Error(`deploy-api 启动失败（code=${code}）${detail}`));
        // 若窗口已存在（启动后崩溃），补弹一个提示
        if (mainWindow && !mainWindow.isDestroyed()) {
          void dialog.showMessageBox(mainWindow, {
            type: 'error',
            message: `deploy-api 意外退出（code=${code}）${detail}`,
          });
        }
      }
      apiChild = null;
    });

    waitForHttpOk('127.0.0.1', API_PORT, '/api/deploy/health', 45_000)
      .then(tryResolve)
      .catch((e: Error) => {
        const lastOut = (stderrBuf + stdoutBuf).trim().slice(-1200);
        tryReject(new Error(`${e.message}${lastOut ? `\n\n${lastOut}` : ''}`));
      });
  });
}

function createWindow(): void {
  const preloadPath = path.join(distElectronRoot(), 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: '助手',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    void shell.openExternal(url);
    return {action: 'deny'};
  });

  if (useViteDevServer) {
    void mainWindow.loadURL('http://127.0.0.1:3000');
    mainWindow.webContents.openDevTools({mode: 'detach'});
  } else {
    void mainWindow.loadURL(`http://127.0.0.1:${API_PORT}/`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function ready(): Promise<void> {
  try {
    if (useViteDevServer) {
      await waitForHttpOk('127.0.0.1', 3000, '/', 60_000);
    } else {
      await startBundledApi();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void dialog.showErrorBox('助手', `无法启动或连接后端：\n${msg}`);
    app.quit();
    return;
  }

  createWindow();
}

void app.whenReady().then(() => {
  void ready();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (apiChild) {
    apiChild.kill();
    apiChild = null;
  }
});
