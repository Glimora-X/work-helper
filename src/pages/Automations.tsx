import { useState } from 'react';
import { Bot, Clock, Play, MoreVertical, FileText, CheckSquare, GitBranch, Plus, Search, ToggleRight, ToggleLeft, X, Sparkles, Zap } from 'lucide-react';

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

const getWorkflowScript = (task: AutomationTask) => {
  return workflowScripts[task.id] ?? `// ${task.name} 运行定义
async function run() {
  console.log("Mock building workflow...");
  // TODO: Add implementation via prompt
}`;
};

const DEPLOY_API_BASE =
  (import.meta.env.VITE_DEPLOY_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/deploy';

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
  
  // Modal states
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
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

  const getIcon = (type: AutomationTask['type']) => {
    switch(type) {
      case 'code': return <GitBranch className="w-5 h-5 text-blue-500" />;
      case 'report': return <FileText className="w-5 h-5 text-purple-500" />;
      case 'jira': return <CheckSquare className="w-5 h-5 text-amber-500" />;
      default: return <Bot className="w-5 h-5 text-gray-500" />;
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
    <div className="flex flex-col h-full bg-[#FAFAFA] relative">
      <div className="p-8 md:p-12 pb-4 max-w-6xl mx-auto w-full flex flex-col h-full relative z-0">
        
        <header className="mb-6 shrink-0 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
              <Bot className="w-6 h-6 text-indigo-500" />
              自动化任务
            </h1>
            <p className="text-sm text-gray-500 mt-1">设置定时触发器接管环境维护、信息整理和周报总结等繁杂流程。</p>
          </div>
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> 新建任务
          </button>
        </header>

        {/* Toolbar */}
        <div className="mb-8 flex gap-4 items-center shrink-0">
          <div className="relative w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="搜索任务名称或规则..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-shadow"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto text-sm text-gray-500">
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block shadow-sm ring-2 ring-white"></span> {tasks.filter(t => t.active).length} 个运行中</div>
            <div className="w-px h-3 bg-gray-300 mx-2"></div>
            <span className="text-gray-400 text-xs">计划明细正在架构阶段</span>
          </div>
        </div>

        {/* Task Grid */}
        <div className="flex-1 overflow-y-auto pb-8 scrollbar-hide">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTasks.map(task => (
              <div 
                key={task.id} 
                className={`flex flex-col bg-white border ${task.active ? 'border-gray-200 hover:border-gray-300 shadow-sm' : 'border-gray-100 opacity-70'} rounded-2xl p-5 hover:shadow-md transition-all group`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className={"p-2.5 rounded-xl inline-flex shadow-sm " + 
                     (task.type === 'code' ? 'bg-blue-50/50 border border-blue-100' :
                      task.type === 'report' ? 'bg-purple-50/50 border border-purple-100' : 
                      'bg-amber-50/50 border border-amber-100'
                     )}>
                    {getIcon(task.type)}
                  </div>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => toggleTask(task.id)}
                      className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-900 transition-colors"
                      title={task.active ? "暂停任务" : "恢复任务"}
                    >
                      {task.active ? <ToggleRight className="w-6 h-6 text-indigo-500" /> : <ToggleLeft className="w-6 h-6 text-gray-300" />}
                    </button>
                    <button className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="mb-4 flex-1">
                   <h3 className={`font-semibold mb-1 cursor-pointer hover:underline ${task.active ? 'text-gray-900' : 'text-gray-500'}`}>
                     {task.name}
                   </h3>
                   <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                     {task.description}
                   </p>
                </div>

                <div className="pt-4 border-t border-gray-100 shrink-0">
                  <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 mb-2">
                    <span className="flex items-center gap-1.5 whitespace-nowrap"><Clock className="w-3.5 h-3.5" /> {task.schedule}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <button 
                      onClick={() => setEditingTask(task)}
                      className={`flex items-center text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${task.active ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200' : 'text-gray-400 bg-gray-50/50'}`}
                    >
                      配置工作流细则
                    </button>
                    {task.active && (
                       <button
                         onClick={() => startTaskRun(task)}
                         disabled={runningTaskId !== null}
                         className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md hover:bg-emerald-100 transition-colors border border-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed"
                       >
                         <Play className="w-3 h-3 fill-current" />
                         <span>{runningTaskId === task.id ? '执行中...' : task.nextRun}</span>
                       </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Add New Mock Card */}
            <div 
              onClick={() => setIsCreating(true)}
              className="flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-100 rounded-2xl p-6 transition-all cursor-pointer min-h-[220px]"
            >
               <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 mb-3 shadow-sm">
                 <Plus className="w-5 h-5" />
               </div>
               <span className="text-sm font-medium text-gray-600">添加定制自动化</span>
               <span className="text-xs text-gray-400 mt-1 max-w-[200px] text-center">输入自然语言立刻生成结构化定时计划。</span>
            </div>
          </div>
        </div>

      </div>

      {/* Editing Modal Overlay */}
      {editingTask && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-6 overflow-hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-full flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-500">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">配置工作流</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{editingTask.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingTask(null)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">执行频率 (Cron)</label>
                  <input type="text" defaultValue={editingTask.schedule} className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">执行节点脚本</label>
                  <div className="border border-gray-200 rounded-lg bg-[#1e1e1e] p-4 text-sm font-mono text-gray-300">
                    <pre>
                      <code>
                        {getWorkflowScript(editingTask)}
                      </code>
                    </pre>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">使用可视化编排或者直接修改触发代码。</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setEditingTask(null)} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200/50 rounded-lg transition-colors">
                取消
              </button>
              <button onClick={() => setEditingTask(null)} className="px-5 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors shadow-sm">
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Creating / Prompt Generation Modal Overlay */}
      {isCreating && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-6 overflow-hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 pb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-semibold text-gray-900">通过对话创建新任务</h2>
              </div>
              <button 
                onClick={() => setIsCreating(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 pt-0">
               <p className="text-sm text-gray-500 mb-4">
                 向 AI 助手描述您希望自动执行的任务、触发的时间和需要连接到的数据源，系统会立刻为您编排。
               </p>
               <textarea 
                 value={prompt}
                 onChange={(e) => setPrompt(e.target.value)}
                 placeholder="例如：每天下班前，检索我关联的所有 Git commits 记录生成一份极简日志发送到我的企业微信..."
                 className="w-full border border-gray-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-300 resize-none h-32 transition-all"
               ></textarea>
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setIsCreating(false)} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                取消
              </button>
              <button 
                onClick={handleCreateSubmit}
                disabled={!prompt.trim()}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 rounded-lg transition-colors shadow-sm cursor-pointer"
              >
                生成结构化计划
              </button>
            </div>
          </div>
        </div>
      )}

      {terminalOpen && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-gray-900/25 p-6">
          <div className="w-full max-w-4xl bg-[#111111] border border-[#2A2A2A] rounded-2xl overflow-hidden shadow-2xl">
            <div className="h-11 bg-[#1e1e1e] border-b border-[#2A2A2A] px-4 flex items-center justify-between">
              <span className="text-xs font-mono text-gray-300">automation@assistant - live terminal</span>
              <button onClick={() => setTerminalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-4 font-mono text-xs text-gray-300 space-y-1">
              {terminalLogs.length === 0 ? (
                <div className="text-gray-500">Waiting for execution logs...</div>
              ) : (
                terminalLogs.map((line, idx) => <div key={idx}>{line}</div>)
              )}
            </div>
            {isWaitingInput && (
              <div className="border-t border-[#2A2A2A] p-4 bg-[#161616]">
                <p className="text-xs text-yellow-300 mb-2">检测到异常需你介入：{manualHint}</p>
                <div className="flex gap-2">
                  <input
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="输入处理命令，例如 git merge --continue"
                    className="flex-1 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#333] text-xs text-gray-200 focus:outline-none"
                  />
                  <button
                    onClick={submitManualSolution}
                    className="px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 rounded-lg text-white"
                  >
                    继续执行
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
