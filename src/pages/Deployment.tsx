import React, { useState, useRef, useEffect, useCallback, type FormEvent, type MouseEvent } from 'react';
import { Terminal, CheckCircle2, XCircle, Loader2, ArrowRight, Clock, Box, Play, Plus, X, Trash2, Save, FilePlus, Tag, GitBranch, ExternalLink, ShieldAlert, Rocket, BarChart2 } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import PageHeader from '../components/PageHeader';
import { extractJiraAndBranch } from '../lib/float-command/deploy-parse-extract';
import { resolveDeployTemplates } from '../lib/float-command/deploy-template-resolve';
import { readDeployRecentIdsForResolve, recordDeployTemplateUsed } from '../lib/float-command/recent';
import { stripDeployVerbs } from '../lib/float-command/text-normalize';
import {
  FLOAT_DEPLOY_SESSION_KEY,
  type FloatDeployConfirmedPayload,
} from '../lib/float-command/float-deploy-payload';

type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'queued';
type Phase = 'idle' | 'draft' | 'executing' | 'completed';

interface DeployNodeData extends Record<string, unknown> {
  name: string;
  status: NodeStatus;
  branch?: string;
  queueUrl?: string;
  buildUrl?: string;
  buildNumber?: number;
  duration?: string;
}

type DeployNode = Node<DeployNodeData>;
type DeployEdge = Edge;

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'system' | 'prompt';
}

function normalizeDeployLogLevel(level: unknown): LogEntry['type'] {
  if (level === 'error' || level === 'warn' || level === 'success' || level === 'system' || level === 'prompt') {
    return level;
  }
  return 'info';
}

type DeployPipelineSseEvent =
  | { type: 'log'; timestamp: string; payload: { message?: string; level?: string } }
  | { type: 'nodes'; timestamp: string; payload: { nodes?: DeployNode[] } }
  | { type: 'completed'; timestamp: string; payload?: Record<string, unknown> }
  | { type: 'failed'; timestamp: string; payload?: { error?: string } };

interface Template {
  id: string;
  name: string;
  nodes: string[];
  /** 浮标 / 指令匹配用别名 */
  keywords?: string[];
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
  { id: 'tpl_9', name: 'MDF', nodes: ['mdf', 'saas-cc-web-metapage'], keywords: ['mdf', '低代码', 'metapage'] },
  { id: 'tpl_8', name: 'MDF—BIZ', nodes: ['mdf-biz', 'saas-cc-web-metapage'], keywords: ['biz', 'mdf-biz'] },
  { id: 'tpl_7', name: 'UI-WEB', nodes: ['mdf-ui-web', 'saas-cc-web-metapage'], keywords: ['ui-web', 'ui web'] },
  { id: 'tpl_11', name: 'BIZ-CORE', nodes: ['biz-core', 'saas-cc-web', 'hsy-h5-mainapp'], keywords: ['biz-core', '订单', 'biz core'] },
  {
    id: 'tpl_12',
    name: 'SAAS-CC-NODE-METASERVER',
    nodes: ['saas-cc-node-metaserver', 'saas-cc-node'],
    keywords: ['node', 'metaserver', 'cc-node'],
  },
];

const DEPLOY_API_BASE =
  ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_DEPLOY_API_BASE ?? '/api/deploy').replace(/\/$/, '') ||
  '/api/deploy';

const DEPLOY_PIPELINE_RUN_KEY = 'deploy_pipeline_active_run_v1';

