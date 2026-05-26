/**
 * 桌面包内 deploy-api 运行在 Electron utilityProcess 中，无法直接 spawn /bin/sh（ENOENT）。
 * 通过 process.parentPort 将 shell 命令委托给主进程执行。
 */
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const DEFAULT_PATH_MAC =
  '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

export function childProcessEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = process.env.HOME || os.homedir();
  const pathEnv =
    process.env.PATH ||
    (process.platform === 'darwin' ? DEFAULT_PATH_MAC : '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  return {
    ...process.env,
    HOME: process.env.HOME || home,
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || '/bin/bash',
    PATH: pathEnv,
    LANG: process.env.LANG || 'en_US.UTF-8',
    CI: process.env.CI || 'true',
    ...overrides,
  };
}

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data?: unknown }) => void): void;
};

type BridgeMessage = {
  type?: string;
  id?: string;
  pid?: number;
  stream?: 'stdout' | 'stderr';
  text?: string;
  code?: number | null;
  message?: string;
};

type PendingBridge = {
  resolve: (code: number) => void;
  reject: (err: Error) => void;
  onStdout?: (chunk: Buffer | string) => void;
  onStderr?: (chunk: Buffer | string) => void;
  child: ChildProcess;
};

const pendingBridge = new Map<string, PendingBridge>();
let bridgeListenerReady = false;

function getParentPort(): ParentPort | null {
  const proc = process as NodeJS.Process & { parentPort?: ParentPort };
  return proc.parentPort ?? null;
}

export function canUseDesktopShellBridge(): boolean {
  return getParentPort() != null;
}

function ensureBridgeListener(): boolean {
  const port = getParentPort();
  if (!port) return false;
  if (bridgeListenerReady) return true;
  bridgeListenerReady = true;

  port.on('message', (event) => {
    const msg = (event?.data ?? event) as BridgeMessage;
    if (!msg?.id || !msg.type) return;
    const pending = pendingBridge.get(msg.id);
    if (!pending) return;

    if (msg.type === 'shell-exec-spawned' && typeof msg.pid === 'number') {
      Object.assign(pending.child, { pid: msg.pid });
      return;
    }
    if (msg.type === 'shell-exec-chunk' && msg.text != null) {
      if (msg.stream === 'stderr') pending.onStderr?.(msg.text);
      else pending.onStdout?.(msg.text);
      return;
    }
    if (msg.type === 'shell-exec-error') {
      pendingBridge.delete(msg.id);
      pending.reject(new Error(msg.message || 'shell-exec failed'));
      pending.child.emit('error', new Error(msg.message || 'shell-exec failed'));
      return;
    }
    if (msg.type === 'shell-exec-done') {
      pendingBridge.delete(msg.id);
      const code = msg.code ?? 1;
      pending.resolve(code);
      pending.child.emit('close', code);
    }
  });

  return true;
}

function createBridgeChildStub(id: string): ChildProcess {
  const stub = new EventEmitter() as ChildProcess & {
    pid?: number;
    killed: boolean;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  Object.assign(stub, {
    stdin: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: undefined,
    killed: false,
    kill(signal?: NodeJS.Signals | number) {
      getParentPort()?.postMessage({
        type: 'shell-exec-kill',
        id,
        signal: String(signal ?? 'SIGTERM'),
      });
      stub.killed = true;
      return true;
    },
  });
  return stub;
}

export interface SpawnShellOptions {
  cwd: string;
  command: string;
  detached?: boolean;
  stdio?: 'pipe' | 'ignore';
  env?: NodeJS.ProcessEnv;
}

function spawnShellLocally(options: SpawnShellOptions): ChildProcess {
  const env = childProcessEnv(options.env);
  if (process.platform === 'win32') {
    return spawn(options.command, {
      cwd: options.cwd,
      env,
      shell: true,
      detached: options.detached ?? false,
      stdio: options.stdio === 'ignore' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    });
  }
  const shell = env.SHELL || '/bin/bash';
  return spawn(shell, ['-lc', options.command], {
    cwd: options.cwd,
    env,
    shell: false,
    detached: options.detached ?? false,
    stdio: options.stdio === 'ignore' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });
}

function spawnShellViaBridge(options: SpawnShellOptions): ChildProcess {
  if (!ensureBridgeListener()) {
    throw new Error('desktop shell bridge 未就绪');
  }
  const id = randomUUID();
  const stub = createBridgeChildStub(id);
  const promise = new Promise<number>((resolve, reject) => {
    pendingBridge.set(id, {
      resolve,
      reject,
      child: stub,
      onStdout: (chunk) => stub.stdout?.emit('data', chunk),
      onStderr: (chunk) => stub.stderr?.emit('data', chunk),
    });
  });
  void promise.catch(() => {
    /* runStartupShellStep / attachDevStreamToRun 通过 close/error 处理 */
  });

  getParentPort()!.postMessage({
    type: 'shell-exec',
    id,
    cwd: options.cwd,
    command: options.command,
    detached: options.detached ?? false,
    stdio: options.stdio ?? 'pipe',
  });

  return stub;
}

/** 优先走主进程代理（utilityProcess），否则本进程 bash -lc。 */
export function spawnShellCommand(options: SpawnShellOptions): ChildProcess {
  if (canUseDesktopShellBridge()) {
    return spawnShellViaBridge(options);
  }
  return spawnShellLocally(options);
}
