import express from 'express';
import { config } from 'dotenv';
import { triggerJenkinsJob, pollBuildUntilComplete } from './jenkins-client';
import { resolveIssueToJobPaths } from './jira-resolve';
import {
  buildDeployParameters,
  DeployContractError,
  getJenkinsCredentialsFromEnv,
} from './deploy-contract';
import {
  listDeployProjects,
  loadDeployProjectConfig,
  resolveDeployTargets,
} from './deploy-project-config';
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.DEPLOY_API_PORT || 8787);
const WORKSPACE_ROOT =
  process.env.AUTOMATION_WORKSPACE_ROOT || '/Users/juanwang/Documents/work-space/third';
const APP_SERVICE_PLUS_PATH =
  process.env.APP_SERVICE_PLUS_PATH || path.join(WORKSPACE_ROOT, 'cc-front-biz-app-service-plus');

const AUTOMATION_T1_ENABLED = process.env.AUTOMATION_T1_ENABLED !== 'false';
const AUTOMATION_T1_SCHEDULES = process.env.AUTOMATION_T1_SCHEDULES || '05:00,20:00';
const AUTOMATION_T1_CLI_CWD = process.env.AUTOMATION_T1_CLI_CWD || APP_SERVICE_PLUS_PATH;
const AUTOMATION_T1_CLI_BIN =
  process.env.AUTOMATION_T1_CLI_BIN ||
  '/Users/juanwang/.nvm/versions/node/v22.22.0/bin/biz-quick-upgrade';
const AUTOMATION_T1_CLI_ENTRY = process.env.AUTOMATION_T1_CLI_ENTRY || '';
const AUTOMATION_T1_COMMAND = process.env.AUTOMATION_T1_COMMAND || '';
const AUTOMATION_T1_ENV = process.env.AUTOMATION_T1_ENV || 'test';
const AUTOMATION_T1_EXTRA_ARGS = process.env.AUTOMATION_T1_EXTRA_ARGS || '';

type RunStatus = 'running' | 'waiting_input' | 'completed' | 'failed';
type AutomationTaskId = 't_1';
type RunTrigger = 'manual' | 'scheduled';

interface RunEvent {
  type: 'log' | 'status' | 'waiting' | 'completed' | 'failed' | 'bootstrap_ready' | 'stopped';
  timestamp: string;
  payload: Record<string, unknown>;
}

interface AutomationRun {
  id: string;
  taskId: AutomationTaskId;
  trigger: RunTrigger;
  status: RunStatus;
  events: RunEvent[];
  pendingReason?: string;
  waitingStep?: string;
  waiter?: (solution: string) => void;
}

interface DailySchedule {
  hour: number;
  minute: number;
  label: string;
}

const runs = new Map<string, AutomationRun>();
const activeRunsByTask = new Map<AutomationTaskId, string>();
let taskT1Timer: NodeJS.Timeout | undefined;

// --- Startup Launch ---

interface StartupProjectConfig {
  name: string;
  path: string;
  branch: string;
  installCmd: string;
  runCmd: string;
}

interface StartupRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  events: RunEvent[];
  processes: Map<string, ChildProcess>;
}

const startupRuns = new Map<string, StartupRun>();

function pushStartupLog(
  run: StartupRun,
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' | 'system' = 'info'
) {
  run.events.push({ type: 'log', timestamp: nowTs(), payload: { message, level } });
}

function trackStartupProcess(run: StartupRun, key: string, child: ChildProcess): void {
  run.processes.set(key, child);
  child.once('close', () => {
    run.processes.delete(key);
  });
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    if (!child.pid || child.killed) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 3000).unref();
}

function stopStartupRun(run: StartupRun): number {
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') {
    return 0;
  }
  const children = [...run.processes.values()];
  for (const child of children) {
    terminateProcessTree(child);
  }
  run.status = 'stopped';
  pushStartupLog(run, `[Runner] 已停止当前启动任务，终止 ${children.length} 个子进程。`, 'warn');
  run.events.push({ type: 'stopped', timestamp: nowTs(), payload: { stoppedProcesses: children.length } });
  return children.length;
}

/** 去掉常见 ANSI 转义，便于在网页终端阅读 */
function stripAnsiForWeb(s: string): string {
  return s.replace(/\u001b\[[\d;?]*[A-Za-z]/g, '').replace(/\u001b\]8;;[^\u0007]*\u0007/g, '');
}

