import { useState, useRef, useEffect, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Terminal, Settings, Play, Square, Folder, FolderTree, GitBranch, TerminalSquare, Layers, Command as CmdIcon, CheckCircle2, Plus, Edit2, Trash2, X, Save, Loader2, Zap, Search, ArrowDown, Maximize2, Minimize2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';

type IDEType = 'cursor' | 'code' | 'webstorm';
type CmdType = 'yarn dev' | 'yarn w' | 'yarn --force' | 'none' | string;

interface SubProject {
  id: string;
  name: string;
  path: string;
  branch: string;
  installCmd: string;
  runCmd: string;
}

interface StartupProfile {
  id: string;
  title: string;
  description: string;
  type: 'single' | 'workspace';
  ide: IDEType;
  projects: SubProject[];
  /** 浮标 / 自然语言匹配用，不要求用户记 id */
  aliases?: string[];
  keywords?: string[];
}

interface ProjectCatalogEntry {
  id: string;
  name: string;
  path: string;
}

type ProfileRunStatus = 'bootstrapping' | 'running' | 'completed' | 'failed' | 'stopped';

interface StartupLog {
  id: number;
  text: string;
  type: string;
}

interface ProfileRunState {
  runId?: string;
  status: ProfileRunStatus;
  logs: StartupLog[];
}

export const INITIAL_PROFILES: StartupProfile[] = [
  {
    id: 'saas-cc-web',
    title: 'saas-cc-web',
    description: '独立启动单个前端核心工程',
    type: 'single',
    ide: 'cursor',
    aliases: ['cc-web', '前端', 'web'],
    keywords: ['saas'],
    projects: [
      { id: '1', name: 'cc-web', path: '~/Documents/work-space/web/saas-cc-web', branch: 'test-260423', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'saas-cc-node',
    title: 'saas-cc-node',
    description: '独立启动单个前端核心工程',
    type: 'single',
    ide: 'cursor',
    aliases: ['node', 'cc-node', '后端'],
    projects: [
      { id: '1', name: 'cc-node', path: '~/Documents/work-space/node/saas-cc-node', branch: 'test-260423', installCmd: 'yarn', runCmd: 'yarn run test' }
    ]
  },
  {
    id: 'app-service-plus',
    title: 'app-service-plusb',
    description: '独立启动',
    type: 'single',
    ide: 'cursor',
    aliases: ['plus', 'app-plus'],
    projects: [
      { id: '1', name: 'app-service-plus', path: ' ~/Documents/work-space/third/cc-front-biz-app-service-plus', branch: 'test-260423', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'app-service-mp',
    title: 'app-service-mp',
    description: '独立启动',
    type: 'single',
    ide: 'cursor',
    aliases: ['mp', '小程序'],
    projects: [
      { id: '1', name: 'app-service-mp', path: ' ~/Documents/work-space/mdf/cc-front-biz-app-service-mp', branch: 'test-260423', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'mdf',
    title: '低代码',
    description: '核心库开启 watch，主应用开启 dev',
    type: 'workspace',
    ide: 'cursor',
    aliases: ['mdf', '低代码', 'metapage', '管理台'],
    keywords: ['workspace'],
    projects: [
      { id: '1', name: 'ui-web', path: '~/Documents/work-space/mdf/chanjet-mdf-ui-web', branch: 'test', installCmd: 'yarn', runCmd: 'yarn w' },
      { id: '2', name: 'biz-service', path: '~/Documents/work-space/mdf/chanjet-mdf-biz-service', branch: 'test', installCmd: 'yarn', runCmd: 'yarn w' },
      { id: '3', name: 'mdf', path: '~/Documents/work-space/mdf/chanjet-mdf', branch: 'test', installCmd: 'yarn', runCmd: 'yarn w' },
      { id: '4', name: 'biz', path: '~/Documents/work-space/mdf/chanjet-mdf-biz', branch: 'test', installCmd: 'yarn', runCmd: 'yarn w' },
      { id: '5', name: 'metapage', path: '~/Documents/work-space/mdf/saas-cc-web-metapage', branch: 'test-260423', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'p3',
    title: '全栈微服务 (API + Web)',
    description: '所有子工程同步拉取并全量开启 dev',
    type: 'workspace',
    ide: 'cursor',
    projects: [
      { id: '1', name: 'auth-service', path: '~/projects/auth-service', branch: 'develop', installCmd: 'yarn', runCmd: 'yarn dev' },
      { id: '2', name: 'user-center', path: '~/projects/user-center', branch: 'develop', installCmd: 'yarn', runCmd: 'yarn dev' },
      { id: '3', name: 'cc-web', path: '~/projects/cc-web', branch: 'feat/hotfix-login', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  }
];

export default function Startup() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<StartupProfile[]>(INITIAL_PROFILES);
  const [projectCatalog, setProjectCatalog] = useState<ProjectCatalogEntry[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(INITIAL_PROFILES[0].id);
  const [runsByProfileId, setRunsByProfileId] = useState<Record<string, ProfileRunState>>({});
  const logsRef = useRef<HTMLDivElement>(null);
  const esRefs = useRef<Record<string, EventSource>>({});

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<StartupProfile | null>(null);

  // Search & Filter (NEW FEATURE)
  const [searchQuery, setSearchQuery] = useState('');
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());

  // Terminal Tabs (NEW FEATURE)
  const [activeTerminalTab, setActiveTerminalTab] = useState<string>('all');
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [serviceLogs, setServiceLogs] = useState<Record<string, StartupLog[]>>({});

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];
  const activeRun = runsByProfileId[activeProfileId];
  const logs = activeRun?.logs || [];
  const isCurrentBootstrapping = activeRun?.status === 'bootstrapping';
  const isCurrentRunning = activeRun?.status === 'bootstrapping' || activeRun?.status === 'running';

  // Filter Logic for Profile List (NEW FEATURE)
  const filteredProfiles = profiles.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.aliases?.some(a => a.toLowerCase().includes(q)) ||
      p.projects.some(proj => proj.name.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    if (autoScroll) {
      logsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    return () => {
      for (const profileId of Object.keys(esRefs.current)) {
        esRefs.current[profileId].close();
      }
    };
  }, []);

  useEffect(() => {
    const pid = searchParams.get('profile');
    if (!pid) return;
    const decoded = decodeURIComponent(pid.trim());
    const exists = profiles.some((p) => p.id === decoded);
    const next = new URLSearchParams(searchParams);
    next.delete('profile');
    setSearchParams(next, {replace: true});
    if (exists) {
      setActiveProfileId(decoded);
    }
  }, [searchParams, profiles, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/assistant/project-catalog')
      .then((r) => r.json())
      .then((d: { entries?: ProjectCatalogEntry[] }) => {
        if (!cancelled && Array.isArray(d.entries)) setProjectCatalog(d.entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const addLog = (profileId: string, text: string, type = 'info', serviceName?: string) => {
    // Global logs (EXISTING BEHAVIOR - MUST KEEP)
    setRunsByProfileId(prev => {
      const current = prev[profileId] || { status: 'completed', logs: [] };
      return {
        ...prev,
        [profileId]: {
          ...current,
          logs: [...current.logs, { id: Math.random(), text, type }],
        },
      };
    });
    
    // Service-specific logs (NEW FEATURE - optional enhancement)
    if (serviceName) {
      setServiceLogs(prev => ({
        ...prev,
        [serviceName]: [...(prev[serviceName] || []), { id: Math.random(), text, type }]
      }));
    }
  };

  const updateRunState = (profileId: string, patch: Partial<ProfileRunState>) => {
    setRunsByProfileId(prev => {
      const current = prev[profileId] || { status: 'completed', logs: [] };
      return {
        ...prev,
        [profileId]: { ...current, ...patch },
      };
    });
  };

  // Batch Selection Handlers (NEW FEATURE)
  const toggleBatchSelection = (id: string) => {
    setSelectedProfileIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLaunch = async () => {
    if (!activeProfile) return;

    const profile = activeProfile;
    esRefs.current[profile.id]?.close();
    updateRunState(profile.id, { status: 'bootstrapping', runId: undefined, logs: [] });

    try {
      const res = await fetch('/api/startup/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ide: profile.ide,
          projects: profile.projects,
          options: { smartInstall: true, openDevInTerminal: false },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addLog(profile.id, `[Error] ${(err as { error?: string }).error || '启动请求失败'}`, 'error');
        updateRunState(profile.id, { status: 'failed' });
        return;
      }

      const { runId } = await res.json() as { runId: string };
      const es = new EventSource(`/api/startup/runs/${runId}/events`);
      esRefs.current[profile.id] = es;
      updateRunState(profile.id, { runId });

      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as { type: string; payload: Record<string, string> };
        if (event.type === 'log') {
          addLog(profile.id, event.payload.message as string, (event.payload.level as string) || 'info');
        } else if (event.type === 'bootstrap_ready') {
          updateRunState(profile.id, { status: 'running' });
        } else if (event.type === 'completed') {
          updateRunState(profile.id, { status: 'completed' });
          es.close();
          delete esRefs.current[profile.id];
        } else if (event.type === 'stopped') {
          updateRunState(profile.id, { status: 'stopped' });
          es.close();
          delete esRefs.current[profile.id];
        } else if (event.type === 'failed') {
          const err = (event.payload as { error?: string }).error;
          if (err) addLog(profile.id, `[Error] ${err}`, 'error');
          updateRunState(profile.id, { status: 'failed' });
          es.close();
          delete esRefs.current[profile.id];
        }
      };

      es.onerror = () => {
        addLog(profile.id, '[Error] 与后端连接中断', 'error');
        updateRunState(profile.id, { status: 'failed' });
        es.close();
        delete esRefs.current[profile.id];
      };
    } catch {
      addLog(profile.id, '[Error] 网络请求失败，请确认后端服务正在运行', 'error');
      updateRunState(profile.id, { status: 'failed' });
    }
  };

  const handleStopCurrentRun = async () => {
    if (!activeRun?.runId || !activeProfile) return;
    addLog(activeProfile.id, `[Runner] 正在停止当前配置任务...`, 'warn');
    try {
      const res = await fetch(`/api/startup/runs/${activeRun.runId}/stop`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || '停止请求失败');
      updateRunState(activeProfile.id, { status: 'stopped' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(activeProfile.id, `[Error] 停止失败：${message}`, 'error');
    }
  };

  const handleCreateNew = () => {
    setEditForm({
      id: 'p_' + Date.now(),
      title: '新建工作区',
      description: '',
      type: 'workspace',
      ide: 'cursor',
      projects: [{ id: 'proj_' + Date.now(), name: 'new-app', path: '~/projects/new-app', branch: 'main', installCmd: 'yarn', runCmd: 'yarn dev' }]
    });
    setIsEditing(true);
  };

  const handleEdit = () => {
    setEditForm(JSON.parse(JSON.stringify(activeProfile))); // Deep copy
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!editForm) return;
    setProfiles(prev => {
      const idx = prev.findIndex(p => p.id === editForm.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = editForm;
        return next;
      }
      return [...prev, editForm];
    });
    setActiveProfileId(editForm.id);
    setIsEditing(false);
  };

  const handleDeleteProfile = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const runStatus = runsByProfileId[id]?.status;
    if (runStatus === 'bootstrapping' || runStatus === 'running') return;
    const nextList = profiles.filter(p => p.id !== id);
    setProfiles(nextList);
    if (activeProfileId === id && nextList.length > 0) {
      setActiveProfileId(nextList[0].id);
    }
  };

  const addProjectToForm = () => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      projects: [...editForm.projects, { id: 'proj_' + Date.now(), name: 'new-service', path: '~/projects/', branch: 'main', installCmd: 'yarn', runCmd: 'yarn dev' }]
    });
  };

  const updateProjectField = (projId: string, field: keyof SubProject, value: string) => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      projects: editForm.projects.map(p => p.id === projId ? { ...p, [field]: value } : p)
    });
  };

  const removeProjectFromForm = (projId: string) => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      projects: editForm.projects.filter(p => p.id !== projId)
    });
  };

  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--wide">
        <PageHeader
          icon={Zap}
          title="工程启动"
          subtitle="一键配置并拉起本地 IDE、Git 分支及多工作区的依赖服务"
        />

        <div className="flex-1 min-h-0 flex flex-col">
          {/* Top Info Bar (Design-aligned) */}
          {activeProfile && !isEditing && (
            <div className="pkmer-top-info-bar pkmer-fade-in">
              <div className="pkmer-top-info-bar__left">
                <span className="pkmer-top-info-bar__title">{activeProfile.title}</span>
                <div className="pkmer-top-info-bar__meta">
                  {activeProfile.projects[0] && (
                    <span className="pkmer-top-info-bar__tag">
                      <GitBranch className="w-3 h-3 inline mr-1" />
                      {activeProfile.projects[0].branch}
                    </span>
                  )}
                  {activeProfile.projects[0] && (
                    <span className="pkmer-top-info-bar__tag">
                      <TerminalSquare className="w-3 h-3 inline mr-1" />
                      {activeProfile.projects[0].runCmd}
                    </span>
                  )}
                  {activeProfile.projects[0] && (
                    <span className="pkmer-top-info-bar__path">
                      <Folder className="w-3 h-3 inline mr-1" />
                      {activeProfile.projects[0].path}
                    </span>
                  )}
                </div>
              </div>
              
              {/* Action Buttons (Fixed Top-Right) */}
              <div className="pkmer-top-info-bar__actions">
                {isCurrentRunning && activeRun?.runId && (
                  <>
                    <button
                      type="button"
                      onClick={handleStopCurrentRun}
                      className="pkmer-btn-stop-fixed"
                    >
                      <Square className="w-3.5 h-3.5" fill="currentColor" />
                      停止当前工程
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleStopCurrentRun();
                        setTimeout(() => handleLaunch(), 500);
                      }}
                      className="pkmer-btn-refresh"
                      title="重启"
                    >
                      <Loader2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                {!isCurrentRunning && (
                  <button 
                    type="button"
                    onClick={handleLaunch}
                    disabled={isCurrentBootstrapping}
                    className="pkmer-btn-launch" style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
                  >
                    {isCurrentBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" fill="currentColor" />}
                    {isCurrentBootstrapping ? '启动中...' : '启动'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={isCurrentRunning}
                  className="pkmer-btn-refresh"
                  title="编辑配置"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          
          {/* Main Workspace: Left Sidebar + Right Terminal */}
          <div className="flex-1 min-h-0 flex gap-6">
            {/* Left Sidebar: 280px */}
            <aside className="w-[280px] flex-shrink-0 flex flex-col gap-3 h-full">
             {/* Search Input */}
             <div className="relative">
               <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pkmer-icon-muted" />
               <input
                 type="text"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 placeholder="搜索配置..."
                 className="pkmer-search-input"
               />
             </div>
             
             {/* Batch Mode Toggle */}
             <button
               onClick={() => setIsBatchMode(!isBatchMode)}
               className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                 isBatchMode ? 'pkmer-btn-ink' : 'pkmer-text-secondary border-[color:var(--color-hairline)]'
               }`}
             >
               {isBatchMode ? '✓ 多选模式' : '☐ 多选模式'}
             </button>
             
             {/* Profile List */}
             <div className="flex-1 overflow-y-auto w-full flex flex-col gap-3 pr-2 scrollbar-hide pb-6">
               {filteredProfiles.length === 0 ? (
                 <div className="text-[11px] pkmer-text-guide border border-[color:var(--glass-border-subtle)] rounded-lg p-3 text-center bg-[color:var(--glass-surface-inset)] shrink-0">
                   {searchQuery ? '无匹配配置' : '暂无配置文件'}
                 </div>
               ) : filteredProfiles.map(profile => (
                 <div
                   key={profile.id}
                   onClick={() => !isEditing && !isBatchMode && setActiveProfileId(profile.id)}
                   className={`text-left p-4 rounded-xl border transition-all cursor-pointer relative group shrink-0 pkmer-profile-card ${
                     activeProfileId === profile.id && !isBatchMode ? 'pkmer-profile-card--active' : 'opacity-90'
                   } ${isEditing ? 'pkmer-profile-card--disabled' : ''}`}
                 >
                   <div className="flex justify-between items-start mb-2">
                     <div className="flex items-center gap-2">
                       {isBatchMode && (
                         <input
                           type="checkbox"
                           checked={selectedProfileIds.has(profile.id)}
                           onChange={() => toggleBatchSelection(profile.id)}
                           className="pkmer-checkbox"
                           onClick={(e) => e.stopPropagation()}
                         />
                       )}
                       {profile.type === 'single' ? (
                         <Folder className="w-4 h-4 pkmer-icon-indigo shrink-0" />
                       ) : (
                         <FolderTree className="w-4 h-4 pkmer-icon-secondary shrink-0" />
                       )}
                       <span className="font-semibold text-sm pkmer-text-body">{profile.title}</span>
                       {/* Status Indicator */}
                       {runsByProfileId[profile.id]?.status === 'running' && (
                         <span className="pkmer-status-dot pkmer-status-dot--running" title="运行中" />
                       )}
                       {runsByProfileId[profile.id]?.status === 'bootstrapping' && (
                         <span className="pkmer-status-dot pkmer-status-dot--bootstrapping" title="启动中" />
                       )}
                     </div>
                     <button 
                       onClick={(e) => handleDeleteProfile(profile.id, e)}
                       disabled={runsByProfileId[profile.id]?.status === 'bootstrapping' || runsByProfileId[profile.id]?.status === 'running'}
                       className="pkmer-text-muted hover:text-[color:var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed disabled:hover:text-[color:var(--color-muted-400)]"
                       title={(runsByProfileId[profile.id]?.status === 'bootstrapping' || runsByProfileId[profile.id]?.status === 'running') ? '运行中，先停止工程' : '删除配置'}
                     >
                       <Trash2 className="w-3.5 h-3.5" />
                     </button>
                   </div>
                   <p className="text-xs pkmer-text-secondary leading-relaxed">{profile.description}</p>
                   <div className="mt-2 flex gap-1 flex-wrap">
                     {profile.projects.map((p, i) => (
                       <span key={i} className="pkmer-chip">{p.name}</span>
                     ))}
                   </div>
                 </div>
               ))}

               <button 
                 onClick={handleCreateNew}
                 disabled={isEditing}
                 className="mt-1 shrink-0 border border-dashed border-[color:color-mix(in_srgb,var(--color-muted-500)_40%,transparent)] rounded-xl p-3 text-center text-xs pkmer-text-secondary hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--color-ink)] transition-colors disabled:opacity-50"
               >
                 + 添加新配置
               </button>
             </div>
          </aside>

          {/* Right Workspace: Terminal Dominance */}
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            
            {/* Edit Form (Only show when editing) */}
            {isEditing && editForm ? (
              <div className="pkmer-form-shell">
                <div className="flex items-center justify-between border-b border-[color:var(--color-hairline)] pb-3 shrink-0">
                  <h3 className="text-sm font-semibold pkmer-text-body flex items-center gap-2">
                    <Settings className="w-4 h-4 pkmer-icon-indigo shrink-0" /> 编辑环境配置
                  </h3>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setIsEditing(false)} className="text-xs font-medium pkmer-text-secondary hover:text-[color:var(--color-ink)] px-3 py-1.5">
                      取消
                    </button>
                    <button type="button" onClick={handleSave} className="pkmer-btn-ink text-xs px-4 py-1.5 rounded-lg flex items-center gap-1 shadow-sm">
                      <Save className="w-3.5 h-3.5" /> 保存配置
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 pb-2">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="pkmer-field-label">配置名称</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        className="pkmer-input-line"
                      />
                    </div>
                    <div>
                      <label className="pkmer-field-label">IDE 选项</label>
                      <select
                        value={editForm.ide}
                        onChange={(e) => setEditForm({ ...editForm, ide: e.target.value as IDEType })}
                        className="pkmer-input-line"
                      >
                        <option value="cursor">Cursor</option>
                        <option value="code">VS Code</option>
                        <option value="webstorm">WebStorm</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="pkmer-field-label">描述 (可选)</label>
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="pkmer-input-line"
                      />
                    </div>
                  </div>

                  <div className="mb-2 flex items-center justify-between">
                    <label className="pkmer-field-label mb-0">工作区子工程组合 ({editForm.projects.length})</label>
                    <button type="button" onClick={addProjectToForm} className="pkmer-link-indigo text-[11px] flex items-center gap-0.5 font-medium">
                      <Plus className="w-3 h-3" /> 添加工程
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {editForm.projects.map((proj, idx) => (
                      <div key={proj.id} className="pkmer-subcard relative group">
                         <div className="absolute top-2 right-2 flex gap-2">
                           <button type="button" onClick={() => removeProjectFromForm(proj.id)} className="pkmer-text-muted hover:text-[color:var(--danger)]">
                             <X className="w-3.5 h-3.5"/>
                           </button>
                         </div>
                         <div className="grid grid-cols-2 gap-3 mb-2 pr-6">
                           <div>
                             <span className="text-[10px] pkmer-text-muted block mb-0.5 font-mono">Project Name</span>
                             <input type="text" value={proj.name} onChange={e => updateProjectField(proj.id, 'name', e.target.value)} placeholder="e.g. biz-core" className="pkmer-input-line pkmer-input-line--mono" />
                           </div>
                           <div>
                             <span className="text-[10px] pkmer-text-muted block mb-0.5 font-mono">Branch</span>
                             <input type="text" value={proj.branch} onChange={e => updateProjectField(proj.id, 'branch', e.target.value)} placeholder="e.g. feat/JIRA-100" className="pkmer-input-line pkmer-input-line--mono text-[color:var(--color-primary-600)]" />
                           </div>
                           <div className="col-span-2">
                             <span className="text-[10px] pkmer-text-muted mb-0.5 font-mono flex flex-wrap items-center gap-x-1 gap-y-0.5">
                               从目录表填充
                               <Link to="/settings" className="pkmer-link-indigo hover:underline">
                                 （登记）
                               </Link>
                             </span>
                             <select
                               className="mb-1.5 w-full pkmer-input-line pkmer-input-line--mono"
                               value=""
                               onChange={(e) => {
                                 const id = e.target.value;
                                 const el = e.target;
                                 if (!id) return;
                                 const ent = projectCatalog.find((x) => x.id === id);
                                 if (ent) {
                                   updateProjectField(proj.id, 'name', ent.name);
                                   updateProjectField(proj.id, 'path', ent.path);
                                 }
                                 el.selectedIndex = 0;
                               }}
                             >
                               <option value="">选择已登记工程…</option>
                               {projectCatalog.map((c) => (
                                 <option key={c.id} value={c.id}>
                                   {c.name} — {c.path}
                                 </option>
                               ))}
                             </select>
                             <span className="text-[10px] pkmer-text-muted mb-0.5 font-mono block">Local Path</span>
                             <input type="text" value={proj.path} onChange={e => updateProjectField(proj.id, 'path', e.target.value)} placeholder="~/projects/" className="pkmer-input-line pkmer-input-line--mono" />
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[color:var(--color-hairline)]">
                           <div>
                             <span className="text-[10px] pkmer-text-muted block mb-0.5 font-mono">Install Command</span>
                             <input type="text" value={proj.installCmd} onChange={e => updateProjectField(proj.id, 'installCmd', e.target.value)} placeholder="yarn" className="pkmer-input-line pkmer-input-line--mono" />
                           </div>
                           <div>
                             <span className="text-[10px] pkmer-text-muted block mb-0.5 font-mono">Run Command (Start/Watch)</span>
                             <input type="text" value={proj.runCmd} onChange={e => updateProjectField(proj.id, 'runCmd', e.target.value)} placeholder="yarn dev/w" className="pkmer-input-line pkmer-input-line--mono text-[color:var(--color-accent)]" />
                           </div>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              // Terminal takes full space when not editing
              <div className="flex-1 min-h-0 pkmer-fade-in">

            {/* Bottom: Simulated Daemon Terminal */}
            <div className={`pkmer-terminal flex-1 min-h-0 ${isTerminalFullscreen ? 'pkmer-terminal--fullscreen' : ''}`}>
              {/* Terminal Tabs (NEW FEATURE) */}
              <div className="pkmer-terminal-tabs">
                <button
                  className={`pkmer-terminal-tab ${activeTerminalTab === 'all' ? 'pkmer-terminal-tab--active' : ''}`}
                  onClick={() => setActiveTerminalTab('all')}
                >
                  All
                </button>
                {activeProfile?.projects.map((proj, idx) => (
                  <button
                    key={idx}
                    className={`pkmer-terminal-tab ${activeTerminalTab === proj.name ? 'pkmer-terminal-tab--active' : ''}`}
                    onClick={() => setActiveTerminalTab(proj.name)}
                  >
                    {proj.name}
                    {serviceLogs[proj.name]?.some(l => l.type === 'error') && (
                      <span className="ml-1 text-[color:var(--danger)]">●</span>
                    )}
                  </button>
                ))}
              </div>
              
              {/* Terminal Chrome with Toolbar */}
              <div className="pkmer-terminal__chrome">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                </div>
                <div className="flex items-center gap-2">
                  {!isCurrentBootstrapping && logs.length > 0 && <CheckCircle2 className="w-3 h-3 text-[color:var(--success)] shrink-0" />}
                  <p className="text-[10px] font-mono pkmer-text-muted">Local Daemon Proxy [tty1]</p>
                </div>
                {/* Terminal Actions */}
                <div className="pkmer-terminal-toolbar">
                  <button
                    className="pkmer-terminal-toolbar-btn"
                    onClick={() => setRunsByProfileId(prev => ({
                      ...prev,
                      [activeProfileId]: { ...prev[activeProfileId], logs: [] }
                    }))}
                    title="清屏"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className={`pkmer-terminal-toolbar-btn ${autoScroll ? 'text-[color:var(--success)]' : ''}`}
                    onClick={() => setAutoScroll(!autoScroll)}
                    title="自动滚动"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="pkmer-terminal-toolbar-btn"
                    onClick={() => setIsTerminalFullscreen(!isTerminalFullscreen)}
                    title="全屏"
                  >
                    {isTerminalFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              
              <div className="pkmer-terminal__body">
                {(() => {
                  const displayLogs = activeTerminalTab === 'all' 
                    ? logs 
                    : (serviceLogs[activeTerminalTab] || []);
                  
                  if (displayLogs.length === 0) {
                    return <div className="pkmer-text-muted flex h-full items-center justify-center italic text-xs">Waiting for daemon hook...</div>;
                  }
                  
                  return (
                    <div className="flex flex-col gap-1">
                      {displayLogs.map(log => (
                        <div key={log.id} className="flex gap-3">
                          <span
                            className={`shrink-0 ${
                              log.type === 'system'
                                ? 'pkmer-log-line--system font-bold'
                                : log.type === 'cmd'
                                  ? 'pkmer-log-line--cmd'
                                  : log.type === 'success'
                                    ? 'pkmer-log-line--success'
                                    : log.type === 'error'
                                      ? 'pkmer-log-line--error'
                                      : log.type === 'warn'
                                        ? 'pkmer-log-line--warn'
                                        : 'pkmer-log-line--muted'
                            }`}
                          >
                            {log.text}
                          </span>
                        </div>
                      ))}
                      <div ref={logsRef} />
                    </div>
                  );
                })()}
              </div>
            </div>
              </div>
            )}

          </main>
          </div>
        </div>
      </div>
    </div>
  );
}