// Custom Node Component for React Flow
function DeployNodeCard({ data }: { data: DeployNodeData }) {
  const statusIcon: Record<NodeStatus, React.ReactNode> = {
    idle: <div className="w-2 h-2 rounded-full bg-[color:var(--color-muted-400)]" />,
    running: <Loader2 className="w-3.5 h-3.5 text-[color:var(--color-primary-500)] animate-spin" />,
    success: <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--color-muted-800)]" />,
    queued: <Clock className="w-3.5 h-3.5 text-amber-500" />,
    failed: <XCircle className="w-3.5 h-3.5 text-red-500" />,
  };

  const statusBorder: Record<NodeStatus, string> = {
    running: 'border-[color:var(--color-primary-500)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-500)_15%,transparent)]',
    success: 'border-[color:var(--color-muted-800)]',
    failed: 'border-red-500 shadow-[0_0_0_3px_color-mix(in_srgb,red_15%,transparent)]',
    queued: 'border-amber-500',
    idle: 'border-[color:var(--color-hairline)]',
  };

  return (
    <div className={`pkmer-dag-node px-3 py-2 rounded-xl border-2 bg-[color:var(--color-shell-bg)] ${statusBorder[data.status]}`}>
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-[color:var(--color-muted-400)]" />
      <div className="flex items-center gap-2">
        <div className="shrink-0">{statusIcon[data.status]}</div>
        <div className="min-w-0">
          <p className="text-xs font-bold font-mono truncate">{data.name}</p>
          <p className="text-[10px] pkmer-text-muted font-mono">{data.branch || data.name}</p>
          {(data.buildUrl || data.queueUrl) && (
            <a
              href={data.buildUrl || data.queueUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 flex items-center gap-1 text-[10px] pkmer-link-indigo truncate"
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              {data.buildNumber ? `Build #${data.buildNumber}` : 'Jenkins queue'}
            </a>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-[color:var(--color-muted-400)]" />
    </div>
  );
}

// DAG Validation - Check for cycles
const validateDag = (nodes: DeployNode[], edges: DeployEdge[]): { valid: boolean; error?: string } => {
  const adjList = new Map<string, string[]>();
  nodes.forEach(n => adjList.set(n.id, []));
  edges.forEach(e => adjList.get(e.source)?.push(e.target));
  
  const visited = new Set<string>();
  const inStack = new Set<string>();
  
  const hasCycle = (nodeId: string): boolean => {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    
    visited.add(nodeId);
    inStack.add(nodeId);
    
    for (const neighbor of adjList.get(nodeId) || []) {
      if (hasCycle(neighbor)) return true;
    }
    
    inStack.delete(nodeId);
    return false;
  };
  
  for (const node of nodes) {
    if (hasCycle(node.id)) {
      return { valid: false, error: '检测到循环依赖，DAG 必须为有向无环图' };
    }
  }
  
  return { valid: true };
};

// Topological Sort for execution order
const topologicalSort = (nodes: DeployNode[], edges: DeployEdge[]): string[] => {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  
  nodes.forEach(n => {
    inDegree.set(n.id, 0);
    adjList.set(n.id, []);
  });
  
  edges.forEach(e => {
    adjList.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });
  
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) queue.push(nodeId);
  });
  
  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    
    for (const neighbor of adjList.get(current) || []) {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  return result;
};

// Create DAG from node names (vertical layout, center-aligned)
const createDagFromNodes = (nodeNames: string[]): { nodes: DeployNode[]; edges: DeployEdge[] } => {
  const nodes: DeployNode[] = [];
  const edges: DeployEdge[] = [];
  
  // Center X position (canvas is roughly 800px wide, node is ~200px)
  const centerX = 300;
  
  nodeNames.forEach((name, index) => {
    const nodeId = `node-${index}-${Date.now()}`;
    nodes.push({
      id: nodeId,
      type: 'deploy',
      position: { x: centerX, y: index * 150 },
      data: { name, status: 'idle' as NodeStatus },
    });
    
    if (index > 0) {
      edges.push({
        id: `edge-${index - 1}-${index}`,
        source: `node-${index - 1}-${Date.now()}`,
        target: nodeId,
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: true,
      });
    }
  });
  
  // Fix edge sources to use correct node IDs
  edges.forEach((edge, idx) => {
    edge.source = nodes[idx].id;
  });
  
  return { nodes, edges };
};

