import { useState, useEffect } from 'react';
import { Bot, Clock, Play, MoreVertical, FileText, CheckSquare, GitBranch, Plus, Search, ToggleRight, ToggleLeft, X, Sparkles, Zap } from 'lucide-react';
import PageHeader from '../components/PageHeader';

interface AutomationTask {
  id: string;
  name: string;
  description: string;
  schedule: string;
  nextRun: string;
  active: boolean;
  type: 'code' | 'report' | 'jira';
}

const workflowScripts: Record<string, string> = {
  t_1: `// 早晚代码基线与依赖升级
async function run() {
  // 1) 后台调度器到点触发
  await waitForSchedule("05:00,20:00");

  // 2) 直接调用 QuickUpgrade CLI
  await exec("node dist/quick-upgrade/cli/cliEntry.js --cwd <repo> --env test");

  // 3) 将标准输出和失败状态写入自动化运行日志
  await streamLogsToAutomationCenter();
}`,
};

const AUTOMATION_EDITS_KEY = 'assistant-automation-task-edits';

type TaskEdits = Record<string, { schedule: string; script: string }>;

function loadTaskEdits(): TaskEdits {
  try {
    const raw = localStorage.getItem(AUTOMATION_EDITS_KEY);
    if (raw) return JSON.parse(raw) as TaskEdits;
  } catch {
    /* ignore */
  }
  return {};
}

const defaultWorkflowScript = (task: AutomationTask) =>
  `// ${task.name} 运行定义
async function run() {
  console.log("Mock building workflow...");
  // TODO: Add implementation via prompt
}`;

const getWorkflowScript = (task: AutomationTask, edits: TaskEdits) => {
  const saved = edits[task.id]?.script;
  if (saved !== undefined && saved.trim().length > 0) return saved;
  return workflowScripts[task.id] ?? defaultWorkflowScript(task);
};

const displaySchedule = (task: AutomationTask, edits: TaskEdits) =>
  edits[task.id]?.schedule ?? task.schedule;

const DEPLOY_API_BASE =
  ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_DEPLOY_API_BASE ?? '/api/deploy').replace(/\/$/, '') ||
  '/api/deploy';

interface AutomationEvent {
  type: 'log' | 'status' | 'waiting' | 'completed' | 'failed';
  timestamp: string;
  payload: Record<string, unknown>;
}