/** 终端用 `\r` 在同一行刷新进度；只保留「当前行」可见内容，避免拼成一条巨长日志 */
function scrubDevLine(raw: string): string {
  const noAnsi = stripAnsiForWeb(raw.replace(/\r\n/g, '\n'));
  const afterCr = /\r/.test(noAnsi) ? (noAnsi.split(/\r/).pop() ?? noAnsi) : noAnsi;
  return afterCr.replace(/\u0000/g, '').trimEnd();
}

/** cjet / webpack 多域并行时整屏仪表盘（多段 localhost、building 等），不适合逐条推到网页 */
function isDenseProgressDashboard(line: string): boolean {
  // 单行服务就绪：🔸 default 8080 http://localhost:8080（常打在 stderr，易被误判为 error）
  if (/🔸\s+\S+\s+\d+\s+https?:\/\/localhost:\d+/i.test(line.trim())) return true;
  const hosts = line.match(/localhost:\d+/g);
  if (hosts && hosts.length >= 2) return true;
  if ((line.match(/🔸/g) || []).length >= 2) return true;
  if (line.length > 140 && /(building|sealing|dependencies|entries)\b/i.test(line)) return true;
  return false;
}

function isImportantDevLine(line: string): boolean {
  return /(compiled successfully|compiled with warnings?|error\s*TS|Error:\s| ERROR |failed|✖|✗|listening on|webpack compiled|Build complete)/i.test(
    line
  );
}

/** 仅将「明确像报错」的 stderr 标红；普通 webpack 状态多在 stderr 但不是错误 */
function isStrictDevFailureLine(line: string): boolean {
  return /(error\s*TS\d+|Error:\s| ERROR |✖\s|Cannot find module|\bEACCES\b|\bENOENT\b|^failed\b)/i.test(line);
}

/**
 * 将 dev 命令的 stdout/stderr 逐行推到 startup SSE（无 TTY，不适合依赖 stdin 的交互；可用 Terminal 模式或 yarn dev -a）。
 * Promise 在子进程退出时结束（长期运行的 dev 会长期挂起，属预期）。
 */
function attachDevStreamToRun(
  run: StartupRun,
  cwd: string,
  cmd: string,
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    pushStartupLog(
      run,
      `[${label}] 流式输出: ${cmd}（无 stdin/TTY；需「按领域」交互时请开 openDevInTerminal 或改用非交互参数）`,
      'info'
    );
    const child = spawn(cmd, {
      cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI },
    }) as ChildProcessWithoutNullStreams;

    trackStartupProcess(run, `dev:${label}:${Date.now()}`, child);

    let outBuf = '';
    let errBuf = '';
    let lastStdoutEmitAt = 0;
    let lastDenseHeartbeatAt = 0;

    const pushDevLineFiltered = (line: string, fromStderr: boolean) => {
      if (!line) return;
      const now = Date.now();

      if (isDenseProgressDashboard(line)) {
        if (now - lastDenseHeartbeatAt >= 5000) {
          lastDenseHeartbeatAt = now;
          pushStartupLog(
            run,
            `[${label}|dev] ⏳ 多域并行编译 / 服务状态更新中…（Webpack 常把状态打到 stderr，已按「非错误」折叠，约每 5s 提示；完整实时见 Terminal 或本机 yarn dev）`,
            'info'
          );
        }
        return;
      }

      if (isImportantDevLine(line)) {
        const t = line.length > 8000 ? `${line.slice(0, 8000)}…` : line;
        const looksFailure =
          /(error\s*TS|Error:\s| ERROR |failed|✖|✗)/i.test(line) && !/compiled with warnings/i.test(line);
        const level = looksFailure ? 'error' : 'info';
        pushStartupLog(run, `[${label}|dev] ${t}`, level);
        lastStdoutEmitAt = now;
        return;
      }

      if (fromStderr && isStrictDevFailureLine(line)) {
        const t = line.length > 4000 ? `${line.slice(0, 4000)}…` : line;
        pushStartupLog(run, `[${label}|dev] ${t}`, 'error');
        lastStdoutEmitAt = now;
        return;
      }

      if (now - lastStdoutEmitAt < 1000) return;
      lastStdoutEmitAt = now;
      const t = line.length > 1600 ? `${line.slice(0, 1600)}…` : line;
      pushStartupLog(run, `[${label}|dev] ${t}`, 'info');
    };

    const emitProgressTail = (buf: string, fromStderr: boolean) => {
      if (!buf || buf.includes('\n')) return;
      const line = scrubDevLine(buf);
      if (!line || line.length < 2) return;
      pushDevLineFiltered(line, fromStderr);
    };

    const flush = (chunk: Buffer | string, fromStderr: boolean) => {
      const text = chunk.toString();
      if (fromStderr) errBuf += text;
      else outBuf += text;
      const full = fromStderr ? errBuf : outBuf;
      const parts = full.split('\n');
      const rest = parts.pop() ?? '';
      if (fromStderr) errBuf = rest;
      else outBuf = rest;
      for (const raw of parts) {
        const line = scrubDevLine(raw);
        if (!line) continue;
        pushDevLineFiltered(line, fromStderr);
      }
      emitProgressTail(fromStderr ? errBuf : outBuf, fromStderr);
    };

    child.stdout.on('data', (c) => flush(c, false));
    child.stderr.on('data', (c) => flush(c, true));
    child.on('error', (err) => {
      if (run.status === 'stopped') resolve();
      else reject(err);
    });
    child.on('close', (code) => {
      if (outBuf.trim()) {
        const line = scrubDevLine(outBuf);
        if (line) pushDevLineFiltered(line, false);
      }
      if (errBuf.trim()) {
        const line = scrubDevLine(errBuf);
        if (line) pushDevLineFiltered(line, true);
      }
      pushStartupLog(
        run,
        `[${label}|dev] 进程已退出（exit=${code ?? 'unknown'}）`,
        code === 0 ? 'success' : 'warn'
      );
      resolve();
    });
  });
}

