import { useState, useRef, useEffect, type FormEvent, type MouseEvent } from 'react';
import { Terminal, CheckCircle2, XCircle, Loader2, ArrowRight, Clock, Box, Play, Plus, X, Trash2, Save, FilePlus, Tag, GitBranch, ExternalLink, ShieldAlert } from 'lucide-react';

type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'queued';
type Phase = 'idle' | 'draft' | 'executing' | 'completed';

interface DeployNode {
  id: string;
  name: string;
  status: NodeStatus;
  duration?: string;
  queueUrl?: string;
  buildUrl?: string;
  buildNumber?: number;
  branch?: string;
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

interface DeployProjectOption {
  id: string;
  label: string;
  defaultBranch: string;
}

interface DeployHealth {
  jenkinsConfigured: boolean;
  jenkinsMissing?: string[];
  deployConfigError?: string;
  projects?: DeployProjectOption[];
  jiraConfigured: boolean;
}

const INITIAL_TEMPLATES: Template[] = [
  { id: 'tpl_9', name: 'MDF', nodes: ['mdf', 'saas-cc-web-metapage'] },
  { id: 'tpl_8', name: 'MDF—BIZ', nodes: ['mdf-biz', 'saas-cc-web-metapage'] },
  { id: 'tpl_7', name: 'UI-WEB', nodes: ['mdf-ui-web', 'saas-cc-web-metapage'] },
  { id: 'tpl_11', name: 'BIZ-CORE', nodes: ['biz-core','saas-cc-web','hsy-h5-mainapp'] },
  { id: 'tpl_12', name: 'SAAS-CC-NODE-METASERVER', nodes: ['saas-cc-node-metaserver', 'saas-cc-node'] },
];

const DEPLOY_API_BASE =
  ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_DEPLOY_API_BASE ?? '/api/deploy').replace(/\/$/, '') ||
  '/api/deploy';

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
  const [health, setHealth] = useState<DeployHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Template Management State
  const [templates, setTemplates] = useState<Template[]>(() => {
    try {
      const saved = localStorage.getItem('deploy_templates_v1');
      return saved ? JSON.parse(saved) : INITIAL_TEMPLATES;
    } catch (e) {
      return INITIAL_TEMPLATES;
    }
  });

  useEffect(() => {
    localStorage.setItem('deploy_templates_v1', JSON.stringify(templates));
  }, [templates]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Left panel state
  const [activeLeftTab, setActiveLeftTab] = useState<'project' | 'template'>('template');
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('deploy_recent_v1') || '[]'); } catch { return []; }
  });
  const [favoritedIds, setFavoritedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('deploy_favorites_v1') || '[]'); } catch { return []; }
  });

  // Node Management State
  const [isAddingNode, setIsAddingNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const deployProjects = health?.projects || [];
  const projectLabel = (id: string) => deployProjects.find((project) => project.id === id)?.label || id;

  // Auto scroll terminal logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    let cancelled = false;
    const loadHealth = async () => {
      try {
        const res = await fetch(`${DEPLOY_API_BASE}/health`);
        const data = (await res.json()) as DeployHealth;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) {
          setHealth(data);
          setHealthError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

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
  const applyTemplate = (nodes: string[], tplId?: string) => {
    void tplId; // tplId reserved, recent tracking happens on actual execution
    setPipeline(nodes.map(name => ({ id: Math.random().toString(), name, status: 'idle' })));
    setPhase('draft');
    setLogs([]);
    addLog(`Applied predefined template. Awaiting execution.`, 'system');
  };

  const toggleFavorite = (tplId: string) => {
    setFavoritedIds(prev => {
      const next = prev.includes(tplId) ? prev.filter(id => id !== tplId) : [...prev, tplId];
      localStorage.setItem('deploy_favorites_v1', JSON.stringify(next));
      return next;
    });
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
    const selectedProject = newNodeName.trim() || deployProjects[0]?.id || '';
    if (!selectedProject) return;
    setPipeline(prev => [...prev, { id: Math.random().toString(), name: selectedProject, status: 'idle' }]);
    setNewNodeName('');
    setIsAddingNode(false);
  };

  const executePipeline = async () => {
    if (pipeline.length === 0) return;
    if (health?.jenkinsConfigured === false) {
      addLog(
        `Jenkins 未配置，缺失: ${(health.jenkinsMissing || []).join(', ') || 'unknown'}。部署已阻止。`,
        'error'
      );
      return;
    }
    setPhase('executing');
    addLog(`Initiating configured pipeline...`, 'system');

    // Record this execution as recently used (match by node list against templates)
    const nodeKey = pipeline.map(n => n.name).join(',');
    const matchedTpl = templates.find(t => t.nodes.join(',') === nodeKey);
    if (matchedTpl) {
      setRecentIds(prev => {
        const next = [matchedTpl.id, ...prev.filter(id => id !== matchedTpl.id)].slice(0, 5);
        localStorage.setItem('deploy_recent_v1', JSON.stringify(next));
        return next;
      });
    }

    let updatedPipeline = [...pipeline];
    for (let i = 0; i < updatedPipeline.length; i++) {
      const node = updatedPipeline[i];
      setActiveTask(node.name);
      
      // Update UI to running for current node
      updatedPipeline = updatedPipeline.map(n => n.id === node.id ? { ...n, status: 'running' } : n);
      setPipeline(updatedPipeline);
      
      addLog(`[Jenkins] Preparing trigger for project: ${node.name}`, 'info');

      try {
        const t0 = performance.now();
        const resp = await fetch(`${DEPLOY_API_BASE}/jenkins/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: node.name,
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
          results?: { message?: string; queueUrl?: string; buildUrl?: string; buildNumber?: number; branch?: string; projectLabel?: string; error?: string }[];
          error?: string;
          failedAt?: string;
        };

        if (!resp.ok) {
          throw new Error(data.error || data.failedAt || `HTTP ${resp.status}`);
        }

        if (data.simulated) {
          throw new Error('Server returned simulated deployment result; production deployment requires Jenkins.');
        }

        const jobResult = data.results?.[0];
        if (jobResult?.error) throw new Error(jobResult.error);
        addLog(`[Jenkins] ${jobResult?.message || 'Triggered.'}`, 'info');
        if (jobResult?.branch) {
          addLog(`[Jenkins] Branch resolved for ${node.name}: ${jobResult.branch}`, 'system');
        }
        if (jobResult?.queueUrl) {
          addLog(`[Jenkins] Queue: ${jobResult.queueUrl}`, 'system');
        }
        if (jobResult?.buildUrl) {
          addLog(`[Jenkins] Build: ${jobResult.buildUrl}`, 'system');
        }

        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        const nextStatus: NodeStatus = jobResult?.buildUrl ? 'running' : 'queued';
        updatedPipeline = updatedPipeline.map((n) =>
          n.id === node.id
            ? {
                ...n,
                status: nextStatus,
                duration: `${elapsed}s`,
                queueUrl: jobResult?.queueUrl,
                buildUrl: jobResult?.buildUrl,
                buildNumber: jobResult?.buildNumber,
                branch: jobResult?.branch,
              }
            : n
        );
        setPipeline(updatedPipeline);

        if (nextStatus === 'queued') {
          addLog(
            `[${node.name}] Jenkins 已接收入队，但未在超时前返回 Build URL；停止后续依赖节点。`,
            'warn'
          );
          setActiveTask(null);
          setPhase('completed');
          return;
        }

        // ---- Wait for build to COMPLETE before proceeding to next node ----
        // Only needed when there are more nodes after this one.
        if (jobResult?.buildUrl && i < updatedPipeline.length - 1) {
          addLog(`[${node.name}] Build #${jobResult.buildNumber} 已启动，等待执行完成后再触发下一节点...`, 'system');
          const buildResultResp = await fetch(`${DEPLOY_API_BASE}/jenkins/build-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              buildUrl: jobResult.buildUrl,
              timeoutMs: 1800000, // 30 min max wait
            }),
          });
          const buildResult = (await buildResultResp.json().catch(() => ({}))) as {
            building?: boolean;
            result?: string | null;
            duration?: number;
            error?: string;
          };

          if (buildResult.error && buildResult.building) {
            // Timed out waiting for build
            addLog(`[${node.name}] 等待 build 完成超时：${buildResult.error}，中断后续节点。`, 'warn');
            updatedPipeline = updatedPipeline.map(n =>
              n.id === node.id ? { ...n, status: 'queued' } : n
            );
            setPipeline(updatedPipeline);
            setActiveTask(null);
            setPhase('completed');
            return;
          }

          if (buildResult.result !== 'SUCCESS') {
            const reason = buildResult.result ?? buildResult.error ?? 'UNKNOWN';
            addLog(`[${node.name}] Build 结果为 ${reason}，中断后续依赖节点。`, 'error');
            updatedPipeline = updatedPipeline.map(n =>
              n.id === node.id ? { ...n, status: 'failed' } : n
            );
            setPipeline(updatedPipeline);
            setActiveTask(null);
            setPhase('completed');
            return;
          }

          const buildDuration = buildResult.duration ? `${(buildResult.duration / 1000).toFixed(0)}s` : elapsed + 's';
          addLog(`[${node.name}] ✅ Build SUCCESS (耗时 ${buildDuration})`, 'success');
          updatedPipeline = updatedPipeline.map(n =>
            n.id === node.id ? { ...n, status: 'success', duration: buildDuration } : n
          );
          setPipeline(updatedPipeline);
        } else {
          // Last node (or only node): mark as success when build URL is present
          if (jobResult?.buildUrl) {
            addLog(`[${node.name}] Jenkins build confirmed.`, 'success');
          }
          updatedPipeline = updatedPipeline.map(n =>
            n.id === node.id ? { ...n, status: jobResult?.buildUrl ? 'success' : 'queued' } : n
          );
          setPipeline(updatedPipeline);
        }

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addLog(`[Jenkins ERROR] Failed to trigger ${node.name}: ${message}`, 'error');
        updatedPipeline = updatedPipeline.map((n) =>
          n.id === node.id ? { ...n, status: 'failed' } : n
        );
        setPipeline(updatedPipeline);
        setActiveTask(null);
        return;
      }

      if (i < updatedPipeline.length - 1) {
        addLog(`[DAG] Proceeding to dependent node: ${updatedPipeline[i+1].name}`, 'system');
      }
    }
    
    setActiveTask(null);
    setPhase('completed');
    addLog('Pipeline execution completed successfully.', 'success');
  };

  const recentTemplates = recentIds.map(id => templates.find(t => t.id === id)).filter(Boolean) as Template[];
  const favoritedTemplates = templates.filter(t => favoritedIds.includes(t.id));

  return (
    <div className="flex min-h-0 flex-col bg-[#F5F5F7] overflow-hidden">
      {/* ── Top Header Bar ── */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-gray-900 tracking-tight leading-none">工程部署</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">组合依赖关系，构建有向无环图 (DAG) 流水线</p>
        </div>
        {/* Health Badges */}
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          {healthError ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700">
              <ShieldAlert className="h-3 w-3" />部署 API 不可用
            </span>
          ) : health ? (
            <>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${health.jenkinsConfigured ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {health.jenkinsConfigured ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                Jenkins {health.jenkinsConfigured ? `已配置 · ${deployProjects.length} 项目` : '不可用'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${health.jiraConfigured ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                {health.jiraConfigured ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                Jira {health.jiraConfigured ? '已配置' : 'fallback'}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />检查配置...
            </span>
          )}
        </div>
        {/* Command Input */}
        <form onSubmit={handleInputSubmit} className="relative w-72 shrink-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            {isResolving ? <Loader2 className="h-4 w-4 text-gray-400 animate-spin" /> : <Terminal className="h-4 w-4 text-gray-400" />}
          </div>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={phase === 'executing' || isResolving}
            className="block w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-shadow disabled:opacity-60"
            placeholder="输入自然语言 / Jira 号..."
          />
        </form>
      </div>

      {/* ── Three-column Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT NAV ── */}
        <div className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">

          {/* ⭐ 最近使用 */}
          <div className="px-3 pt-2.5 pb-1.5">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <span>⭐</span> 最近使用
            </p>
            {recentTemplates.length === 0 ? (
              <p className="text-[10px] text-gray-300 pl-0.5">暂无记录</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {recentTemplates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl.nodes, tpl.id)}
                    className="px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-[10px] text-gray-600 truncate max-w-full transition-colors"
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-3 border-t border-gray-100" />

          {/* 📌 收藏 */}
          <div className="px-3 pt-1.5 pb-1.5">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <span>📌</span> 收藏
            </p>
            {favoritedTemplates.length === 0 ? (
              <p className="text-[10px] text-gray-300 pl-0.5">hover 模板可收藏</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {favoritedTemplates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl.nodes, tpl.id)}
                    className="px-2 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-[10px] text-amber-700 border border-amber-200 truncate max-w-full transition-colors"
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-3 border-t border-gray-100" />


          {/* Tab: 工程 | 模板 */}
          <div className="px-3 pt-2 shrink-0">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-medium">
              <button
                onClick={() => setActiveLeftTab('project')}
                className={`flex-1 py-1.5 transition-colors ${activeLeftTab === 'project' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >工程</button>
              <button
                onClick={() => setActiveLeftTab('template')}
                className={`flex-1 py-1.5 transition-colors ${activeLeftTab === 'template' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              >模板</button>
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
            {activeLeftTab === 'project' ? (
              <div className="flex flex-col gap-px">
                {deployProjects.length === 0 ? (
                  <p className="text-[10px] text-gray-300 pl-1 pt-1">无可用工程</p>
                ) : deployProjects.map(proj => (
                  <button
                    key={proj.id}
                    onClick={() => applyTemplate([proj.id])}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-between gap-2 group"
                  >
                    <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">{proj.label}</span>
                    <span className="shrink-0 text-[10px] font-mono text-gray-400 bg-gray-100 group-hover:bg-gray-200 px-1.5 py-0.5 rounded transition-colors max-w-[72px] truncate">{proj.defaultBranch}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-px">
                <button
                  onClick={() => { setPhase('draft'); setPipeline([]); setLogs([]); setIsSavingTemplate(false); }}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-blue-50 text-[11px] text-blue-600 flex items-center gap-1 transition-colors mb-0.5"
                >
                  <FilePlus className="w-3 h-3 shrink-0" /> 创建空白链路
                </button>
                {templates.length === 0 ? (
                  <p className="text-[10px] text-gray-300 pl-1 pt-1">暂无模板</p>
                ) : templates.map(tpl => (
                  <div
                    key={tpl.id}
                    className="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => applyTemplate(tpl.nodes, tpl.id)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      <span className="text-[11px] text-gray-700 truncate">{tpl.name}</span>
                      {tpl.nodes.length > 1 && (
                        <span className="shrink-0 text-[9px] font-mono text-gray-400 bg-gray-100 px-1 py-0.5 rounded">{tpl.nodes.length}步</span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(tpl.id); }}
                        className={`p-0.5 rounded text-xs ${favoritedIds.includes(tpl.id) ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                        title={favoritedIds.includes(tpl.id) ? '取消收藏' : '收藏'}
                      >📌</button>
                      <button
                        onClick={(e) => handleDeleteTemplate(e, tpl.id)}
                        className="p-0.5 rounded text-gray-300 hover:text-red-500"
                        title="删除"
                      ><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── MIDDLE: DAG Editor ── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">
          {/* DAG toolbar */}
          <div className="shrink-0 h-10 bg-white border-b border-gray-100 flex items-center px-4 gap-3">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">DAG 依赖编排</span>
            {(parsedJira || parsedBranch) && (
              <div className="flex items-center gap-2">
                {parsedJira && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-mono">
                    <Tag className="w-2.5 h-2.5" />{parsedJira}
                  </span>
                )}
                {parsedBranch && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded text-[10px] font-mono">
                    <GitBranch className="w-2.5 h-2.5" />{parsedBranch}
                  </span>
                )}
              </div>
            )}
            <div className="flex-1" />
            {phase === 'draft' && (
              <div className="flex items-center gap-2">
                {isSavingTemplate ? (
                  <form onSubmit={handleSaveTemplate} className="flex items-center gap-1.5">
                    <input
                      type="text" autoFocus value={newTemplateName}
                      onChange={e => setNewTemplateName(e.target.value)}
                      placeholder="模板名称..."
                      className="text-[11px] border-b border-gray-300 py-0.5 focus:outline-none focus:border-gray-800 bg-transparent w-24"
                    />
                    <button type="submit" className="text-[11px] text-blue-600 font-medium">确认</button>
                    <button type="button" onClick={() => setIsSavingTemplate(false)} className="text-[11px] text-gray-400">取消</button>
                  </form>
                ) : (
                  <button onClick={() => setIsSavingTemplate(true)} disabled={pipeline.length === 0}
                    className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-40">
                    <Save className="w-3 h-3" />存为模板
                  </button>
                )}
                <div className="h-3 w-px bg-gray-200" />
                <button onClick={() => setPhase('idle')} className="text-[11px] text-gray-400 hover:text-gray-700">重新选用</button>
              </div>
            )}
          </div>

          {/* DAG Canvas */}
          <div className="flex-1 overflow-y-auto bg-[#FAFAFA] flex flex-col items-center py-6 scrollbar-hide">
            {phase === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Box className="w-8 h-8 mb-3 text-gray-200" />
                <p className="text-sm text-gray-400">从菜单中进入部署页后，可在此选择模板，或通过顶部输入框描述部署意图</p>
                <p className="text-[11px] text-gray-300 mt-1.5">"帮我先发 auth 服务再发 admin 页面"</p>
              </div>
            )}

            {(phase === 'draft' || phase === 'executing' || phase === 'completed') && (
              <div className="flex flex-col items-center w-full max-w-[260px]">
                {pipeline.length === 0 && !isAddingNode && (
                  <p className="text-[11px] text-gray-400 mb-4">链路为空，请添加节点</p>
                )}

                {pipeline.map((node, index) => (
                  <div key={node.id} className="relative flex flex-col items-center group w-full">
                    <div className={`w-full p-3 rounded-xl border-2 flex items-center justify-between transition-all bg-white relative z-10 shadow-sm ${
                      node.status === 'running' ? 'border-blue-400 ring-4 ring-blue-50 shadow-blue-100' :
                      node.status === 'success' ? 'border-gray-900 shadow-gray-100' :
                      node.status === 'queued' ? 'border-amber-300 ring-4 ring-amber-50' :
                      node.status === 'failed' ? 'border-red-300 ring-4 ring-red-50' :
                      'border-gray-200 hover:border-gray-300'
                    }`}>
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="shrink-0">
                          {node.status === 'idle' && <div className="w-2 h-2 rounded-full bg-gray-300" />}
                          {node.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                          {node.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-gray-900" />}
                          {node.status === 'queued' && <Clock className="w-3.5 h-3.5 text-amber-500" />}
                          {node.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold font-mono tracking-tight truncate text-gray-900">{projectLabel(node.name)}</p>
                          <p className="text-[10px] text-gray-400 font-mono truncate">{node.branch || node.name}</p>
                          {(node.buildUrl || node.queueUrl) && (
                            <a href={node.buildUrl || node.queueUrl} target="_blank" rel="noreferrer"
                              className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 truncate">
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              {node.buildNumber ? `Build #${node.buildNumber}` : 'Jenkins queue'}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {node.duration && (
                          <span className="text-[10px] font-mono text-gray-400 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />{node.duration}
                          </span>
                        )}
                        {phase === 'draft' && (
                          <button onClick={() => removeNode(node.id)}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity bg-white rounded-full p-0.5 shadow-sm">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {(index < pipeline.length - 1 || isAddingNode) && (
                      <div className="flex flex-col items-center w-full h-[28px] relative">
                        <div className={`w-[2px] h-full ${node.status === 'success' ? 'bg-gray-900' : 'bg-gray-200'}`} />
                        <div className={`absolute bottom-0 w-1.5 h-1.5 border-b-2 border-r-2 ${node.status === 'success' ? 'border-gray-900' : 'border-gray-200'}`}
                          style={{ transform: 'translateY(1px) rotate(45deg)' }} />
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Node */}
                {phase === 'draft' && (
                  <div className="w-full flex justify-center mt-0">
                    {isAddingNode ? (
                      <div className="w-full p-2.5 rounded-xl border-2 border-dashed border-gray-300 bg-white shadow-sm">
                        <form onSubmit={handleAddNode} className="flex items-center gap-2">
                          {deployProjects.length > 0 ? (
                            <select autoFocus value={newNodeName || deployProjects[0]?.id || ''}
                              onChange={(e) => setNewNodeName(e.target.value)}
                              className="w-full bg-transparent text-xs outline-none text-gray-800 font-mono">
                              {deployProjects.map((p) => (
                                <option key={p.id} value={p.id}>{p.label} · {p.defaultBranch}</option>
                              ))}
                            </select>
                          ) : (
                            <input autoFocus type="text" value={newNodeName}
                              onChange={(e) => setNewNodeName(e.target.value)}
                              className="w-full bg-transparent text-xs outline-none text-gray-800 font-mono placeholder:text-gray-400"
                              placeholder="输入工程 ID..." />
                          )}
                          <button type="submit" disabled={deployProjects.length === 0 && !newNodeName.trim()}
                            className="text-gray-400 hover:text-green-600 disabled:opacity-40">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => setIsAddingNode(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                          </button>
                        </form>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setNewNodeName(deployProjects[0]?.id || ''); setIsAddingNode(true); }}
                        className="text-[11px] text-gray-400 hover:text-gray-700 border border-dashed border-gray-300 rounded-lg px-4 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center gap-1 shadow-sm mt-1">
                        <Plus className="w-3 h-3" />添加节点
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Node Config Panel / Execute Button */}
          {phase === 'draft' && (
            <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
              <button
                onClick={executePipeline}
                disabled={pipeline.length === 0 || health?.jenkinsConfigured !== true}
                className="w-full bg-gray-900 text-white rounded-xl py-3 text-sm font-medium hover:bg-black flex items-center justify-center gap-2 shadow-sm transition-all hover:shadow-md disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" fill="currentColor" />开始构建与部署
              </button>
            </div>
          )}
          {phase === 'completed' && (
            <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
              <button
                onClick={() => { setPhase('idle'); setPipeline([]); setLogs([]); setCommand(''); }}
                className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                重置，开始新部署
              </button>
            </div>
          )}
        </div>

        {/* ── RIGHT: Log Output + Execution Status ── */}
        <div className="w-[500px] shrink-0 flex flex-col bg-[#111111] overflow-hidden">
          {/* Terminal header */}
          <div className="h-10 bg-[#1E1E1E] flex items-center px-4 border-b border-[#2A2A2A] shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
              <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
              <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
            </div>
            <p className="ml-3 text-[11px] font-mono text-gray-500">日志输出 — System Log</p>
          </div>

          {/* Log content */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed selection:bg-gray-600 scrollbar-hide">
            {logs.length === 0 ? (
              <div className="text-gray-600">Waiting for actions...</div>
            ) : (
              <div className="flex flex-col gap-1">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-3">
                    <span className="text-gray-600 shrink-0 select-none">[{log.timestamp}]</span>
                    <span className={`break-all ${
                      log.type === 'error' ? 'text-red-400' :
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'warn' ? 'text-yellow-400' :
                      log.type === 'system' ? 'text-blue-300' :
                      log.type === 'prompt' ? 'text-purple-300 font-bold' :
                      'text-gray-300'
                    }`}>{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* Execution Status Bar */}
          <div className="shrink-0 border-t border-[#2A2A2A] bg-[#1A1A1A] px-4 py-2">
            {(activeTask || isResolving) ? (
              <p className="text-[11px] font-mono text-gray-400 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
                {isResolving ? '解析任务意图...' : `执行中 → ${activeTask}`}
              </p>
            ) : phase === 'completed' ? (
              <p className="text-[11px] font-mono text-green-500 flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3" />流水线执行完成
              </p>
            ) : (
              <p className="text-[11px] font-mono text-gray-600">就绪</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