async function readJsonResponse<T>(resp: Response): Promise<T | null> {
  const text = await resp.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${resp.status}`);
  }
}

const initialTasks: AutomationTask[] = [
  {
    id: 't_1',
    name: '早晚代码基线与依赖升级',
    description: '每天早晚自动后台拉取工作区全量代码，更新分支并重置安装全局环境依赖。',
    schedule: '每天 05:00, 20:00',
    nextRun: '今天 20:00',
    active: true,
    type: 'code',
  },
  {
    id: 't_2',
    name: '整理分析本周工作周报',
    description: '汇聚这周所有接手的 Jira 故事单、Git 代码提交，以及会议大纲等，撰写发出周报。',
    schedule: '每周五 16:00',
    nextRun: '周五 16:00',
    active: true,
    type: 'report',
  },
  {
    id: 't_3',
    name: '每日上下游任务瓶颈分析',
    description: '交叉对比本日我经手的完成单与挂起单，预测延期风险、梳理阻碍依赖发送到飞书。',
    schedule: '每天 17:00',
    nextRun: '今天 17:00',
    active: false,
    type: 'jira',
  }
];

export default function Automations() {
  const [tasks, setTasks] = useState<AutomationTask[]>(initialTasks);
  const [search, setSearch] = useState('');
  
  const [taskEdits, setTaskEdits] = useState<TaskEdits>(loadTaskEdits);
  const [draftSchedule, setDraftSchedule] = useState('');
  const [draftScript, setDraftScript] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(AUTOMATION_EDITS_KEY, JSON.stringify(taskEdits));
    } catch {
      /* ignore */
    }
  }, [taskEdits]);

  // Modal states
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);

  const openWorkflowEditor = (task: AutomationTask) => {
    setDraftSchedule(displaySchedule(task, taskEdits));
    setDraftScript(getWorkflowScript(task, taskEdits));
    setEditingTask(task);
  };
  const [isCreating, setIsCreating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isWaitingInput, setIsWaitingInput] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualHint, setManualHint] = useState('');

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, active: !t.active } : t));
  };

  const handleSaveWorkflowConfig = () => {
    if (!editingTask) return;
    setTaskEdits((prev) => ({
      ...prev,
      [editingTask.id]: { schedule: draftSchedule, script: draftScript },
    }));
    setEditingTask(null);
  };

  const getTypeIconClass = (type: AutomationTask['type']) => {
    switch (type) {
      case 'code':
        return 'pkmer-automation-type-icon pkmer-automation-type-icon--code';
      case 'report':
        return 'pkmer-automation-type-icon pkmer-automation-type-icon--report';
      case 'jira':
        return 'pkmer-automation-type-icon pkmer-automation-type-icon--jira';
      default:
        return 'pkmer-automation-type-icon pkmer-automation-type-icon--code';
    }
  };

  const getIcon = (type: AutomationTask['type']) => {
    switch (type) {
      case 'code':
        return <GitBranch className="w-5 h-5 pkmer-icon-indigo" />;
      case 'report':
        return <FileText className="w-5 h-5 pkmer-icon-secondary" />;
      case 'jira':
        return <CheckSquare className="w-5 h-5" style={{ color: 'var(--color-brand-amber)' }} />;
      default:
        return <Bot className="w-5 h-5 pkmer-text-secondary" />;
    }
  };

  const filteredTasks = tasks.filter(t => t.name.includes(search) || t.description.includes(search));

  const appendLog = (line: string) => {
    setTerminalLogs(prev => [...prev, line]);
  };

  const startTaskRun = async (task: AutomationTask) => {
    if (runningTaskId) return;
    setTerminalOpen(true);
    setTerminalLogs([]);
    setIsWaitingInput(false);
    setManualInput('');
    setManualHint('');
    setRunningTaskId(task.id);
    appendLog(`[system] 正在启动任务: ${task.name}`);

    try {
      const resp = await fetch(`${DEPLOY_API_BASE}/automation/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = await readJsonResponse<{ runId?: string; error?: string }>(resp);
      if (!resp.ok || !data?.runId) throw new Error(data?.error || `HTTP ${resp.status}`);

      setCurrentRunId(data.runId);
      appendLog(`[system] 运行实例已创建: ${data.runId}`);

      const source = new EventSource(`${DEPLOY_API_BASE}/automation/runs/${encodeURIComponent(data.runId)}/events`);
      source.onmessage = (ev) => {
        const event = JSON.parse(ev.data) as AutomationEvent;
        if (event.type === 'log') {
          const msg = typeof event.payload.message === 'string' ? event.payload.message : JSON.stringify(event.payload);
          appendLog(`[${event.timestamp}] ${msg}`);
          return;
        }
        if (event.type === 'waiting') {
          const reason = typeof event.payload.reason === 'string' ? event.payload.reason : '需要人工介入';
          setIsWaitingInput(true);
          setManualHint(reason);
          appendLog(`[${event.timestamp}] [等待处理] ${reason}`);
          return;
        }
        if (event.type === 'completed') {
          appendLog(`[${event.timestamp}] 任务执行完成`);
          source.close();
          setRunningTaskId(null);
          setIsWaitingInput(false);
          return;
        }
        if (event.type === 'failed') {
          const error = typeof event.payload.error === 'string' ? event.payload.error : '任务失败';
          appendLog(`[${event.timestamp}] [失败] ${error}`);
          source.close();
          setRunningTaskId(null);
          setIsWaitingInput(false);
        }
      };
      source.onerror = () => {
        appendLog('[system] 日志连接断开');
        source.close();
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`[error] 启动失败: ${message}`);
      setRunningTaskId(null);
    }
  };

  const submitManualSolution = async () => {
    if (!currentRunId || !manualInput.trim()) return;
    try {
      const resp = await fetch(`${DEPLOY_API_BASE}/automation/runs/${encodeURIComponent(currentRunId)}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: manualInput.trim() }),
      });
      const data = await readJsonResponse<{ error?: string }>(resp);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      appendLog('[system] 已提交你的处理方案，继续执行...');
      setManualInput('');
      setIsWaitingInput(false);
      setManualHint('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`[error] 提交处理方案失败: ${message}`);
    }
  };

  const handleCreateSubmit = () => {
    if (!prompt.trim()) return;
    const newTask: AutomationTask = {
      id: 't_' + Date.now(),
      name: '定制自动化 (设计中)',
      description: prompt,
      schedule: '待配置执行频率',
      nextRun: '未排期',
      active: true,
      type: 'code', 
    };
    setTasks([newTask, ...tasks]);
    setPrompt('');
    setIsCreating(false);
  };

  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--wide">
        <PageHeader
          icon={Bot}
          title="自动化任务"
          subtitle="设置定时触发器接管环境维护、信息整理和周报总结等繁杂流程"
          actions={
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="pkmer-btn pkmer-btn--accent"
            >
              <Plus className="w-4 h-4" /> 新建任务
            </button>
          }
        />

        <div className="pkmer-content-fill flex flex-col min-h-0">
          <div className="mb-6 flex shrink-0 flex-wrap items-center gap-4">
            <div className="relative w-full sm:w-72">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 pkmer-icon-muted"
                aria-hidden
              />
              <input
                type="search"
                placeholder="搜索任务名称或规则..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pkmer-input w-full pl-9 pr-4"
              />
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm pkmer-text-secondary">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full ring-2 ring-[color:var(--glass-border)]"
                  style={{ background: 'var(--success)' }}
                  aria-hidden
                />
                {tasks.filter((t) => t.active).length} 个运行中
              </div>
              <div className="mx-2 h-3 w-px bg-[color:var(--glass-border-subtle)]" aria-hidden />
              <span className="text-xs pkmer-text-muted">细则已保存至本机浏览器</span>
            </div>
          </div>

          <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-4">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task) => (
                <article
                  key={task.id}
                  className={`pkmer-card group flex flex-col p-5 ${!task.active ? 'opacity-60' : ''}`}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className={getTypeIconClass(task.type)}>{getIcon(task.type)}</div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleTask(task.id)}
                        className="rounded-lg p-1 transition-colors"
                        style={{ color: task.active ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                        title={task.active ? '暂停任务' : '恢复任务'}
                      >
                        {task.active ? (
                          <ToggleRight className="h-6 w-6" />
                        ) : (
                          <ToggleLeft className="h-6 w-6" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-1 opacity-0 transition-colors group-hover:opacity-100 pkmer-icon-muted"
                        aria-label="更多操作"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 flex-1">
                    <h3
                      className={`mb-1 text-sm font-semibold pkmer-text-body ${task.active ? '' : 'pkmer-text-secondary'}`}
                    >
                      {task.name}
                    </h3>
                    <p className="line-clamp-3 text-xs leading-relaxed pkmer-text-secondary">
                      {task.description}
                    </p>
                  </div>

                  <div className="shrink-0 border-t border-[color:var(--glass-border-subtle)] pt-3">
                    <div className="mb-3 flex items-center font-mono text-[11px] pkmer-text-muted">
                      <Clock className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {displaySchedule(task, taskEdits)}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openWorkflowEditor(task)}
                        className="pkmer-glass-pill pkmer-glass-pill--secondary px-2.5 py-1.5 text-xs font-medium"
                      >
                        配置工作流细则
                      </button>
                      {task.active ? (
                        <button
                          type="button"
                          onClick={() => startTaskRun(task)}
                          disabled={runningTaskId !== null}
                          className="pkmer-btn-run"
                        >
                          <Play className="h-3 w-3 fill-current" aria-hidden />
                          <span>{runningTaskId === task.id ? '执行中...' : task.nextRun}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}

              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="pkmer-card pkmer-card--dashed flex min-h-[220px] flex-col items-center justify-center p-6"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--glass-border)] bg-[color:var(--glass-surface-elevated)] text-[color:var(--accent-primary)]">
                  <Plus className="h-5 w-5" aria-hidden />
                </div>
                <span className="text-sm font-medium pkmer-text-secondary">添加定制自动化</span>
                <span className="mt-1 max-w-[200px] text-xs pkmer-text-guide">
                  输入自然语言立刻生成结构化定时计划。
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {editingTask ? (
        <div className="pkmer-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="workflow-modal-title">
          <div className="pkmer-modal pkmer-modal--wide">
            <div className="pkmer-modal__head">
              <div className="flex items-center gap-3 min-w-0">
                <div className={getTypeIconClass(editingTask.type)}>
                  <Zap className="h-5 w-5" style={{ color: 'var(--accent-primary)' }} aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 id="workflow-modal-title" className="text-lg font-semibold pkmer-text-body truncate">
                    配置工作流
                  </h2>
                  <p className="mt-0.5 text-xs pkmer-text-muted truncate">{editingTask.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="rounded-xl p-2 pkmer-glass-pill"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="pkmer-modal__body space-y-6">
              <div>
                <label className="pkmer-field-label mb-2 block">执行频率 (Cron)</label>
                <input
                  type="text"
                  value={draftSchedule}
                  onChange={(e) => setDraftSchedule(e.target.value)}
                  className="pkmer-input-line w-full"
                />
              </div>
              <div>
                <label className="pkmer-field-label mb-2 block">执行节点脚本</label>
                <textarea
                  value={draftScript}
                  onChange={(e) => setDraftScript(e.target.value)}
                  spellCheck={false}
                  rows={14}
                  className="pkmer-terminal__body w-full min-h-[200px] resize-y rounded-lg border border-[color:var(--color-code-tabs)]"
                />
                <p className="mt-2 text-xs pkmer-text-muted">
                  保存后写入本机；实际定时仍以服务端 / 环境变量为准。
                </p>
              </div>
            </div>

            <div className="pkmer-modal__foot">
              <button type="button" onClick={() => setEditingTask(null)} className="pkmer-btn pkmer-btn--outline">
                取消
              </button>
              <button type="button" onClick={handleSaveWorkflowConfig} className="pkmer-btn pkmer-btn--accent">
                保存配置
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreating ? (
        <div className="pkmer-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-modal-title">
          <div className="pkmer-modal">
            <div className="pkmer-modal__head">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5" style={{ color: 'var(--color-brand-amber)' }} aria-hidden />
                <h2 id="create-modal-title" className="text-lg font-semibold pkmer-text-body">
                  通过对话创建新任务
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="rounded-xl p-2 pkmer-glass-pill"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="pkmer-modal__body">
              <p className="mb-4 text-sm pkmer-text-secondary">
                向 AI Dottie-Assistant 描述您希望自动执行的任务、触发的时间和需要连接到的数据源，系统会立刻为您编排。
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：每天下班前，检索我关联的所有 Git commits 记录生成一份极简日志发送到我的企业微信..."
                className="pkmer-glass-input h-32 w-full resize-none p-4 text-sm"
              />
            </div>

            <div className="pkmer-modal__foot">
              <button type="button" onClick={() => setIsCreating(false)} className="pkmer-btn pkmer-btn--outline">
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateSubmit}
                disabled={!prompt.trim()}
                className="pkmer-btn pkmer-btn--accent disabled:opacity-50"
              >
                生成结构化计划
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {terminalOpen ? (
        <div className="pkmer-modal-overlay z-40 items-end justify-center pb-6 pt-24">
          <div className="pkmer-terminal w-full max-w-4xl max-h-[min(420px,70vh)]">
            <div className="pkmer-terminal__chrome">
              <p className="text-xs font-mono">automation@assistant — live</p>
              <button
                type="button"
                onClick={() => setTerminalOpen(false)}
                className="rounded-lg p-1 pkmer-text-muted hover:text-[color:var(--color-ink)]"
                aria-label="关闭终端"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="pkmer-terminal__body max-h-[320px] space-y-1">
              {terminalLogs.length === 0 ? (
                <div className="pkmer-text-muted">Waiting for execution logs...</div>
              ) : (
                terminalLogs.map((line, idx) => <div key={idx}>{line}</div>)
              )}
            </div>
            {isWaitingInput ? (
              <div className="border-t border-[color:var(--color-code-tabs)] bg-[color:var(--color-code-tabs)] p-4">
                <p className="mb-2 text-xs" style={{ color: 'var(--warning)' }}>
                  检测到异常需你介入：{manualHint}
                </p>
                <div className="flex gap-2">
                  <input
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="输入处理命令，例如 git merge --continue"
                    className="pkmer-input-line flex-1 font-mono text-xs"
                  />
                  <button type="button" onClick={submitManualSolution} className="pkmer-btn pkmer-btn--accent shrink-0 text-xs">
                    继续执行
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