function expandPath(p: string): string {
  return p.replace(/^~(?=$|\/)/, os.homedir());
}

/** Bash 单引号安全包裹（用于生成的 .command 脚本） */
function bashSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 在 macOS Terminal.app 新窗口中执行 dev（真实 TTY，与手动 yarn dev 一致；交互式 CLI 如 cjet 才能正常显示）。
 */
function launchDevInMacTerminal(cwd: string, runCmd: string, logLabel: string): void {
  const scriptPath = path.join(
    os.tmpdir(),
    `startup-${logLabel.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${Date.now()}.command`
  );
  const script = `#!/bin/bash
cd ${bashSingleQuote(cwd)} || exit 1
exec bash -lc ${bashSingleQuote(runCmd)}
`;
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });
  fs.chmodSync(scriptPath, 0o755);
  const opener = spawn('open', [scriptPath], { detached: true, stdio: 'ignore' });
  opener.unref();
}

/** Git 树中依赖相关文件的 rev-parse 结果拼接，用于判断 fetch/checkout/pull 后是否需安装依赖。 */
function depFilesFingerprint(cwd: string): string {
  const refs = [
    'HEAD:package.json',
    'HEAD:yarn.lock',
    'HEAD:package-lock.json',
    'HEAD:pnpm-lock.yaml',
  ];
  return refs
    .map((ref) => {
      const r = spawnSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' });
      return r.status === 0 ? r.stdout.trim() : '';
    })
    .join('\0');
}

function runStartupShellStep(
  run: StartupRun,
  stepName: string,
  cwd: string,
  command: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    pushStartupLog(run, `[${stepName}] $ ${command}`);
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      env: { ...process.env, CI: process.env.CI || 'true' },
    });
    trackStartupProcess(run, `step:${stepName}:${Date.now()}`, child);

    const hardErrorPattern = /(error|exception|failed|cannot|not found|eacces|enoent)/i;
    let buffered = '';
    let lastErrorLine = '';

    const onData = (chunk: Buffer | string, isStderr: boolean) => {
      const text = chunk.toString();
      buffered += text;
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) continue;
        pushStartupLog(run, `[${stepName}] ${line}`, isStderr ? 'error' : 'info');
        if (isStderr) lastErrorLine = line;
      }
    };

    child.stdout.on('data', (c) => onData(c, false));
    child.stderr.on('data', (c) => onData(c, true));
    child.on('error', (err) => {
      if (run.status === 'stopped') resolve();
      else reject(err);
    });
    child.on('close', (code) => {
      if (buffered.trim()) {
        const tail = buffered.trim();
        pushStartupLog(run, `[${stepName}] ${tail}`, hardErrorPattern.test(tail) ? 'error' : 'info');
        if (hardErrorPattern.test(tail)) lastErrorLine = tail;
      }
      if (code === 0 || run.status === 'stopped') {
        resolve();
      } else {
        const detail = lastErrorLine ? `：${lastErrorLine}` : '';
        reject(new Error(`[${stepName}] 执行失败（exit=${code}）${detail}`));
      }
    });
  });
}

