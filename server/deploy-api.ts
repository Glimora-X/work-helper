import express from 'express';
import { config } from 'dotenv';
import { triggerJenkinsJob } from './jenkins-client';
import { resolveIssueToJobPaths } from './jira-resolve';
import { spawn } from 'node:child_process';
import path from 'node:path';
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
  type: 'log' | 'status' | 'waiting' | 'completed' | 'failed';
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

/** One pipeline step: either a single job path or multiple parallel jobs (same stage). */
function parseJobPathsFromBody(body: {
  jobPath?: string | string[];
  jobPaths?: (string | string[])[];
}): string[][] {
  if (body.jobPaths && Array.isArray(body.jobPaths)) {
    const out: string[][] = [];
    for (const item of body.jobPaths) {
      if (typeof item === 'string') {
        const segs = item
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean);
        if (segs.length) out.push(segs);
      } else if (Array.isArray(item)) {
        const segs = item.map((s) => String(s).trim()).filter(Boolean);
        if (segs.length) out.push(segs);
      }
    }
    if (out.length) return out;
  }
  if (body.jobPath != null) {
    if (typeof body.jobPath === 'string') {
      const segs = body.jobPath
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      if (segs.length) return [segs];
    } else if (Array.isArray(body.jobPath)) {
      const segs = body.jobPath.map((s) => String(s).trim()).filter(Boolean);
      if (segs.length) return [segs];
    }
  }
  return [];
}

app.get('/api/deploy/health', (_req, res) => {
  res.json({
    jenkinsConfigured: !!(process.env.JENKINS_URL && process.env.JENKINS_USER && process.env.JENKINS_TOKEN),
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

app.post('/api/deploy/jenkins/trigger', async (req, res) => {
  try {
    const jenkinsUrl = process.env.JENKINS_URL?.replace(/\/$/, '');
    const user = process.env.JENKINS_USER;
    const token = process.env.JENKINS_TOKEN;

    const paramJira = process.env.JENKINS_PARAM_JIRA || 'JIRA_ID';
    const paramBranch = process.env.JENKINS_PARAM_BRANCH || 'BRANCH';

    const jobPathGroups = parseJobPathsFromBody(req.body || {});
    if (!jobPathGroups.length) {
      res.status(400).json({ error: 'jobPath or jobPaths required' });
      return;
    }

    const jiraId = typeof req.body?.jiraId === 'string' ? req.body.jiraId : undefined;
    const branch = typeof req.body?.branch === 'string' ? req.body.branch : undefined;
    const pollQueue = Boolean(req.body?.pollQueue);
    const pollTimeoutMs = Math.min(Number(req.body?.pollTimeoutMs) || 120000, 600000);

    const parameters: Record<string, string> = {};
    if (jiraId) parameters[paramJira] = jiraId;
    if (branch) parameters[paramBranch] = branch;

    if (!jenkinsUrl || !user || !token) {
      res.status(200).json({
        simulated: true,
        message:
          'Jenkins not configured (set JENKINS_URL, JENKINS_USER, JENKINS_TOKEN). Client may simulate UI.',
        jobPathGroups,
        parameters,
      });
      return;
    }

    const results: Awaited<ReturnType<typeof triggerJenkinsJob>>[] = [];
    for (const segments of jobPathGroups) {
      const r = await triggerJenkinsJob({
        jenkinsBaseUrl: jenkinsUrl,
        user,
        token,
        jobSegments: segments,
        parameters,
        pollQueue,
        pollTimeoutMs,
      });
      results.push(r);
      if (r.error) {
        res.status(502).json({
          simulated: false,
          results,
          failedAt: segments.join('/'),
          error: r.error,
        });
        return;
      }
    }

    res.json({ simulated: false, results, jobPathGroups });
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

app.listen(PORT, '0.0.0.0', () => {
  scheduleTaskT1();
  console.log(`[deploy-api] listening on http://127.0.0.1:${PORT}`);
});
