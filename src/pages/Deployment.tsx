import { useState, useRef, useEffect, type FormEvent, type MouseEvent } from 'react';
import { Terminal, CheckCircle2, XCircle, Loader2, ArrowRight, Clock, Box, Play, Plus, X, Trash2, Save, FilePlus, Tag, GitBranch } from 'lucide-react';

type NodeStatus = 'idle' | 'running' | 'success' | 'failed';
type Phase = 'idle' | 'draft' | 'executing' | 'completed';

interface DeployNode {
  id: string;
  name: string;
  status: NodeStatus;
  duration?: string;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'system' | 'prompt';
}

interface Template {
  id: string;
  name: string;
  nodes: string[];
}

const INITIAL_TEMPLATES: Template[] = [
  { id: 'tpl_1', name: '全栈核心链路', nodes: ['auth-service', 'biz-core', 'cc-web'] },
  { id: 'tpl_2', name: '纯前端更新', nodes: ['cc-web', 'admin-dashboard'] },
  { id: 'tpl_3', name: '微服务热更', nodes: ['user-center', 'payment-gateway'] }
];

const DEPLOY_API_BASE =
  (import.meta.env.VITE_DEPLOY_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/deploy';

export default function Deployment() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [command, setCommand] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [pipeline, setPipeline] = useState<DeployNode[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [parsedJira, setParsedJira] = useState<string | null>(null);
  const [parsedBranch, setParsedBranch] = useState<string | null>(null);

  // Template Management State
  const [templates, setTemplates] = useState<Template[]>(INITIAL_TEMPLATES);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Node Management State
  const [isAddingNode, setIsAddingNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');

  // Auto scroll terminal logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    setLogs(prev => [...prev, {
      id: Date.now() + Math.random(),
      timestamp: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`,
      message,
      type
    }]);
  };

  // Simulate NLP parsing or Rule fetching
  const handleInputSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!command.trim() || phase === 'executing') return;

    const cmd = command.trim();
    setIsResolving(true);
    setPhase('idle');
    setParsedJira(null);
    setParsedBranch(null);
    setLogs([]);
    addLog(`System identifying intent for: "${cmd}"...`, 'system');

    await new Promise(resolve => setTimeout(resolve, 800));

    // Keyword extraction
    const tempJiraMatch = cmd.match(/([a-zA-Z]+-\d+)/);
    const tempBranchMatch = cmd.match(/(?:branch|b|分支)[:\s]+([^\s]+)/i) || cmd.match(/(feature\/[^\s]+|bugfix\/[^\s]+|hotfix\/[^\s]+)/i);

    const detectedJira = tempJiraMatch ? tempJiraMatch[1].toUpperCase() : null;
    const detectedBranch = tempBranchMatch ? tempBranchMatch[1] : null;

    setParsedJira(detectedJira);
    setParsedBranch(detectedBranch);

    let resolvedNodes: string[] = [];
    if (cmd.includes('然后') || cmd.includes('再')) {
      resolvedNodes = ['auth-service', 'biz-core', 'cc-web'];
      addLog(`[NLP] Defined cascading sequence from natural language.`, 'info');
    } else if (detectedJira) {
      try {
        const res = await fetch(
          `${DEPLOY_API_BASE}/jira/resolution/${encodeURIComponent(detectedJira)}`
        );
        const data = (await res.json()) as {
          nodes?: string[];
          source?: string;
          message?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || res.statusText);
        resolvedNodes =
          Array.isArray(data.nodes) && data.nodes.length > 0 ? data.nodes : ['biz-core', 'cc-web'];
        const label = data.source === 'jira' ? 'Jira' : 'Jira (fallback)';
        addLog(
          `[${label}] ${data.message || `Ticket ${detectedJira} → ${resolvedNodes.join(', ')}`}`,
          'info'
        );
      } catch (err) {
        resolvedNodes = ['biz-core', 'cc-web'];
        addLog(
          `[Jira API] ${err instanceof Error ? err.message : String(err)} — 使用默认节点: ${resolvedNodes.join(', ')}`,
          'warn'
        );
      }
    } else {
      resolvedNodes = [cmd];
      addLog(`[System] Standalone app recognized.`, 'info');
    }

    if (detectedBranch) {
      addLog(`[Git] Explicit branch target override: ${detectedBranch}`, 'info');
    }

    setPipeline(resolvedNodes.map(name => ({ id: Math.random().toString(), name, status: 'idle' })));
    setIsResolving(false);
    setPhase('draft');
    addLog(`Pipeline Draft created. Awaiting user confirmation.`, 'prompt');
  };

  // --- Template Interactions ---
  const applyTemplate = (nodes: string[]) => {
    setPipeline(nodes.map(name => ({ id: Math.random().toString(), name, status: 'idle' })));
    setPhase('draft');
    setLogs([]);
    addLog(`Applied predefined template. Awaiting execution.`, 'system');
  };

  const handleDeleteTemplate = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setTemplates(prev => prev.filter(t => t.id !== id));
    addLog(`Template deleted.`, 'system');
  };

  const handleSaveTemplate = (e: FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    const newTpl: Template = {
      id: 'tpl_' + Date.now(),
      name: newTemplateName.trim(),
      nodes: pipeline.map(n => n.name)
    };
    setTemplates(prev => [...prev, newTpl]);
    setIsSavingTemplate(false);
    setNewTemplateName('');
    addLog(`Saved current draft as new template: [${newTpl.name}]`, 'system');
  };

  // --- Node Interactions ---
  const removeNode = (id: string) => {
    setPipeline(prev => prev.filter(n => n.id !== id));
  };

  const handleAddNode = (e: FormEvent) => {
    e.preventDefault();
    if (!newNodeName.trim()) return;
    setPipeline(prev => [...prev, { id: Math.random().toString(), name: newNodeName.trim(), status: 'idle' }]);
    setNewNodeName('');
    setIsAddingNode(false);
  };

  const executePipeline = async () => {
    if (pipeline.length === 0) return;
    setPhase('executing');
    addLog(`Initiating configured pipeline...`, 'system');

    let updatedPipeline = [...pipeline];
    for (let i = 0; i < updatedPipeline.length; i++) {
      const node = updatedPipeline[i];
      setActiveTask(node.name);
      
      // Update UI to running for current node
      updatedPipeline = updatedPipeline.map(n => n.id === node.id ? { ...n, status: 'running' } : n);
      setPipeline(updatedPipeline);
      
      addLog(`[Jenkins] Preparing trigger for job path: ${node.name}`, 'info');

      try {
        const t0 = performance.now();
        const resp = await fetch(`${DEPLOY_API_BASE}/jenkins/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobPath: node.name,
            jiraId: parsedJira || undefined,
            branch: parsedBranch || undefined,
            pollQueue: true,
            pollTimeoutMs: 120000,
          }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          simulated?: boolean;
          message?: string;
          parameters?: Record<string, string>;
          results?: { message?: string; buildUrl?: string; buildNumber?: number; error?: string }[];
          error?: string;
          failedAt?: string;
        };

        if (!resp.ok) {
          throw new Error(data.error || data.failedAt || `HTTP ${resp.status}`);
        }

        if (data.simulated) {
          addLog(
            `[Jenkins] ${data.message || 'BFF 未配置 Jenkins，使用本地模拟进度。'}`,
            'warn'
          );
          addLog(
            `[Jenkins] (simulated) jobPath=${node.name} params=${JSON.stringify(data.parameters || {})}`,
            'system'
          );
          await new Promise((r) => setTimeout(r, 600));
          addLog(`[${node.name}] Job started (simulated). Building container...`, 'info');
          await new Promise((r) => setTimeout(r, 1000));
          addLog(`[${node.name}] Pushing to registry...`, 'info');
          await new Promise((r) => setTimeout(r, 600));
          addLog(`[${node.name}] Deployed successfully (simulated).`, 'success');
        } else {
          const jobResult = data.results?.[0];
          if (jobResult?.error) throw new Error(jobResult.error);
          addLog(`[Jenkins] ${jobResult?.message || 'Triggered.'}`, 'info');
          if (jobResult?.buildUrl) {
            addLog(`[Jenkins] Build: ${jobResult.buildUrl}`, 'system');
          }
          addLog(`[${node.name}] Deployed successfully.`, 'success');
        }

        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        updatedPipeline = updatedPipeline.map((n) =>
          n.id === node.id ? { ...n, status: 'success', duration: `${elapsed}s` } : n
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addLog(`[Jenkins ERROR] Failed to trigger ${node.name}: ${message}`, 'error');
        updatedPipeline = updatedPipeline.map((n) =>
          n.id === node.id ? { ...n, status: 'failed' } : n
        );
        setPipeline(updatedPipeline);
        return;
      }

      setPipeline(updatedPipeline);

      if (i < updatedPipeline.length - 1) {
        addLog(`[DAG] Proceeding to dependent node: ${updatedPipeline[i+1].name}`, 'system');
      }
    }
    
    setActiveTask(null);
    setPhase('completed');
    addLog('Pipeline execution completed successfully.', 'success');
  };

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA]">
      <div className="p-8 md:p-12 pb-4 max-w-6xl mx-auto w-full">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">工程部署</h1>
          <p className="text-sm text-gray-500 mt-1">组合依赖关系，构建有向无环图 (DAG) 流水线。</p>
        </header>

        {/* Command Input Bar */}
        <form onSubmit={handleInputSubmit} className="relative mb-6">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            {isResolving ? (
              <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
            ) : (
              <Terminal className="h-5 w-5 text-gray-400" />
            )}
          </div>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={phase === 'executing' || isResolving}
            className="block w-full pl-11 pr-4 py-4 bg-white border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-shadow disabled:bg-gray-50"
            placeholder="输入自然语言、Jira 号，或从下方配置链路..."
          />
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-270px)] min-h-[450px]">
          
          {/* Left: Pipeline Configuration / Visualization */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            
            {phase === 'idle' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">模板与快速构建</h2>
                  <button 
                    onClick={() => { setPhase('draft'); setPipeline([]); setLogs([]); setIsSavingTemplate(false); }}
                    className="text-[11px] flex items-center gap-1 text-blue-600 hover:text-blue-800"
                  >
                    <FilePlus className="w-3 h-3" /> 创建空白链路
                  </button>
                </div>
                 
                 <div className="flex flex-col gap-2">
                   {templates.length === 0 ? (
                     <div className="text-[11px] text-gray-400 bg-white border border-gray-100 rounded-lg p-3 text-center">暂无保存的模板</div>
                   ) : templates.map(tpl => (
                     <div 
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl.nodes)}
                      className="group flex items-center justify-between p-2.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-all"
                     >
                       <div className="flex items-center gap-3 overflow-hidden flex-1 pr-2">
                         <span className="text-[13px] font-medium text-gray-800 whitespace-nowrap">{tpl.name}</span>
                         <span className="text-gray-300 text-xs">|</span>
                         <div className="flex items-center text-[11px] text-gray-400 font-mono truncate gap-x-1.5 flex-1">
                           {tpl.nodes.map((n, i) => (
                             <span key={i} className="flex items-center whitespace-nowrap">
                               {n}
                               {i < tpl.nodes.length - 1 && <ArrowRight className="w-2.5 h-2.5 ml-1.5 text-gray-300 shrink-0 inline" />}
                             </span>
                           ))}
                         </div>
                       </div>
                       <button 
                          onClick={(e) => handleDeleteTemplate(e, tpl.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-1 ml-2 shrink-0"
                          title="删除模板"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                     </div>
                   ))}
                 </div>

                 <div className="mt-4 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center py-5 text-sm text-gray-400 bg-gray-50/50">
                    <Box className="w-5 h-5 mb-2 text-gray-300" />
                    <p className="text-xs">支持使用自然语言构建</p>
                    <p className="text-[10px] mt-1 text-gray-400/80 mx-4 text-center">"帮我先发 auth 服务再发 admin 页面"</p>
                 </div>
              </div>
            )}

            {(phase === 'draft' || phase === 'executing' || phase === 'completed') && (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">DAG 依赖编排视图</h2>
                  {phase === 'draft' && (
                    <div className="flex items-center gap-3">
                      {isSavingTemplate ? (
                        <form onSubmit={handleSaveTemplate} className="flex items-center gap-1.5">
                          <input 
                            type="text" 
                            autoFocus
                            value={newTemplateName} 
                            onChange={e => setNewTemplateName(e.target.value)} 
                            placeholder="模板名称..." 
                            className="text-xs border-b border-gray-300 py-0.5 focus:outline-none focus:border-gray-800 bg-transparent w-24" 
                          />
                          <button type="submit" className="text-xs text-blue-600 font-medium">应用</button>
                          <button type="button" onClick={() => setIsSavingTemplate(false)} className="text-xs text-gray-400">取消</button>
                        </form>
                      ) : (
                        <button onClick={() => setIsSavingTemplate(true)} disabled={pipeline.length === 0} className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50">
                          <Save className="w-3 h-3"/> 存为模板
                        </button>
                      )}
                      <div className="h-3 w-px bg-gray-200"></div>
                      <button onClick={() => setPhase('idle')} className="text-[11px] text-gray-500 hover:text-gray-900">重新选用</button>
                    </div>
                  )}
                </div>

                {(parsedJira || parsedBranch) && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {parsedJira && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-mono shadow-sm">
                        <Tag className="w-3 h-3" />
                        Ticket: {parsedJira}
                      </div>
                    )}
                    {parsedBranch && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-mono shadow-sm">
                        <GitBranch className="w-3 h-3" />
                        Branch: {parsedBranch}
                      </div>
                    )}
                  </div>
                )}
                
                <div className="flex-1 overflow-y-auto mb-4 bg-white border border-gray-200 rounded-xl px-6 py-4 shadow-sm relative scrollbar-hide">
                  {pipeline.length === 0 && !isAddingNode && (
                     <div className="h-full flex flex-col items-center justify-center text-gray-400 text-[11px]">
                       此时链路为空，请添加节点。
                     </div>
                  )}

                  <div className="flex flex-col items-center w-full py-2">
                    {pipeline.map((node, index) => (
                      <div key={node.id} className="relative flex flex-col items-center group w-full max-w-[240px]">
                        <div className={`w-full p-3 rounded-lg border-2 flex items-center justify-between transition-all bg-white relative z-10 ${
                          node.status === 'running' ? 'border-blue-400 ring-4 ring-blue-50' : 
                          node.status === 'success' ? 'border-gray-900' : 'border-gray-200 hover:border-gray-400'
                        }`}>
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <div className="flex-shrink-0">
                              {node.status === 'idle' && <div className="w-2 h-2 rounded-full bg-gray-300" />}
                              {node.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                              {node.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-gray-900" />}
                            </div>
                            <p className={`text-xs font-bold font-mono tracking-tight truncate ${node.status === 'idle' ? 'text-gray-700' : 'text-gray-900'}`}>
                              {node.name}
                            </p>
                          </div>
                          
                          {phase === 'draft' && (
                            <button onClick={() => removeNode(node.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity ml-2 shrink-0 bg-white shadow-sm rounded-full p-0.5">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {node.duration && (
                            <div className="flex items-center gap-1 text-[10px] font-mono text-gray-400 shrink-0">
                              <Clock className="w-2.5 h-2.5" /> {node.duration}
                            </div>
                          )}
                        </div>
                        
                        {/* Connection Line */}
                        {(index < pipeline.length - 1 || isAddingNode) && (
                          <div className="flex flex-col items-center w-full relative h-[26px]">
                            <div className={`w-[2px] h-full ${node.status === 'success' ? 'bg-gray-900' : 'bg-gray-200'}`} />
                            <div className={`absolute bottom-0 w-1.5 h-1.5 border-b-[2px] border-r-[2px] ${node.status === 'success' ? 'border-gray-900' : 'border-gray-200'}`} style={{ transform: 'translateY(1px) rotate(45deg)' }} />
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Inline Add Node */}
                    {phase === 'draft' && (
                      <div className={`w-full flex justify-center max-w-[240px] ${pipeline.length === 0 ? 'mt-0' : ''}`}>
                        {isAddingNode ? (
                          <div className="w-full relative z-10 p-2.5 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-between">
                            <form onSubmit={handleAddNode} className="flex items-center w-full gap-2">
                              <input
                                autoFocus
                                type="text"
                                value={newNodeName}
                                onChange={(e) => setNewNodeName(e.target.value)}
                                className="w-full bg-transparent text-xs outline-none text-gray-800 font-mono placeholder:text-gray-400"
                                placeholder="输入节点名称..."
                              />
                              <button type="submit" disabled={!newNodeName.trim()} className="text-gray-400 hover:text-green-600 disabled:opacity-50">
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => setIsAddingNode(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-4 h-4" />
                              </button>
                            </form>
                          </div>
                        ) : (
                          <div className={`flex justify-center w-full ${pipeline.length === 0 ? '' : 'pt-[2px]'}`}>
                            <button 
                              onClick={() => setIsAddingNode(true)} 
                              className="text-[11px] text-gray-500 hover:text-gray-900 border border-dashed border-gray-300 rounded px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center gap-1 shadow-sm relative z-10"
                            >
                              <Plus className="w-3 h-3" /> 点击添加节点
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {phase === 'draft' && (
                  <button 
                    onClick={executePipeline}
                    disabled={pipeline.length === 0}
                    className="w-full bg-gray-900 text-white rounded-xl py-3.5 text-sm font-medium hover:bg-black flex items-center justify-center gap-2 shadow-sm transition-all hover:shadow-md disabled:bg-gray-300 disabled:cursor-not-allowed shrink-0"
                  >
                    <Play className="w-4 h-4" fill="currentColor" /> 开始构建与部署
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right: Terminal Logs */}
          <div className="lg:col-span-7 flex flex-col bg-[#111111] rounded-xl overflow-hidden shadow-lg border border-gray-800 h-full">
            <div className="h-10 bg-[#1E1E1E] flex items-center px-4 border-b border-[#2A2A2A] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
              </div>
              <p className="ml-4 text-[11px] font-mono text-gray-400">root@assistant:~  —  System Log & Console</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs md:text-sm text-gray-300 leading-relaxed selection:bg-gray-600">
              {logs.length === 0 ? (
                <div className="text-gray-600">Waiting for actions...</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {logs.map(log => (
                    <div key={log.id} className="flex gap-4">
                      <span className="text-gray-500 shrink-0 select-none">[{log.timestamp}]</span>
                      <span className={`break-all ${
                        log.type === 'error' ? 'text-red-400' :
                        log.type === 'success' ? 'text-green-400' :
                        log.type === 'warn' ? 'text-yellow-400' :
                        log.type === 'system' ? 'text-blue-300' :
                        log.type === 'prompt' ? 'text-purple-300 font-bold' :
                        'text-gray-300'
                      }`}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
            
            {(activeTask || isResolving) && (
              <div className="h-10 bg-[#1A1A1A] border-t border-[#2A2A2A] flex items-center px-4 shrink-0">
                <p className="text-[11px] font-mono text-gray-400 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  {isResolving ? 'Executing task orchestrator...' : 'Running active pipeline task...'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