async function executeStartupLaunch(
  run: StartupRun,
  ide: string,
  projects: StartupProjectConfig[],
  smartInstall: boolean,
  openDevInTerminal: boolean
): Promise<void> {
  pushStartupLog(run, `[System] Connect to local daemon (localhost:8787)...`, 'system');

  // Step 1: Open IDE (detached, fire-and-forget)
  pushStartupLog(run, `[Daemon] Launching IDE: ${ide} ...`);
  for (const proj of projects) {
    const expandedPath = expandPath(proj.path);
    pushStartupLog(run, `> $ ${ide} ${proj.path}`, 'info');
    const ideChild = spawn(ide, [expandedPath], { shell: true, detached: true, stdio: 'ignore' });
    ideChild.unref();
  }

  // Step 2: Git sync（含可选 fast-forward，便于拉取远端 package.json / lockfile 变更）
  pushStartupLog(run, `[Git] Syncing repositories...`);
  const depFingerprintBeforeSync = new Map<string, string>();
  for (const proj of projects) {
    const expandedPath = expandPath(proj.path);
    depFingerprintBeforeSync.set(expandedPath, depFilesFingerprint(expandedPath));
    await runStartupShellStep(run, proj.name, expandedPath, `git fetch origin ${proj.branch}`);
    await runStartupShellStep(run, proj.name, expandedPath, `git checkout ${proj.branch}`);
    try {
      await runStartupShellStep(
        run,
        `${proj.name}-merge`,
        expandedPath,
        `git merge --ff-only origin/${proj.branch}`
      );
    } catch {
      pushStartupLog(
        run,
        `[${proj.name}] git merge --ff-only origin/${proj.branch} 未执行或失败（本地已是最新或非快进可忽略）`,
        'warn'
      );
    }
    pushStartupLog(run, `[${proj.name}] Branch synchronized.`, 'success');
  }

  // Step 3: Install dependencies（可选：仅在锁文件 / package.json 相对同步前发生变化，或缺少 node_modules 时执行）
  pushStartupLog(run, `[Yarn] Resolving install...`);
  for (const proj of projects) {
    const expandedPath = expandPath(proj.path);
    const installCmd = (proj.installCmd || '').trim();
    if (!installCmd || installCmd === 'none') {
      pushStartupLog(run, `[${proj.name}] 未配置安装命令，跳过`, 'info');
      continue;
    }

    const fingerprintAfter = depFilesFingerprint(expandedPath);
    const fingerprintBefore = depFingerprintBeforeSync.get(expandedPath) ?? '';
    const nodeModules = path.join(expandedPath, 'node_modules');
    const missingNodeModules = !fs.existsSync(nodeModules);
    const depsFilesChanged = fingerprintBefore !== fingerprintAfter;

    const shouldInstall =
      !smartInstall || missingNodeModules || depsFilesChanged || !fingerprintAfter;

    if (smartInstall && !shouldInstall) {
      pushStartupLog(
        run,
        `[${proj.name}] 依赖描述文件相对同步前未变化且已存在 node_modules，跳过：${installCmd}`,
        'success'
      );
      continue;
    }

    if (smartInstall && shouldInstall) {
      const reasons: string[] = [];
      if (missingNodeModules) reasons.push('无 node_modules');
      if (depsFilesChanged) reasons.push('package.json / 锁文件相对 fetch 前有变化');
      if (!fingerprintAfter) reasons.push('无法解析 HEAD 依赖指纹（将尝试安装）');
      pushStartupLog(run, `[${proj.name}] 将执行安装（${reasons.join('；')}）`, 'info');
    }

    pushStartupLog(run, `[${proj.name}] Executing: ${installCmd}`);
    try {
      await runStartupShellStep(run, proj.name, expandedPath, installCmd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushStartupLog(
        run,
        `[${proj.name}] 安装失败（常见原因：私有包未配置 .npmrc / registry）。本次不会启动 dev。`,
        'error'
      );
      pushStartupLog(run, `[Runner] 因依赖安装失败，已跳过 yarn dev 等后台进程`, 'error');
      throw new Error(msg);
    }
  }

  // Step 4: dev（Terminal = 真 TTY；否则 stdout/stderr 经 SSE 推到本页）
  pushStartupLog(run, `[Runner] Spawning dev...`);
  run.events.push({ type: 'bootstrap_ready', timestamp: nowTs(), payload: {} });

  const useTerminal = openDevInTerminal && process.platform === 'darwin';
  const devStreams: Promise<void>[] = [];
  for (const proj of projects) {
    const runCmd = (proj.runCmd || '').trim();
    if (runCmd && runCmd !== 'none') {
      const expandedPath = expandPath(proj.path);
      if (useTerminal) {
        pushStartupLog(
          run,
          `[${proj.name}] 在 Terminal.app 新窗口执行: ${runCmd}（真 TTY，适合 cjet 等交互）`,
          'info'
        );
        launchDevInMacTerminal(expandedPath, runCmd, proj.name);
      } else {
        devStreams.push(attachDevStreamToRun(run, expandedPath, runCmd, proj.name));
      }
    }
  }

  if (devStreams.length > 0) {
    await Promise.all(devStreams);
  }

  if (run.status === 'stopped') return;

  run.status = 'completed';
  run.events.push({ type: 'completed', timestamp: nowTs(), payload: {} });
  pushStartupLog(
    run,
    useTerminal
      ? '🎉 仓库就绪；dev 已在 Terminal 新窗口中运行'
      : '🎉 仓库就绪；上方为本次 dev 的流式输出（子进程已退出则本段结束）',
    'success'
  );
}

function nowTs(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

function pushEvent(run: AutomationRun, event: RunEvent) {
  run.events.push(event);
}

function pushLog(
  run: AutomationRun,
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' | 'system' = 'info'
) {
  pushEvent(run, {
    type: 'log',
    timestamp: nowTs(),
    payload: { message, level },
  });
}

function setRunStatus(run: AutomationRun, status: RunStatus, extra: Record<string, unknown> = {}) {
  run.status = status;
  pushEvent(run, {
    type: 'status',
    timestamp: nowTs(),
    payload: { status, ...extra },
  });
}

function quoteShellArg(input: string): string {
  return `"${input.replace(/(["\\$`])/g, '\\$1')}"`;
}

