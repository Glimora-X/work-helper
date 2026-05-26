/**
 * Server-side deploy DAG orchestration + persisted task frequency stats.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { triggerJenkinsJob, pollBuildUntilComplete } from './jenkins-client';
import { buildDeployParameters, getJenkinsCredentialsFromEnv } from './deploy-contract';
import { loadDeployProjectConfig, resolveDeployTargets } from './deploy-project-config';
import {
  buildTaskKeyFromStages,
  computeExecutionStages,
  flattenExecutionStages,
  resolveDeployLinks,
  type DeployGraphLink,
} from '../src/lib/deploy-dag.ts';

const STATS_PATH = path.join(process.cwd(), '.deploy-pipeline-stats.json');
const MAX_EVENTS_PER_RUN = 500;
const MAX_RUNS_IN_MEMORY = 48;

export type DeployPipelineNodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'queued';

export interface DeployPipelineNodeState {
  id: string;
  name: string;
  status: DeployPipelineNodeStatus;
  duration?: string;
  queueUrl?: string;
  buildUrl?: string;
  buildNumber?: number;
  branch?: string;
}

export interface DeployPipelineRunEvent {
  type: 'log' | 'nodes' | 'completed' | 'failed';
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface DeployPipelineRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  taskKey: string;
  jiraId?: string;
  branch?: string;
  nodes: DeployPipelineNodeState[];
  executionStages: string[][];
  events: DeployPipelineRunEvent[];
  activeNodeId: string | null;
  createdAt: string;
}

const deployPipelineRuns = new Map<string, DeployPipelineRun>();

function nowTs(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

function jenkinsAuthHeader(user: string, token: string): string {
  return 'Basic ' + Buffer.from(`${user}:${token}`, 'utf8').toString('base64');
}

function pushEvent(run: DeployPipelineRun, event: DeployPipelineRunEvent): void {
  run.events.push(event);
  while (run.events.length > MAX_EVENTS_PER_RUN) {
    run.events.splice(0, 80);
  }
}

function pushLog(
  run: DeployPipelineRun,
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' | 'system' = 'info'
): void {
  pushEvent(run, { type: 'log', timestamp: nowTs(), payload: { message, level } });
}

function pushNodesSnapshot(run: DeployPipelineRun): void {
  pushEvent(run, {
    type: 'nodes',
    timestamp: nowTs(),
    payload: { nodes: JSON.parse(JSON.stringify(run.nodes)) as DeployPipelineNodeState[] },
  });
}

function updateNode(
  run: DeployPipelineRun,
  nodeId: string,
  patch: Partial<DeployPipelineNodeState>
): void {
  run.nodes = run.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
}

interface StatsFileV1 {
  version: 1;
  tasks: Record<string, { count: number; lastRunAt: string }>;
}

function readStatsFile(): StatsFileV1 {
  try {
    const raw = fs.readFileSync(STATS_PATH, 'utf8');
    const data = JSON.parse(raw) as StatsFileV1;
    if (data?.version === 1 && data.tasks && typeof data.tasks === 'object') {
      return data;
    }
  } catch {
    /* missing or corrupt */
  }
  return { version: 1, tasks: {} };
}

