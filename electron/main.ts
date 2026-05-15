import {app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, utilityProcess} from 'electron';
import type {UtilityProcess} from 'electron';
import http from 'node:http';
import net from 'node:net';
import {execSync} from 'node:child_process';
import path from 'node:path';

/** `~/Library/Application Support/<此名>`；package.json 的 name 为 react-example，不设则目录会变成 react-example */
app.name = 'Dottie-Assistant';

let mainWindow: BrowserWindow | null = null;
let floatWindow: BrowserWindow | null = null;
let apiChild: UtilityProcess | null = null;
let desktopUiReady = false;

/** 与 `dev:desktop` 一致：由 concurrently 起 Vite + deploy-api，Electron 只连 3000 */
const useViteDevServer = process.env.ELECTRON_IS_DEV === '1';

function spaOrigin(): string {
  return useViteDevServer ? 'http://127.0.0.1:3000' : `http://127.0.0.1:${API_PORT}`;
}

function showOrCreateMainWindow(): void {
  showOrCreateMainWindowWithPath('/');
}

function normalizeMainPath(path: string): string {
  const p = path.trim() || '/';
  return p.startsWith('/') ? p : `/${p}`;
}

/** 打开或聚焦主窗并导航到 SPA 路径（含 query），如 `/deploy?fromFloat=1` */
function showOrCreateMainWindowWithPath(path: string): void {
  const fullPath = normalizeMainPath(path);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    void mainWindow.loadURL(`${spaOrigin()}${fullPath}`);
    return;
  }
  createWindow(fullPath);
}

ipcMain.on('assistant:open-main', () => {
  showOrCreateMainWindow();
});

ipcMain.on('assistant:open-main-path', (_e, payload: unknown) => {
  const path =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as {path?: unknown}).path === 'string'
      ? (payload as {path: string}).path
      : '/';
  showOrCreateMainWindowWithPath(path);
});

ipcMain.on('assistant-float-resize', (_e, payload: unknown) => {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  if (!payload || typeof payload !== 'object') return;
  const rec = payload as {width?: unknown; height?: unknown};
  const w = Math.round(Number(rec.width));
  const h = Math.round(Number(rec.height));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  const minW = 76;
  const minH = 76;
  /** 原先写死 max 520×640，渲染进程传再大也会被截断；改为不超过主屏工作区（留边），与 FloatDock.syncFloatSize 一致 */
  const {workArea} = screen.getPrimaryDisplay();
  const edge = 20;
  const maxW = Math.max(minW, Math.floor(workArea.width - edge));
  const maxH = Math.max(minH, Math.floor(workArea.height - edge));
  const nw = Math.min(maxW, Math.max(minW, w));
  const nh = Math.min(maxH, Math.max(minH, h));
  const [x, y] = floatWindow.getPosition();
  const [cw, ch] = floatWindow.getSize();
  floatWindow.setSize(nw, nh);
  /** 保持右下角锚定，避免拉高后内容画出屏幕下缘 */
  floatWindow.setPosition(Math.round(x + cw - nw), Math.round(y + ch - nh));
});

ipcMain.on('assistant-float-drag', (_e, payload: unknown) => {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  if (!payload || typeof payload !== 'object') return;
  const rec = payload as {dx?: unknown; dy?: unknown};
  const dx = Number(rec.dx);
  const dy = Number(rec.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  if (dx === 0 && dy === 0) return;
  const [x, y] = floatWindow.getPosition();
  floatWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
});

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
    const assistantDotenvPath = path.join(app.getPath('userData'), '.env');
    const child = utilityProcess.fork(path.resolve(apiScript), [], {
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        SERVE_SPA_ROOT: path.resolve(spaRoot),
        DEPLOY_PROJECT_CONFIG_PATH: path.resolve(configPath),
        DEPLOY_API_PORT: String(API_PORT),
        /** deploy-api 在桌面包内会优先读仓库式 .env，不存在时再读此路径（与项目根 .env 二选一即可） */
        ASSISTANT_DOTENV_PATH: assistantDotenvPath,
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

function createWindow(initialPath = '/'): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showOrCreateMainWindowWithPath(initialPath);
    return;
  }

  const preloadPath = path.join(distElectronRoot(), 'preload.cjs');
  const firstUrl = `${spaOrigin()}${normalizeMainPath(initialPath)}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Dottie-Assistant',
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
    void mainWindow.loadURL(firstUrl);
    mainWindow.webContents.openDevTools({mode: 'detach'});
  } else {
    void mainWindow.loadURL(firstUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const FLOAT_W = 76;
const FLOAT_H = 76;

function floatBottomRight(): {x: number; y: number} {
  const {workArea} = screen.getPrimaryDisplay();
  const margin = 14;
  return {
    x: Math.round(workArea.x + workArea.width - FLOAT_W - margin),
    y: Math.round(workArea.y + workArea.height - FLOAT_H - margin),
  };
}

function createFloatWindow(): void {
  if (floatWindow && !floatWindow.isDestroyed()) {
    if (!floatWindow.isVisible()) {
      floatWindow.show();
    }
    return;
  }

  const preloadPath = path.join(distElectronRoot(), 'preload.cjs');
  const pos = floatBottomRight();

  floatWindow = new BrowserWindow({
    width: FLOAT_W,
    height: FLOAT_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    /** macOS：可叠在全屏应用之上（与 setVisibleOnAllWorkspaces 配合） */
    ...(process.platform === 'darwin' ? {visibleOnFullScreen: true} : {}),
    /** 不设 type:panel：与透明无边框组合时 macOS 上 CSS drag 区域常失效，浮标改由渲染进程 IPC 拖动 */
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  floatWindow.webContents.setWindowOpenHandler(({url}) => {
    void shell.openExternal(url);
    return {action: 'deny'};
  });

  floatWindow.webContents.on('context-menu', () => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    Menu.buildFromTemplate([
      {label: '打开主窗口', click: () => showOrCreateMainWindow()},
      {type: 'separator'},
      {label: '退出', click: () => app.quit()},
    ]).popup({window: floatWindow});
  });

  /** 仅显式 ELECTRON_FLOAT_DEBUG=1 时带调试 query 并开 DevTools；普通 vite 开发不再默认打开，避免误触 F12 */
  const floatQuery = process.env.ELECTRON_FLOAT_DEBUG === '1' ? '?floatDebug=1' : '';
  void floatWindow.loadURL(`${spaOrigin()}/electron-float${floatQuery}`);
  floatWindow.once('ready-to-show', () => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    floatWindow.show();
    if (process.env.ELECTRON_FLOAT_DEBUG === '1') {
      floatWindow.webContents.openDevTools({mode: 'detach'});
    }
    /**
     * 尽量浮在普通应用之上：macOS 用 screen-saver 层级 + 全屏上可见；
     * Windows 亦设 screen-saver（Electron 支持的置顶档）。
     */
    if (process.platform === 'darwin') {
      floatWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
      floatWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    } else {
      floatWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  floatWindow.on('closed', () => {
    floatWindow = null;
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
    void dialog.showErrorBox('Dottie-Assistant', `无法启动或连接后端：\n${msg}`);
    app.quit();
    return;
  }

  createWindow();
  createFloatWindow();
  desktopUiReady = true;
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
  if (!desktopUiReady) return;
  if (!floatWindow || floatWindow.isDestroyed()) {
    createFloatWindow();
  } else if (!floatWindow.isVisible()) {
    floatWindow.show();
  }
  showOrCreateMainWindow();
});

app.on('before-quit', () => {
  if (apiChild) {
    apiChild.kill();
    apiChild = null;
  }
});