function parseDailySchedules(spec: string): DailySchedule[] {
  const seen = new Set<string>();
  const parsed: DailySchedule[] = [];

  for (const raw of spec.split(',')) {
    const value = raw.trim();
    if (!value) continue;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid daily schedule: ${value}`);
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid daily schedule: ${value}`);
    }
    const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    if (seen.has(label)) continue;
    seen.add(label);
    parsed.push({ hour, minute, label });
  }

  parsed.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
  return parsed;
}

function getNextOccurrence(from: Date, schedules: DailySchedule[]): { when: Date; schedule: DailySchedule } {
  let best: { when: Date; schedule: DailySchedule } | null = null;

  for (const schedule of schedules) {
    const candidate = new Date(from);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    if (candidate.getTime() <= from.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    if (!best || candidate.getTime() < best.when.getTime()) {
      best = { when: candidate, schedule };
    }
  }

  if (!best) {
    throw new Error('No schedules configured');
  }
  return best;
}

function getConfiguredT1Command(): string {
  if (AUTOMATION_T1_COMMAND.trim()) {
    return AUTOMATION_T1_COMMAND.trim();
  }
  if (AUTOMATION_T1_CLI_BIN.trim()) {
    const parts = [
      quoteShellArg(AUTOMATION_T1_CLI_BIN.trim()),
      '--cwd',
      quoteShellArg(AUTOMATION_T1_CLI_CWD),
      '--env',
      quoteShellArg(AUTOMATION_T1_ENV),
      '--non-interactive',
    ];

    if (AUTOMATION_T1_EXTRA_ARGS.trim()) {
      parts.push(AUTOMATION_T1_EXTRA_ARGS.trim());
    }

    return parts.join(' ');
  }
  if (!AUTOMATION_T1_CLI_ENTRY.trim()) {
    return '';
  }

  const parts = [
    'node',
    quoteShellArg(AUTOMATION_T1_CLI_ENTRY.trim()),
    '--cwd',
    quoteShellArg(AUTOMATION_T1_CLI_CWD),
    '--env',
    quoteShellArg(AUTOMATION_T1_ENV),
  ];

  if (AUTOMATION_T1_EXTRA_ARGS.trim()) {
    parts.push(AUTOMATION_T1_EXTRA_ARGS.trim());
  }

  return parts.join(' ');
}

function createRun(taskId: AutomationTaskId, trigger: RunTrigger): AutomationRun {
  return {
    id: randomUUID(),
    taskId,
    trigger,
    status: 'running',
    events: [],
  };
}

function registerRun(run: AutomationRun) {
  runs.set(run.id, run);
  activeRunsByTask.set(run.taskId, run.id);
  pushLog(run, `已创建运行实例 ${run.id}`, 'info');
  pushLog(run, `触发方式：${run.trigger === 'scheduled' ? '定时任务' : '手动执行'}`, 'info');
}

function finishRun(run: AutomationRun) {
  const activeRunId = activeRunsByTask.get(run.taskId);
  if (activeRunId === run.id) {
    activeRunsByTask.delete(run.taskId);
  }
}

function runShellStep(run: AutomationRun, step: string, cwd: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pushLog(run, `[${step}] $ ${command}`, 'info');
    const child = spawn(command, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        CI: process.env.CI || 'true',
      },
    });

    const hardErrorPattern = /(error|exception|failed|cannot|not found|eacces|enoent)/i;
    let buffered = '';
    let lastErrorLine = '';

    const onData = (chunk: Buffer | string, level: 'info' | 'error') => {
      const text = chunk.toString();
      buffered += text;
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) continue;
        pushLog(run, `[${step}] ${line}`, level === 'error' ? 'error' : 'info');
        if (level === 'error') {
          lastErrorLine = line;
        }
      }
    };

    child.stdout.on('data', (c) => onData(c, 'info'));
    child.stderr.on('data', (c) => onData(c, 'error'));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (buffered.trim()) {
        const tail = buffered.trim();
        pushLog(run, `[${step}] ${tail}`, hardErrorPattern.test(tail) ? 'error' : 'info');
        if (hardErrorPattern.test(tail)) {
          lastErrorLine = tail;
        }
      }
      if (code === 0) {
        pushLog(run, `[${step}] 执行完成`, 'success');
        resolve();
      } else {
        const detail = lastErrorLine ? `，错误信息：${lastErrorLine}` : '';
        reject(new Error(`步骤执行失败（exit=${code}）${detail}`));
      }
    });
  });
}