function writeStatsFile(data: StatsFileV1): void {
  fs.writeFileSync(STATS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function bumpPipelineTaskStats(taskKey: string): void {
  const data = readStatsFile();
  const prev = data.tasks[taskKey];
  const count = (prev?.count ?? 0) + 1;
  const lastRunAt = new Date().toISOString();
  data.tasks[taskKey] = { count, lastRunAt };
  writeStatsFile(data);
}

export function getPipelineTaskStatsSorted(limit = 40): Array<{
  taskKey: string;
  count: number;
  lastRunAt: string;
}> {
  const data = readStatsFile();
  return Object.entries(data.tasks)
    .map(([taskKey, v]) => ({ taskKey, count: v.count, lastRunAt: v.lastRunAt }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime()
    )
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

function pruneRunsIfNeeded(): void {
  if (deployPipelineRuns.size <= MAX_RUNS_IN_MEMORY) return;
  const terminal = [...deployPipelineRuns.entries()].filter(([, r]) => r.status !== 'running');
  terminal.sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());
  while (deployPipelineRuns.size > MAX_RUNS_IN_MEMORY - 8 && terminal.length) {
    const [id] = terminal.shift()!;
    deployPipelineRuns.delete(id);
  }
}

export function getDeployPipelineRun(runId: string): DeployPipelineRun | undefined {
  return deployPipelineRuns.get(runId);
}

export function getDeployPipelineRunSnapshot(runId: string): {
  id: string;
  status: DeployPipelineRun['status'];
  taskKey: string;
  jiraId?: string;
  branch?: string;
  nodes: DeployPipelineNodeState[];
  events: DeployPipelineRunEvent[];
  eventCount: number;
  activeNodeId: string | null;
  createdAt: string;
} | null {
  const run = deployPipelineRuns.get(runId);
  if (!run) return null;
  const tail = run.events.slice(-280);
  return {
    id: run.id,
    status: run.status,
    taskKey: run.taskKey,
    jiraId: run.jiraId,
    branch: run.branch,
    nodes: JSON.parse(JSON.stringify(run.nodes)) as DeployPipelineNodeState[],
    events: tail,
    eventCount: run.events.length,
    activeNodeId: run.activeNodeId,
    createdAt: run.createdAt,
  };
}

export type StartDeployPipelineResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; status: number };

export function startDeployPipelineRun(args: {
  projectIds?: string[];
  dag?: { nodes: string[]; links?: DeployGraphLink[] };
  jiraId?: string;
  branch?: string;
}): StartDeployPipelineResult {
  const dagNodes = Array.isArray(args.dag?.nodes)
    ? args.dag!.nodes.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const fallbackIds = (args.projectIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const nodeNames = dagNodes.length ? dagNodes : fallbackIds;

  if (!nodeNames.length) {
    return { ok: false, error: 'projectIds or dag.nodes required', status: 400 };
  }

  let executionStages: string[][];
  try {
    executionStages = computeExecutionStages(
      nodeNames,
      resolveDeployLinks(nodeNames, args.dag?.links)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 400 };
  }

  const orderedNames = flattenExecutionStages(executionStages);
  const taskKey = buildTaskKeyFromStages(executionStages);
  const nodes: DeployPipelineNodeState[] = orderedNames.map((name) => ({
    id: randomUUID(),
    name,
    status: 'idle',
  }));

  const run: DeployPipelineRun = {
    id: randomUUID(),
    status: 'running',
    taskKey,
    jiraId: args.jiraId?.trim() || undefined,
    branch: args.branch?.trim() || undefined,
    nodes,
    executionStages,
    events: [],
    activeNodeId: null,
    createdAt: new Date().toISOString(),
  };

  deployPipelineRuns.set(run.id, run);
  bumpPipelineTaskStats(taskKey);
  pruneRunsIfNeeded();

  const parallelHint =
    executionStages.some((stage) => stage.length > 1) ? '（含并行阶段）' : '';
  pushLog(run, `服务端编排：已创建流水线实例${parallelHint}，开始触发 Jenkins…`, 'system');
  void executeDeployPipeline(run.id);

  return { ok: true, runId: run.id };
}

type JenkinsAuthBundle = {
  user: string;
  token: string;
  auth: string;
};

type NodeRunOutcome =
  | { ok: true; partial?: boolean }
  | { ok: false; partial?: boolean; failed?: boolean; error?: string };

function findNodeByName(run: DeployPipelineRun, name: string): DeployPipelineNodeState | undefined {
  return run.nodes.find((n) => n.name === name);
}

async function runDeployPipelineNode(
  run: DeployPipelineRun,
  node: DeployPipelineNodeState,
  jenkins: JenkinsAuthBundle,
  config: ReturnType<typeof loadDeployProjectConfig>,
  waitForComplete: boolean
): Promise<NodeRunOutcome> {
  pushLog(run, `[Jenkins] Preparing trigger for project: ${node.name}`, 'info');

  try {
    const t0 = performance.now();
    const targets = resolveDeployTargets(config, {
      projectIds: [node.name],
      jiraId: run.jiraId,
      explicitBranch: run.branch,
    });

    let lastBranch: string | undefined;
    type TriggerRow = Awaited<ReturnType<typeof triggerJenkinsJob>> & {
      projectId: string;
      projectLabel: string;
      branch: string;
    };
    const rows: TriggerRow[] = [];

    for (const target of targets) {
      const parameters = buildDeployParameters(
        { jiraId: run.jiraId, branch: target.branch },
        {
          JENKINS_PARAM_JIRA: target.jiraParamName,
          JENKINS_PARAM_BRANCH: target.branchParamName,
        }
      );
      const r = await triggerJenkinsJob({
        jenkinsBaseUrl: target.jenkinsBaseUrl,
        user: jenkins.user,
        token: jenkins.token,
        jobSegments: target.jobSegments,
        parameters,
        pollQueue: true,
        pollTimeoutMs: 120_000,
      });
      rows.push({
        ...r,
        projectId: target.projectId,
        projectLabel: target.label,
        branch: target.branch,
      });
      lastBranch = target.branch;
      if (r.error) {
        throw new Error(r.error);
      }
    }

    const jobResult = rows[rows.length - 1];
    pushLog(run, `[Jenkins] ${jobResult?.message || 'Triggered.'}`, 'info');
    if (lastBranch) {
      pushLog(run, `[Jenkins] Branch resolved for ${node.name}: ${lastBranch}`, 'system');
    }
    if (jobResult?.queueUrl) {
      pushLog(run, `[Jenkins] Queue: ${jobResult.queueUrl}`, 'system');
    }
    if (jobResult?.buildUrl) {
      pushLog(run, `[Jenkins] Build: ${jobResult.buildUrl}`, 'system');
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const nextStatus: DeployPipelineNodeStatus = jobResult?.buildUrl ? 'running' : 'queued';
    updateNode(run, node.id, {
      status: nextStatus,
      duration: `${elapsed}s`,
      queueUrl: jobResult?.queueUrl,
      buildUrl: jobResult?.buildUrl,
      buildNumber: jobResult?.buildNumber,
      branch: lastBranch,
    });
    pushNodesSnapshot(run);

    if (nextStatus === 'queued') {
      pushLog(
        run,
        `[${node.name}] Jenkins 已接收入队，但未在超时前返回 Build URL；停止后续依赖节点。`,
        'warn'
      );
      return { ok: false, partial: true };
    }

    if (jobResult?.buildUrl && waitForComplete) {
      pushLog(
        run,
        `[${node.name}] Build #${jobResult.buildNumber} 已启动，等待执行完成后再进入下一阶段…`,
        'system'
      );
      const buildResult = await pollBuildUntilComplete(
        jobResult.buildUrl,
        jenkins.auth,
        1_800_000,
        5000
      );

      if (buildResult.error && buildResult.building) {
        pushLog(
          run,
          `[${node.name}] 等待 build 完成超时：${buildResult.error}，中断后续节点。`,
          'warn'
        );
        updateNode(run, node.id, { status: 'queued' });
        return { ok: false, partial: true };
      }

      if (buildResult.result !== 'SUCCESS') {
        const reason = buildResult.result ?? buildResult.error ?? 'UNKNOWN';
        pushLog(run, `[${node.name}] Build 结果为 ${reason}，中断后续依赖节点。`, 'error');
        updateNode(run, node.id, { status: 'failed' });
        return { ok: false, failed: true, error: String(reason) };
      }

      const buildDuration = buildResult.duration
        ? `${(buildResult.duration / 1000).toFixed(0)}s`
        : `${elapsed}s`;
      pushLog(run, `[${node.name}] ✅ Build SUCCESS (耗时 ${buildDuration})`, 'success');
      updateNode(run, node.id, { status: 'success', duration: buildDuration });
      pushNodesSnapshot(run);
      return { ok: true };
    }

    if (jobResult?.buildUrl) {
      pushLog(run, `[${node.name}] Jenkins build confirmed.`, 'success');
    }
    updateNode(run, node.id, {
      status: jobResult?.buildUrl ? 'success' : 'queued',
    });
    pushNodesSnapshot(run);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    pushLog(run, `[Jenkins ERROR] Failed to trigger ${node.name}: ${message}`, 'error');
    updateNode(run, node.id, { status: 'failed' });
    return { ok: false, failed: true, error: message };
  }
}

async function executeDeployPipeline(runId: string): Promise<void> {
  const run = deployPipelineRuns.get(runId);
  if (!run) return;

  const jenkins = getJenkinsCredentialsFromEnv(process.env);
  if (jenkins.ok === false) {
    pushLog(run, `Jenkins 未配置: ${jenkins.error}`, 'error');
    run.status = 'failed';
    pushEvent(run, { type: 'failed', timestamp: nowTs(), payload: { error: jenkins.error } });
    run.activeNodeId = null;
    pushNodesSnapshot(run);
    return;
  }

  let config;
  try {
    config = loadDeployProjectConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushLog(run, `部署工程配置错误: ${msg}`, 'error');
    run.status = 'failed';
    pushEvent(run, { type: 'failed', timestamp: nowTs(), payload: { error: msg } });
    run.activeNodeId = null;
    pushNodesSnapshot(run);
    return;
  }

  const auth = jenkinsAuthHeader(jenkins.credentials.user, jenkins.credentials.token);
  const jenkinsBundle: JenkinsAuthBundle = {
    user: jenkins.credentials.user,
    token: jenkins.credentials.token,
    auth,
  };

  const stages = run.executionStages.length
    ? run.executionStages
    : run.nodes.map((n) => [n.name]);

  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx];
    const stageNodes = stage
      .map((name) => findNodeByName(run, name))
      .filter(Boolean) as DeployPipelineNodeState[];
    if (!stageNodes.length) continue;

    const waitForComplete = stageIdx < stages.length - 1;
    for (const node of stageNodes) {
      run.activeNodeId = node.id;
      updateNode(run, node.id, { status: 'running' });
    }
    pushNodesSnapshot(run);

    if (stageNodes.length > 1) {
      pushLog(run, `[DAG] 并行触发: ${stageNodes.map((n) => n.name).join(', ')}`, 'system');
    }

    const outcomes = await Promise.all(
      stageNodes.map((node) =>
        runDeployPipelineNode(run, node, jenkinsBundle, config, waitForComplete)
      )
    );

    for (const outcome of outcomes) {
      if (outcome.ok === false) {
        run.activeNodeId = null;
        if (outcome.failed) {
          run.status = 'failed';
          pushEvent(run, {
            type: 'failed',
            timestamp: nowTs(),
            payload: { error: outcome.error || 'node failed' },
          });
        } else {
          run.status = 'completed';
          pushEvent(run, { type: 'completed', timestamp: nowTs(), payload: { partial: true } });
        }
        pushNodesSnapshot(run);
        return;
      }
    }

    if (stageIdx < stages.length - 1) {
      const nextStage = stages[stageIdx + 1];
      pushLog(
        run,
        `[DAG] 进入下一阶段: ${nextStage.join(nextStage.length > 1 ? ' / ' : ', ')}`,
        'system'
      );
    }
  }

  run.activeNodeId = null;
  run.status = 'completed';
  pushLog(run, 'Pipeline execution completed successfully.', 'success');
  pushEvent(run, { type: 'completed', timestamp: nowTs(), payload: {} });
  pushNodesSnapshot(run);
}