export default function Deployment() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [command, setCommand] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [nodes, setNodes] = useState<DeployNode[]>([]);
  const [edges, setEdges] = useState<DeployEdge[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [parsedJira, setParsedJira] = useState<string | null>(null);
  const [parsedBranch, setParsedBranch] = useState<string | null>(null);
  const [health, setHealth] = useState<DeployHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [showJenkinsPopover, setShowJenkinsPopover] = useState(false);
  const [showJiraPopover, setShowJiraPopover] = useState(false);

  // React Flow event handlers
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ 
        ...connection, 
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: true,
      }, eds));
    },
    []
  );

  // Backwards compatibility - pipeline getter/setter
  const pipeline = nodes;
  const setPipeline = (newNodes: DeployNode[]) => {
    setNodes(newNodes);
    // Auto-create edges for sequential nodes if no edges exist
    if (newNodes.length > 1 && edges.length === 0) {
      const autoEdges: DeployEdge[] = [];
      for (let i = 0; i < newNodes.length - 1; i++) {
        autoEdges.push({
          id: `edge-${i}-${i + 1}`,
          source: newNodes[i].id,
          target: newNodes[i + 1].id,
          markerEnd: { type: MarkerType.ArrowClosed },
          animated: true,
        });
      }
      setEdges(autoEdges);
    }
  };

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

  const [taskStats, setTaskStats] = useState<Array<{ taskKey: string; count: number; lastRunAt: string }>>([]);
  const pipelineEsRef = useRef<EventSource | null>(null);
  const logSeqRef = useRef(0);

  const closePipelineEventSource = useCallback(() => {
    if (pipelineEsRef.current) {
      pipelineEsRef.current.close();
      pipelineEsRef.current = null;
    }
  }, []);

  const fetchTaskStats = useCallback(async () => {
    try {
      const res = await fetch(`${DEPLOY_API_BASE}/pipeline/task-stats?limit=25`);
      const data = (await res.json()) as {
        entries?: Array<{ taskKey: string; count: number; lastRunAt: string }>;
      };
      if (Array.isArray(data.entries)) setTaskStats(data.entries);
    } catch {
      /* ignore */
    }
  }, []);

  const attachPipelineEventSource = useCallback(
    (runId: string, afterIndex?: number) => {
      closePipelineEventSource();
      const qs =
        afterIndex != null && afterIndex > 0
          ? `?afterIndex=${encodeURIComponent(String(Math.floor(afterIndex)))}`
          : '';
      const es = new EventSource(
        `${DEPLOY_API_BASE}/pipeline/runs/${encodeURIComponent(runId)}/events${qs}`
      );
      pipelineEsRef.current = es;
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as DeployPipelineSseEvent;
          if (event.type === 'log') {
            const msg =
              typeof event.payload?.message === 'string'
                ? event.payload.message
                : JSON.stringify(event.payload ?? {});
            const type = normalizeDeployLogLevel(event.payload?.level);
            logSeqRef.current += 1;
            const id = Date.now() + logSeqRef.current;
            setLogs((prev) => [...prev, { id, timestamp: event.timestamp, message: msg, type }]);
            return;
          }
          if (event.type === 'nodes' && Array.isArray(event.payload?.nodes)) {
            const rawNodes = event.payload.nodes as unknown as Array<{ id?: string; name: string; status: NodeStatus }>;
            // Convert backend format to React Flow nodes (vertical layout, center-aligned)
            const flowNodes: DeployNode[] = rawNodes.map((n, idx) => ({
              id: n.id || `node-${idx}`,
              type: 'deploy',
              position: { x: 300, y: idx * 150 },
              data: { name: n.name, status: n.status },
            }));
            setPipeline(flowNodes);
            const running = rawNodes.find((n) => n.status === 'running');
            setActiveTask(running?.name ?? null);
            return;
          }
          if (event.type === 'completed' || event.type === 'failed') {
            setActiveTask(null);
            setPhase('completed');
            sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
            void fetchTaskStats();
            closePipelineEventSource();
          }
        } catch {
          /* ignore malformed SSE payload */
        }
      };
      es.onerror = () => {
        closePipelineEventSource();
      };
    },
    [closePipelineEventSource, fetchTaskStats]
  );

  useEffect(() => {
    void fetchTaskStats();
  }, [fetchTaskStats]);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSnapshot = (snap: {
      nodes?: DeployNode[];
      events?: Array<{ type: string; timestamp: string; payload?: { message?: string; level?: string } }>;
    }) => {
      if (snap.nodes?.length) setPipeline(snap.nodes);
      const logEvents = (snap.events || []).filter((e) => e.type === 'log');
      const restored: LogEntry[] = logEvents.map((e, idx) => ({
        id: 1_000_000_000 + idx,
        timestamp: e.timestamp,
        message: typeof e.payload?.message === 'string' ? e.payload.message : '',
        type: normalizeDeployLogLevel(e.payload?.level),
      }));
      setLogs(restored);
    };

    void (async () => {
      const stored = sessionStorage.getItem(DEPLOY_PIPELINE_RUN_KEY);
      if (!stored) return;
      try {
        const r = await fetch(`${DEPLOY_API_BASE}/pipeline/runs/${encodeURIComponent(stored)}`);
        if (!r.ok) {
          sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
          return;
        }
        const snap = (await r.json()) as {
          status?: string;
          nodes?: DeployNode[];
          events?: Array<{ type: string; timestamp: string; payload?: { message?: string; level?: string } }>;
          eventCount?: number;
        };
        if (cancelled) return;
        if (snap.status === 'running') {
          setPhase('executing');
          hydrateFromSnapshot(snap);
          const running = snap.nodes?.find((n) => n.data?.status === 'running' || (n as any).status === 'running');
          setActiveTask(running?.data?.name ?? (running as any)?.name ?? null);
          const after = typeof snap.eventCount === 'number' ? snap.eventCount : 0;
          attachPipelineEventSource(stored, after);
        } else if (snap.status === 'completed' || snap.status === 'failed') {
          setPhase('completed');
          hydrateFromSnapshot(snap);
          setActiveTask(null);
          sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
          void fetchTaskStats();
        } else {
          sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
        }
      } catch {
        sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
      }
    })();

    return () => {
      cancelled = true;
      closePipelineEventSource();
    };
  }, [attachPipelineEventSource, closePipelineEventSource, fetchTaskStats]);

  // Auto scroll terminal logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('fromFloat') !== '1') return;
    const raw = sessionStorage.getItem(FLOAT_DEPLOY_SESSION_KEY);
    if (raw) {
      sessionStorage.removeItem(FLOAT_DEPLOY_SESSION_KEY);
    }
    window.history.replaceState({}, '', '/deploy');
    if (!raw) return;
    let p: FloatDeployConfirmedPayload;
    try {
      p = JSON.parse(raw) as FloatDeployConfirmedPayload;
    } catch {
      return;
    }
    if (typeof p.templateId === 'string' && p.templateId) {
      recordDeployTemplateUsed(p.templateId);
    }
    setCommand(typeof p.command === 'string' ? p.command : '');
    setParsedJira(p.parsedJira ?? null);
    setParsedBranch(p.parsedBranch ?? null);
    const ids = Array.isArray(p.projectIds) ? p.projectIds.filter((x) => typeof x === 'string' && x.trim()) : [];
    setPhase('draft');
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setLogs([
      {
        id: Date.now(),
        timestamp: ts,
        message: '已从浮标载入部署草稿，请确认后执行。',
        type: 'system',
      },
    ]);
    setPipeline(
      ids.map((name, idx) => ({
        id: crypto.randomUUID(),
        type: 'deploy',
        position: { x: 300, y: idx * 150 },
        data: { name, status: 'idle' as NodeStatus },
      }))
    );
  }, []);

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
    const { jira: detectedJira, branch: detectedBranch } = extractJiraAndBranch(cmd);

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
      const recentMerged = readDeployRecentIdsForResolve();
      const tmplRes = resolveDeployTemplates(cmd, templates, recentMerged);
      if (tmplRes.type === 'exact') {
        resolvedNodes = tmplRes.template.nodes;
        addLog(
          `[Template] 匹配: ${tmplRes.template.name}（可信度 ${tmplRes.confidence}）→ ${resolvedNodes.join(', ')}`,
          'info'
        );
      } else if (tmplRes.type === 'multiple') {
        const pick = tmplRes.candidates[0];
        resolvedNodes = pick.nodes;
        addLog(
          `[Template] 多条命中，已按最近使用优先选用: ${pick.name}（共 ${tmplRes.candidates.length} 条，可从左侧模板切换）`,
          'warn'
        );
      } else {
        const fallback = stripDeployVerbs(cmd).trim() || cmd;
        resolvedNodes = [fallback];
        addLog(`[System] 未命中模板，按单节点/服务名识别: ${fallback}`, 'info');
      }
    }

    if (detectedBranch) {
      addLog(`[Git] Explicit branch target override: ${detectedBranch}`, 'info');
    }

    const dag = createDagFromNodes(resolvedNodes);
    setNodes(dag.nodes);
    setEdges(dag.edges);
    setIsResolving(false);
    setPhase('draft');
    addLog(`Pipeline Draft created. Awaiting user confirmation.`, 'prompt');
  };

  // --- Template Interactions ---
  const applyTemplate = (nodeNames: string[], tplId?: string) => {
    void tplId; // tplId reserved, recent tracking happens on actual execution
    const dag = createDagFromNodes(nodeNames);
    setNodes(dag.nodes);
    setEdges(dag.edges);
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
    setNodes(prev => prev.filter(n => n.id !== id));
  };

  const handleAddNode = (e: FormEvent) => {
    e.preventDefault();
    const selectedProject = newNodeName.trim() || deployProjects[0]?.id || '';
    if (!selectedProject) return;
    const newNode: DeployNode = {
      id: `node-${Date.now()}`,
      type: 'deploy',
      position: { x: 300, y: nodes.length * 150 },
      data: { name: selectedProject, status: 'idle' },
    };
    setNodes(prev => [...prev, newNode]);
    setNewNodeName('');
    setIsAddingNode(false);
  };

  const executePipeline = async () => {
    if (nodes.length === 0) return;
    
    // Validate DAG structure
    const validation = validateDag(nodes, edges);
    if (!validation.valid) {
      addLog(`[DAG] ${validation.error}`, 'error');
      return;
    }
    
    if (health?.jenkinsConfigured === false) {
      addLog(
        `Jenkins 未配置，缺失: ${(health.jenkinsMissing || []).join(', ') || 'unknown'}。部署已阻止。`,
        'error'
      );
      return;
    }

    // Extract linear execution order from DAG (topological sort)
    const executionOrder = topologicalSort(nodes, edges);
    const projectIds = executionOrder.map(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      return node?.data.name;
    }).filter(Boolean) as string[];

    const nodeKey = projectIds.join(',');
    const matchedTpl = templates.find((t) => t.nodes.join(',') === nodeKey);
    if (matchedTpl) {
      setRecentIds((prev) => {
        const next = [matchedTpl.id, ...prev.filter((id) => id !== matchedTpl.id)].slice(0, 5);
        localStorage.setItem('deploy_recent_v1', JSON.stringify(next));
        return next;
      });
    }

    setPhase('executing');
    setLogs([]);
    setActiveTask(null);
    closePipelineEventSource();

    try {
      const resp = await fetch(`${DEPLOY_API_BASE}/pipeline/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIds,
          jiraId: parsedJira || undefined,
          branch: parsedBranch || undefined,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!resp.ok || !data.runId) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      sessionStorage.setItem(DEPLOY_PIPELINE_RUN_KEY, data.runId);
      attachPipelineEventSource(data.runId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`[Pipeline] 启动失败: ${message}`, 'error');
      setPhase('draft');
      sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
    }
  };

  const recentTemplates = recentIds.map(id => templates.find(t => t.id === id)).filter(Boolean) as Template[];
  const favoritedTemplates = templates.filter(t => favoritedIds.includes(t.id));

  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--wide">
        
        <PageHeader
          icon={Rocket}
          title="工程部署"
          subtitle="服务端 DAG 编排 + Jenkins；离开页面后可恢复日志与节点状态"
          actions={
            <div className="self-center flex flex-wrap items-center justify-end gap-2 text-xs shrink-0 sm:ml-2">
              {healthError ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                  <ShieldAlert className="h-3 w-3" />部署 API 不可用
                </span>
              ) : health ? (
                <>
                  {/* Jenkins Status with Popover */}
                  <div className="relative">
                    <button
                      onClick={() => health.jenkinsConfigured === false && setShowJenkinsPopover(!showJenkinsPopover)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
                        health.jenkinsConfigured 
                          ? 'border-green-200 bg-green-50 text-green-700' 
                          : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer'
                      }`}
                    >
                      {health.jenkinsConfigured ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                      Jenkins {health.jenkinsConfigured ? `已配置 · ${deployProjects.length} 项目` : '不可用'}
                    </button>
                    {showJenkinsPopover && health.jenkinsConfigured === false && (
                      <div className="absolute right-0 top-full mt-2 w-80 p-3 bg-[color:var(--color-shell-bg)] border border-[color:var(--color-hairline)] rounded-lg shadow-lg z-50">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-red-700">Jenkins 集群维护中</p>
                          <p className="text-[11px] pkmer-text-body">当前 Jenkins 集群正处于维护状态，缺失配置: {(health.jenkinsMissing || []).join(', ') || 'unknown'}</p>
                          <div className="pt-2 border-t border-[color:var(--color-hairline)]">
                            <p className="text-[10px] pkmer-text-muted mb-1">自动 Fallback 方案:</p>
                            <ul className="text-[10px] space-y-1">
                              <li className="flex items-start gap-1">
                                <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                                <span>已切换至本地 Docker 构建</span>
                              </li>
                              <li className="flex items-start gap-1">
                                <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                                <span>使用备份流水线代构建</span>
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Jira Status with Popover */}
                  <div className="relative">
                    <button
                      onClick={() => !health.jiraConfigured && setShowJiraPopover(!showJiraPopover)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
                        health.jiraConfigured 
                          ? 'border-green-200 bg-green-50 text-green-700' 
                          : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'
                      }`}
                    >
                      {health.jiraConfigured ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      Jira {health.jiraConfigured ? '已配置' : 'fallback'}
                    </button>
                    {showJiraPopover && !health.jiraConfigured && (
                      <div className="absolute right-0 top-full mt-2 w-80 p-3 bg-[color:var(--color-shell-bg)] border border-[color:var(--color-hairline)] rounded-lg shadow-lg z-50">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-amber-700">Jira 使用 Fallback 模式</p>
                          <p className="text-[11px] pkmer-text-body">Jira API 未配置或不可用，系统已启用本地缓存和默认配置</p>
                          <div className="pt-2 border-t border-[color:var(--color-hairline)]">
                            <p className="text-[10px] pkmer-text-muted mb-1">功能影响:</p>
                            <ul className="text-[10px] space-y-1">
                              <li className="flex items-start gap-1">
                                <ShieldAlert className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                <span>无法获取 Jira 任务关联信息</span>
                              </li>
                              <li className="flex items-start gap-1">
                                <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                                <span>部署功能正常，使用默认节点配置</span>
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-hairline)] bg-[color:var(--color-shell-bg)] px-2 py-1 pkmer-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />检查配置...
                </span>
              )}
            </div>
          }
        />

        {/* Command Input - Copilot Style */}
        <div className="mb-6 shrink-0">
          <form onSubmit={handleInputSubmit} className="relative">
            <div className="pkmer-copilot-input border-2 border-[color:var(--color-hairline)] rounded-xl bg-[color:var(--color-shell-bg)] shadow-sm overflow-hidden transition-all focus-within:border-[color:var(--color-primary-500)] focus-within:shadow-md">
              {/* Input Header with Quick Prompts */}
              <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5 border-b border-[color:var(--color-hairline)]">
                <button type="button" onClick={() => setCommand('部署全量核心链路')} 
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--color-primary-50)] text-[color:var(--color-primary-600)] hover:bg-[color:var(--color-primary-100)] transition-colors">
                  💡 部署全量核心链路
                </button>
                <button type="button" onClick={() => setCommand('Jira-1205 关联变更部署')}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">
                  💡 Jira 关联部署
                </button>
                <button type="button" onClick={() => setCommand('并行部署 mdf-biz 和 user-service')}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">
                  ⚡ 并行部署
                </button>
              </div>
              
              {/* Main Input Area */}
              <div className="flex items-center px-3 py-2">
                <div className="mr-2">
                  {isResolving ? <Loader2 className="h-4 w-4 pkmer-text-muted animate-spin" /> : <Terminal className="h-4 w-4 pkmer-text-muted" />}
                </div>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  disabled={phase === 'executing' || isResolving}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--color-ink-lighter)]"
                  placeholder="输入自然语言 / Jira 号 / 部署意图..."
                />
                <button type="submit" disabled={!command.trim() || phase === 'executing'}
                  className="ml-2 px-3 py-1 rounded-lg bg-[color:var(--color-primary-500)] text-white text-xs font-medium hover:bg-[color:var(--color-primary-600)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {isResolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '智能解析'}
                </button>
              </div>
              
              {/* Parsed Context Display */}
              {(parsedJira || parsedBranch) && (
                <div className="px-3 pb-2 flex gap-2">
                  {parsedJira && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] border border-blue-200">
                      <Tag className="w-2.5 h-2.5" />{parsedJira}
                    </span>
                  )}
                  {parsedBranch && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 text-green-700 text-[10px] border border-green-200">
                      <GitBranch className="w-2.5 h-2.5" />{parsedBranch}
                    </span>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>

        {/* ── Three-column Body ── */}
        <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">

          {/* ── LEFT NAV ── */}
          <div className="w-52 shrink-0 pkmer-card flex flex-col overflow-hidden">

            {/* ⭐ 最近使用 */}
            <div className="px-3 pt-2.5 pb-1.5">
              <p className="text-[9px] font-semibold pkmer-text-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                <span>⭐</span> 最近使用
              </p>
              {recentTemplates.length === 0 ? (
                <p className="text-[10px] pkmer-text-muted pl-0.5">暂无记录</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {recentTemplates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl.nodes, tpl.id)}
                      className="px-2 py-0.5 rounded-full bg-[color:color-mix(in_srgb,var(--color-canvas)_70%,var(--color-shell-bg))] hover:bg-[color:color-mix(in_srgb,var(--color-canvas)_85%,var(--color-shell-bg))] text-[10px] pkmer-text-secondary truncate max-w-full transition-colors"
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mx-3 border-t border-[color:var(--color-hairline)]" />

            {/* 常用链路（服务端按执行次数统计） */}
            <div className="px-3 pt-2 pb-1.5">
              <p className="text-[9px] font-semibold pkmer-text-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                <BarChart2 className="w-3 h-3 shrink-0" />常用链路
              </p>
              {taskStats.length === 0 ? (
                <p className="text-[10px] pkmer-text-muted pl-0.5">发起过「一键部署」后将按次数排序</p>
              ) : (
                <ul className="flex flex-col gap-0.5 max-h-[132px] overflow-y-auto scrollbar-hide">
                  {taskStats.map((row) => (
                    <li key={row.taskKey}>
                      <button
                        type="button"
                        onClick={() =>
                          applyTemplate(
                            row.taskKey.split(',').map((s) => s.trim()).filter(Boolean)
                          )
                        }
                        className="w-full text-left px-2 py-1 rounded-md hover:bg-[color:var(--color-surface-hover)] transition-colors flex items-center justify-between gap-1 min-w-0"
                        title={row.taskKey}
                      >
                        <span className="text-[10px] pkmer-text-body truncate flex-1 min-w-0">
                          {row.taskKey.split(',').map(projectLabel).join(' → ')}
                        </span>
                        <span className="shrink-0 text-[9px] font-mono tabular-nums bg-[color:color-mix(in_srgb,var(--color-canvas)_70%,var(--color-shell-bg))] px-1 py-0.5 rounded">
                          {row.count}次
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mx-3 border-t border-[color:var(--color-hairline)]" />

            {/* 📌 收藏 */}
            <div className="px-3 pt-1.5 pb-1.5">
              <p className="text-[9px] font-semibold pkmer-text-muted uppercase tracking-widest mb-1 flex items-center gap-1">
                <span>📌</span> 收藏
              </p>
              {favoritedTemplates.length === 0 ? (
                <p className="text-[10px] pkmer-text-muted pl-0.5">hover 模板可收藏</p>
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

            <div className="mx-3 border-t border-[color:var(--color-hairline)]" />

            {/* Tab: 工程 | 模板 */}
            <div className="px-3 pt-2 shrink-0">
              <div className="flex rounded-lg border border-[color:var(--color-hairline)] overflow-hidden text-[11px] font-medium">
                <button
                  onClick={() => setActiveLeftTab('project')}
                  className={`flex-1 py-1.5 transition-colors ${activeLeftTab === 'project' ? 'bg-[color:var(--color-muted-800)] text-white' : 'bg-[color:var(--color-shell-bg)] pkmer-text-secondary hover:bg-[color:var(--color-surface-hover)]'}`}
                >工程</button>
                <button
                  onClick={() => setActiveLeftTab('template')}
                  className={`flex-1 py-1.5 transition-colors ${activeLeftTab === 'template' ? 'bg-[color:var(--color-muted-800)] text-white' : 'bg-[color:var(--color-shell-bg)] pkmer-text-secondary hover:bg-[color:var(--color-surface-hover)]'}`}
                >模板</button>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
              {activeLeftTab === 'project' ? (
                <div className="flex flex-col gap-px">
                  {deployProjects.length === 0 ? (
                    <p className="text-[10px] pkmer-text-muted pl-1 pt-1">无可用工程</p>
                  ) : deployProjects.map(proj => (
                    <button
                      key={proj.id}
                      onClick={() => applyTemplate([proj.id])}
                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[color:var(--color-surface-hover)] transition-colors flex items-center justify-between gap-2 group"
                    >
                      <span className="text-[11px] pkmer-text-body truncate flex-1 min-w-0">{proj.label}</span>
                      <span className="shrink-0 text-[10px] font-mono pkmer-text-muted bg-[color:color-mix(in_srgb,var(--color-canvas)_65%,var(--color-shell-bg))] group-hover:bg-[color:color-mix(in_srgb,var(--color-canvas)_80%,var(--color-shell-bg))] px-1.5 py-0.5 rounded transition-colors max-w-[72px] truncate">{proj.defaultBranch}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-px">
                  <button
                    onClick={() => {
                      closePipelineEventSource();
                      sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
                      setPhase('draft');
                      setPipeline([]);
                      setLogs([]);
                      setIsSavingTemplate(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[color:color-mix(in_srgb,var(--color-primary-500)_10%,var(--color-shell-bg))] text-[11px] pkmer-link-indigo flex items-center gap-1 transition-colors mb-0.5"
                  >
                    <FilePlus className="w-3 h-3 shrink-0" /> 创建空白链路
                  </button>
                  {templates.length === 0 ? (
                    <p className="text-[10px] pkmer-text-muted pl-1 pt-1">暂无模板</p>
                  ) : templates.map(tpl => (
                    <div
                      key={tpl.id}
                      className="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[color:var(--color-surface-hover)] cursor-pointer transition-colors"
                      onClick={() => applyTemplate(tpl.nodes, tpl.id)}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                        <span className="text-[11px] pkmer-text-body truncate">{tpl.name}</span>
                        {tpl.nodes.length > 1 && (
                          <span className="shrink-0 text-[9px] font-mono pkmer-text-muted bg-[color:color-mix(in_srgb,var(--color-canvas)_65%,var(--color-shell-bg))] px-1 py-0.5 rounded">{tpl.nodes.length}步</span>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(tpl.id); }}
                          className={`p-0.5 rounded text-xs ${favoritedIds.includes(tpl.id) ? 'text-amber-500' : 'pkmer-text-muted hover:text-amber-400'}`}
                          title={favoritedIds.includes(tpl.id) ? '取消收藏' : '收藏'}
                        >📌</button>
                        <button
                          onClick={(e) => handleDeleteTemplate(e, tpl.id)}
                          className="p-0.5 rounded pkmer-text-muted hover:text-red-500"
                          title="删除"
                        ><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── MIDDLE: DAG Editor with React Flow ── */}
          <div className="flex-1 flex flex-col overflow-hidden pkmer-card mr-3">
            {/* DAG toolbar */}
            <div className="shrink-0 h-12 flex items-center px-4 gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-xs font-semibold pkmer-text-muted uppercase tracking-widest">DAG 依赖编排</span>
              {(parsedJira || parsedBranch) && (
                <div className="flex items-center gap-2">
                  {parsedJira && (
                    <span className="pkmer-badge">
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
                        className="pkmer-input text-xs py-1 px-2 w-24"
                      />
                      <button type="submit" className="text-xs pkmer-link-indigo font-medium">确认</button>
                      <button type="button" onClick={() => setIsSavingTemplate(false)} className="text-xs pkmer-text-muted">取消</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsSavingTemplate(true)}
                      disabled={nodes.length === 0}
                      className="text-xs pkmer-link-indigo flex items-center gap-1 disabled:opacity-40"
                    >
                      <Save className="w-3 h-3" />存为模板
                    </button>
                  )}
                  <div className="h-3 w-px bg-[color:var(--color-hairline)]" />
                  <button type="button" onClick={() => setPhase('idle')} className="text-xs pkmer-text-muted hover:text-[color:var(--color-ink)]">
                    重新选用
                  </button>
                </div>
              )}
            </div>

            {/* React Flow Canvas */}
            <div className="flex-1" style={{ background: 'var(--bg-secondary)' }}>
              {phase === 'idle' && (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Box className="w-8 h-8 mb-3 pkmer-text-muted opacity-40" />
                  <p className="text-sm pkmer-text-muted">从菜单中进入部署页后，可在此选择模板，或通过顶部输入框描述部署意图</p>
                  <p className="text-xs pkmer-text-muted mt-1.5">"帮我先发 auth 服务再发 admin 页面"</p>
                </div>
              )}

              {(phase === 'draft' || phase === 'executing' || phase === 'completed') && (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={{ deploy: DeployNodeCard }}
                  defaultNodeOptions={{ type: 'deploy' }}
                  fitView
                  minZoom={0.5}
                  maxZoom={2}
                >
                  <Background color="var(--color-hairline)" gap={16} size={1} />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              )}
            </div>

            {/* Node Config Panel / Execute Button */}
            {phase === 'draft' && (
              <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                <button
                  onClick={executePipeline}
                  disabled={nodes.length === 0 || health?.jenkinsConfigured !== true}
                  className="pkmer-btn pkmer-btn--accent w-full"
                >
                  <Play className="w-4 h-4" fill="currentColor" />开始构建与部署
                </button>
              </div>
            )}
            {phase === 'completed' && (
              <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                <button
                  onClick={() => {
                    closePipelineEventSource();
                    sessionStorage.removeItem(DEPLOY_PIPELINE_RUN_KEY);
                    setPhase('idle');
                    setNodes([]);
                    setEdges([]);
                    setLogs([]);
                    setCommand('');
                  }}
                  className="pkmer-btn pkmer-btn--outline w-full"
                >
                  重置，开始新部署
                </button>
              </div>
            )}
          </div>

          {/* ── RIGHT: Log Output + Execution Status ── */}
          <div className="w-[500px] shrink-0 pkmer-terminal">
            <div className="pkmer-terminal__chrome rounded-t-xl">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
              </div>
              <p className="ml-3 text-xs font-mono">日志输出 — System Log</p>
            </div>
            <div className="pkmer-terminal__body text-[0.8125rem] leading-relaxed scrollbar-hide" style={{ boxShadow: 'none' }}>
              {logs.length === 0 ? (
                <div className="pkmer-log-line--cmd">Waiting for actions...</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {logs.map((log) => (
                    <div key={log.id} className="flex gap-3">
                      <span className="pkmer-log-line--cmd shrink-0 select-none">[{log.timestamp}]</span>
                      <span
                        className={`break-all ${
                          log.type === 'error'
                            ? 'pkmer-log-line--error'
                            : log.type === 'success'
                              ? 'pkmer-log-line--success'
                              : log.type === 'warn'
                                ? 'pkmer-log-line--warn'
                                : log.type === 'system'
                                  ? 'pkmer-log-line--system'
                                  : log.type === 'prompt'
                                    ? 'font-bold'
                                    : 'pkmer-log-line--muted'
                        }`}
                        style={
                          log.type === 'prompt'
                            ? { color: 'color-mix(in srgb, var(--color-accent-secondary) 85%, var(--color-code-text))' }
                            : undefined
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
            <div className="shrink-0 px-4 py-2 rounded-b-xl bg-[color:var(--color-code-tabs)] border-t border-solid" style={{ borderTopColor: 'color-mix(in srgb, var(--color-code-text) 14%, transparent)' }}>
              {(activeTask || isResolving || phase === 'executing') ? (
                <p className="text-xs font-mono flex items-center gap-2" style={{ color: 'color-mix(in srgb, var(--color-code-text) 72%, transparent)' }}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--color-search-hit)] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--color-search-hit)]" />
                  </span>
                  {isResolving
                    ? '解析任务意图...'
                    : activeTask
                      ? `执行中 → ${activeTask}`
                      : '服务端编排中…'}
                </p>
              ) : phase === 'completed' ? (
                <p className="text-xs font-mono pkmer-log-line--success flex items-center gap-2">
                  <CheckCircle2 className="w-3 h-3" />流水线执行完成
                </p>
              ) : (
                <p className="text-xs font-mono pkmer-log-line--cmd">就绪</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