async function executeTaskT1(run: AutomationRun): Promise<void> {
  const command = getConfiguredT1Command();
  if (!command) {
    throw new Error(
      '未配置快速升级 CLI 命令。请设置 AUTOMATION_T1_COMMAND，或同时设置 AUTOMATION_T1_CLI_ENTRY。'
    );
  }

  setRunStatus(run, 'running', { trigger: run.trigger });
  pushLog(run, '开始执行自动化：早晚代码基线与依赖升级', 'system');
  pushLog(run, `工作目录：${AUTOMATION_T1_CLI_CWD}`, 'info');
  pushLog(run, '执行方式：直接调用 CLI 自动化升级', 'info');
  await runShellStep(run, 'step-1-run-quick-upgrade-cli', AUTOMATION_T1_CLI_CWD, command);
  setRunStatus(run, 'completed');
  pushEvent(run, { type: 'completed', timestamp: nowTs(), payload: {} });
  pushLog(run, '自动化任务已完成。', 'success');
}

function startRun(taskId: AutomationTaskId, trigger: RunTrigger): AutomationRun {
  const activeRunId = activeRunsByTask.get(taskId);
  if (activeRunId) {
    throw new Error(`任务 ${taskId} 已在运行中（runId=${activeRunId}）`);
  }

  const run = createRun(taskId, trigger);
  registerRun(run);

  void executeTaskT1(run)
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      setRunStatus(run, 'failed', { error: msg });
      pushEvent(run, { type: 'failed', timestamp: nowTs(), payload: { error: msg } });
      pushLog(run, `任务失败：${msg}`, 'error');
    })
    .finally(() => {
      finishRun(run);
    });

  return run;
}

function scheduleTaskT1() {
  if (taskT1Timer) {
    clearTimeout(taskT1Timer);
    taskT1Timer = undefined;
  }

  if (!AUTOMATION_T1_ENABLED) {
    console.log('[deploy-api] automation t_1 disabled by AUTOMATION_T1_ENABLED=false');
    return;
  }

  const command = getConfiguredT1Command();
  if (!command) {
    console.warn(
      '[deploy-api] automation t_1 scheduler not started because no CLI command is configured'
    );
    return;
  }

  let schedules: DailySchedule[];
  try {
    schedules = parseDailySchedules(AUTOMATION_T1_SCHEDULES);
  } catch (error) {
    console.error(
      `[deploy-api] automation t_1 scheduler configuration error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  if (schedules.length === 0) {
    console.warn('[deploy-api] automation t_1 scheduler not started because no schedule is configured');
    return;
  }

  const next = getNextOccurrence(new Date(), schedules);
  const delayMs = Math.max(1000, next.when.getTime() - Date.now());
  console.log(
    `[deploy-api] automation t_1 scheduled for ${next.when.toLocaleString()} (slot ${next.schedule.label})`
  );

  taskT1Timer = setTimeout(() => {
    scheduleTaskT1();
    try {
      startRun('t_1', 'scheduled');
    } catch (error) {
      console.warn(
        `[deploy-api] skipped scheduled t_1 run: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }, delayMs);
}

