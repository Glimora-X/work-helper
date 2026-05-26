/**
 * 在 Electron 主进程中执行 utilityProcess（deploy-api）委托的 shell 命令。
 * utilityProcess 内 spawn /bin/sh 会 ENOENT，需由主进程代为执行 git/yarn/cursor 等。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import type { UtilityProcess } from 'electron';

type ShellExecRequest = {
  type: 'shell-exec';
  id: string;
  cwd: string;
  command: string;
  detached?: boolean;
  stdio?: 'pipe' | 'ignore';
};

type ShellExecKill = {
  type: 'shell-exec-kill';
  id: string;
  signal?: string;
};

type BridgeMessage = ShellExecRequest | ShellExecKill | { type?: string };

const bridgeChildren = new Map<string, ChildProcess>();

function desktopSpawnEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || os.homedir();
  const pathEnv =
    process.env.PATH ||
    '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return {
    ...process.env,
    HOME: home,
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || '/bin/bash',
    PATH: pathEnv,
    LANG: process.env.LANG || 'en_US.UTF-8',
  };
}

function runShellExec(child: UtilityProcess, msg: ShellExecRequest): void {
  const env = desktopSpawnEnv();
  const shell = env.SHELL || '/bin/bash';
  const detached = msg.detached ?? false;
  const ignoreStdio = msg.stdio === 'ignore';

  const proc = spawn(shell, ['-lc', msg.command], {
    cwd: msg.cwd,
    env,
    shell: false,
    detached,
    stdio: ignoreStdio ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });

  bridgeChildren.set(msg.id, proc);

  if (proc.pid != null) {
    child.postMessage({ type: 'shell-exec-spawned', id: msg.id, pid: proc.pid });
  }

  const emitChunk = (stream: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    child.postMessage({ type: 'shell-exec-chunk', id: msg.id, stream, text });
  };

  proc.stdout?.on('data', (chunk: Buffer) => emitChunk('stdout', chunk.toString()));
  proc.stderr?.on('data', (chunk: Buffer) => emitChunk('stderr', chunk.toString()));

  proc.on('error', (err) => {
    bridgeChildren.delete(msg.id);
    child.postMessage({ type: 'shell-exec-error', id: msg.id, message: err.message });
  });

  proc.on('close', (code) => {
    bridgeChildren.delete(msg.id);
    child.postMessage({ type: 'shell-exec-done', id: msg.id, code: code ?? 1 });
  });

  if (detached) {
    proc.unref();
  }
}

function killShellExec(msg: ShellExecKill): void {
  const proc = bridgeChildren.get(msg.id);
  if (!proc?.pid || proc.killed) return;
  const signal = (msg.signal as NodeJS.Signals) || 'SIGTERM';
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      /* ignore */
    }
  }
  bridgeChildren.delete(msg.id);
}

export function attachDesktopShellProxy(apiUtilityChild: UtilityProcess): void {
  apiUtilityChild.on('message', (raw: BridgeMessage) => {
    if (!raw || typeof raw !== 'object' || !raw.type) return;
    if (raw.type === 'shell-exec') {
      runShellExec(apiUtilityChild, raw as ShellExecRequest);
      return;
    }
    if (raw.type === 'shell-exec-kill') {
      killShellExec(raw as ShellExecKill);
    }
  });
}