app.get('/api/deploy/health', (_req, res) => {
  const jenkins = getJenkinsCredentialsFromEnv(process.env);
  let projects: ReturnType<typeof listDeployProjects> = [];
  let configError: string | undefined;
  try {
    projects = listDeployProjects(loadDeployProjectConfig());
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  res.json({
    jenkinsConfigured: jenkins.ok === true && !configError && projects.length > 0,
    jenkinsMissing: jenkins.ok === false ? jenkins.missing : [],
    deployConfigError: configError,
    projects,
    jiraConfigured: !!(
      process.env.JIRA_BASE_URL &&
      process.env.JIRA_EMAIL &&
      process.env.JIRA_API_TOKEN
    ),
    automation: {
      t1Enabled: AUTOMATION_T1_ENABLED,
      t1Schedules: AUTOMATION_T1_SCHEDULES,
      t1CommandConfigured: !!getConfiguredT1Command(),
    },
  });
});

app.get('/api/deploy/jira/resolution/:issueKey', async (req, res) => {
  try {
    const issueKey = req.params.issueKey?.trim().toUpperCase();
    if (!issueKey) {
      res.status(400).json({ error: 'Missing issue key' });
      return;
    }
    const result = await resolveIssueToJobPaths({
      issueKey,
      jiraBaseUrl: process.env.JIRA_BASE_URL,
      jiraEmail: process.env.JIRA_EMAIL,
      jiraApiToken: process.env.JIRA_API_TOKEN,
      componentMapJson: process.env.JIRA_COMPONENT_JOB_MAP,
      fallbackNodesCsv: process.env.JIRA_RESOLUTION_FALLBACK_NODES,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

function parseProjectIdsFromBody(body: {
  projectId?: unknown;
  projectIds?: unknown;
  jobPath?: unknown;
  jobPaths?: unknown;
}): string[] {
  if (Array.isArray(body.projectIds)) {
    return body.projectIds.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof body.projectId === 'string' && body.projectId.trim()) {
    return [body.projectId.trim()];
  }

  // Backward compatible with the current page/template field name: values are project ids now.
  if (Array.isArray(body.jobPaths)) {
    return body.jobPaths
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  }
  if (typeof body.jobPath === 'string' && body.jobPath.trim()) {
    return [body.jobPath.trim()];
  }
  return [];
}

app.post('/api/deploy/jenkins/trigger', async (req, res) => {
  try {
    const projectIds = parseProjectIdsFromBody(req.body || {});
    if (!projectIds.length) {
      res.status(400).json({ error: 'projectId or projectIds required' });
      return;
    }

    const pollQueue = Boolean(req.body?.pollQueue);
    const pollTimeoutMs = Math.min(Number(req.body?.pollTimeoutMs) || 120000, 600000);
    const config = loadDeployProjectConfig();
    const targets = resolveDeployTargets(config, {
      projectIds,
      jiraId: typeof req.body?.jiraId === 'string' ? req.body.jiraId : undefined,
      explicitBranch: typeof req.body?.branch === 'string' ? req.body.branch : undefined,
    });

    const jenkins = getJenkinsCredentialsFromEnv(process.env);
    if (jenkins.ok === false) {
      res.status(jenkins.status).json({
        simulated: false,
        error: jenkins.error,
        missing: jenkins.missing,
      });
      return;
    }

    const results: Array<
      Awaited<ReturnType<typeof triggerJenkinsJob>> & {
        projectId: string;
        projectLabel: string;
        branch: string;
      }
    > = [];
    for (const target of targets) {
      const parameters = buildDeployParameters(
        { jiraId: req.body?.jiraId, branch: target.branch },
        {
          JENKINS_PARAM_JIRA: target.jiraParamName,
          JENKINS_PARAM_BRANCH: target.branchParamName,
        }
      );
      const r = await triggerJenkinsJob({
        jenkinsBaseUrl: target.jenkinsBaseUrl,
        user: jenkins.credentials.user,
        token: jenkins.credentials.token,
        jobSegments: target.jobSegments,
        parameters,
        pollQueue,
        pollTimeoutMs,
      });
      results.push({
        ...r,
        projectId: target.projectId,
        projectLabel: target.label,
        branch: target.branch,
      });
      if (r.error) {
        res.status(502).json({
          simulated: false,
          results,
          failedAt: target.projectId,
          error: r.error,
        });
        return;
      }
    }

    res.json({ simulated: false, results, projectIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof DeployContractError ? e.status : 500;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/deploy/jenkins/build-result
 * Body: { buildUrl: string, timeoutMs?: number }
 * Polls the given Jenkins build URL until it completes (building=false) and returns the result.
 * Used by the frontend to block sequential pipeline nodes until the previous build finishes.
 */
app.post('/api/deploy/jenkins/build-result', async (req, res) => {
  try {
    const buildUrl = typeof req.body?.buildUrl === 'string' ? req.body.buildUrl.trim() : '';
    if (!buildUrl) {
      res.status(400).json({ error: 'buildUrl required' });
      return;
    }
    const timeoutMs = Math.min(Number(req.body?.timeoutMs) || 1800000, 3600000); // max 1hr

    const jenkins = getJenkinsCredentialsFromEnv(process.env);
    if (jenkins.ok === false) {
      res.status(jenkins.status).json({ error: jenkins.error });
      return;
    }

    const auth = 'Basic ' + Buffer.from(
      `${jenkins.credentials.user}:${jenkins.credentials.token}`,
      'utf8'
    ).toString('base64');

    const result = await pollBuildUntilComplete(buildUrl, auth, timeoutMs);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});


app.post('/api/deploy/automation/runs/start', async (req, res) => {
  const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
  if (!taskId) {
    res.status(400).json({ error: 'taskId required' });
    return;
  }
  if (taskId !== 't_1') {
    res.status(400).json({ error: 'Only t_1 is currently supported for real execution' });
    return;
  }

  try {
    const run = startRun('t_1', 'manual');
    res.json({ runId: run.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const activeRunId = activeRunsByTask.get('t_1');
    res.status(409).json({ error: message, runId: activeRunId });
  }
});

app.get('/api/deploy/automation/runs/:runId/events', (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let cursor = 0;
  const timer = setInterval(() => {
    while (cursor < run.events.length) {
      const event = run.events[cursor++];
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (run.status === 'completed' || run.status === 'failed') {
      clearInterval(timer);
      res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(timer);
  });
});

app.post('/api/deploy/automation/runs/:runId/continue', async (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  if (run.status !== 'waiting_input' || !run.waiter) {
    res.status(400).json({ error: 'run is not waiting for manual input' });
    return;
  }

  const solution = typeof req.body?.solution === 'string' ? req.body.solution.trim() : '';
  if (!solution) {
    res.status(400).json({ error: 'solution required' });
    return;
  }

  const waiter = run.waiter;
  run.waiter = undefined;
  run.pendingReason = undefined;
  run.waitingStep = undefined;
  waiter(solution);
  res.json({ ok: true });
});

app.post('/api/startup/launch', (req, res) => {
  const { ide, projects } = req.body || {};
  if (!ide || !Array.isArray(projects) || projects.length === 0) {
    res.status(400).json({ error: 'ide 和 projects 字段必填' });
    return;
  }

  const run: StartupRun = { id: randomUUID(), status: 'running', events: [], processes: new Map() };
  startupRuns.set(run.id, run);

  const body = req.body as {
    options?: { smartInstall?: boolean; openDevInTerminal?: boolean };
  };
  const smartInstall = body?.options?.smartInstall !== false;
  /** 默认 false：dev 输出经 SSE 直出到页面；仅当显式 true 且在 macOS 时用 Terminal.app（真 TTY） */
  const openDevInTerminal =
    body?.options?.openDevInTerminal === true && process.platform === 'darwin';

  void executeStartupLaunch(
    run,
    String(ide),
    projects as StartupProjectConfig[],
    smartInstall,
    openDevInTerminal
  ).catch((e) => {
    if (run.status === 'stopped') return;
    const msg = e instanceof Error ? e.message : String(e);
    run.status = 'failed';
    run.events.push({ type: 'failed', timestamp: nowTs(), payload: { error: msg } });
    pushStartupLog(run, `任务失败：${msg}`, 'error');
  });

  res.json({ runId: run.id });
});

app.post('/api/startup/runs/:runId/stop', (req, res) => {
  const run = startupRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  const stoppedProcesses = stopStartupRun(run);
  res.json({ ok: true, status: run.status, stoppedProcesses });
});

app.get('/api/startup/runs/:runId/events', (req, res) => {
  const run = startupRuns.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let cursor = 0;
  const timer = setInterval(() => {
    while (cursor < run.events.length) {
      const event = run.events[cursor++];
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') {
      clearInterval(timer);
      res.end();
    }
  }, 300);

  req.on('close', () => clearInterval(timer));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  scheduleTaskT1();
  console.log(`[deploy-api] listening on http://127.0.0.1:${PORT}`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[deploy-api] 端口 ${PORT} 已被占用（可能还有未关掉的 deploy-api）。可执行 lsof -iTCP:${PORT} -sTCP:LISTEN 查看，或设置环境变量 DEPLOY_API_PORT 换端口。`,
    );
  } else {
    console.error('[deploy-api] listen error:', err);
  }
  process.exit(1);
});
