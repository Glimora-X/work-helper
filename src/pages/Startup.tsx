import { useState, useRef, useEffect, type MouseEvent } from 'react';
import { Terminal, Settings, Play, Square, Folder, FolderTree, GitBranch, TerminalSquare, Layers, Command as CmdIcon, CheckCircle2, Plus, Edit2, Trash2, X, Save, Loader2 } from 'lucide-react';

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

const INITIAL_PROFILES: StartupProfile[] = [
  {
    id: 'p1',
    title: '单体应用 (cc-web)',
    description: '独立启动单个前端核心工程',
    type: 'single',
    ide: 'cursor',
    projects: [
      { id: '1', name: 'cc-web', path: '~/Documents/work-space/web/saas-cc-web', branch: 'sprint-260423', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'p2',
    title: '微前端主子空间 (主干+依赖)',
    description: '核心库开启 watch，主应用开启 dev',
    type: 'workspace',
    ide: 'cursor',
    projects: [
      { id: '1', name: 'biz-core', path: '~/projects/biz-core', branch: 'feat/JIRA-1002', installCmd: 'yarn', runCmd: 'yarn w' },
      { id: '2', name: 'cc-web', path: '~/projects/cc-web', branch: 'feat/JIRA-1002', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  },
  {
    id: 'p3',
    title: '全栈微服务 (API + Web)',
    description: '所有子工程同步拉取并全量开启 dev',
    type: 'workspace',
    ide: 'code',
    projects: [
      { id: '1', name: 'auth-service', path: '~/projects/auth-service', branch: 'develop', installCmd: 'yarn', runCmd: 'yarn dev' },
      { id: '2', name: 'user-center', path: '~/projects/user-center', branch: 'develop', installCmd: 'yarn', runCmd: 'yarn dev' },
      { id: '3', name: 'cc-web', path: '~/projects/cc-web', branch: 'feat/hotfix-login', installCmd: 'yarn', runCmd: 'yarn dev' }
    ]
  }
];

export default function Startup() {
  const [profiles, setProfiles] = useState<StartupProfile[]>(INITIAL_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>(INITIAL_PROFILES[0].id);
  const [runsByProfileId, setRunsByProfileId] = useState<Record<string, ProfileRunState>>({});
  const logsRef = useRef<HTMLDivElement>(null);
  const esRefs = useRef<Record<string, EventSource>>({});

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<StartupProfile | null>(null);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];
  const activeRun = runsByProfileId[activeProfileId];
  const logs = activeRun?.logs || [];
  const isCurrentBootstrapping = activeRun?.status === 'bootstrapping';
  const isCurrentRunning = activeRun?.status === 'bootstrapping' || activeRun?.status === 'running';

  useEffect(() => {
    logsRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => {
      for (const profileId of Object.keys(esRefs.current)) {
        esRefs.current[profileId].close();
      }
    };
  }, []);

  const addLog = (profileId: string, text: string, type = 'info') => {
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
    <div className="flex min-h-0 flex-col bg-[#FAFAFA]">
      <div className="p-8 md:p-12 pb-4 max-w-6xl mx-auto w-full flex-1 min-h-0 flex flex-col">
        <header className="mb-8 shrink-0">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">工程启动</h1>
          <p className="text-sm text-gray-500 mt-1">一键配置并拉起本地 IDE、Git 分支及多工作区的依赖服务</p>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left: Profile List */}
          <div className="lg:col-span-4 flex flex-col gap-3 h-full">
             <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1 shrink-0">环境配置文件</h2>
             
             <div className="flex-1 overflow-y-auto w-full flex flex-col gap-3 pr-2 scrollbar-hide pb-6">
               {profiles.length === 0 ? (
                 <div className="text-[11px] text-gray-400 border border-gray-100 rounded-lg p-3 text-center bg-white shrink-0">暂无配置文件</div>
               ) : profiles.map(profile => (
                 <div
                   key={profile.id}
                   onClick={() => !isEditing && setActiveProfileId(profile.id)}
                   className={`text-left p-4 rounded-xl border transition-all cursor-pointer relative group shrink-0 ${
                     activeProfileId === profile.id 
                       ? 'bg-white border-blue-400 ring-4 ring-blue-50 shadow-sm' 
                       : 'bg-white border-gray-200 hover:border-gray-300 opacity-80'
                   } ${isEditing ? 'pointer-events-none opacity-50' : ''}`}
                 >
                   <div className="flex justify-between items-start mb-2">
                     <div className="flex items-center gap-2">
                       {profile.type === 'single' ? <Folder className="w-4 h-4 text-blue-500" /> : <FolderTree className="w-4 h-4 text-purple-500" />}
                       <span className="font-semibold text-sm text-gray-900">{profile.title}</span>
                       {(runsByProfileId[profile.id]?.status === 'bootstrapping' || runsByProfileId[profile.id]?.status === 'running') && (
                         <span className="h-2 w-2 rounded-full bg-green-500" title="运行中" />
                       )}
                     </div>
                     <button 
                       onClick={(e) => handleDeleteProfile(profile.id, e)}
                       disabled={runsByProfileId[profile.id]?.status === 'bootstrapping' || runsByProfileId[profile.id]?.status === 'running'}
                       className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed disabled:hover:text-gray-300"
                       title={(runsByProfileId[profile.id]?.status === 'bootstrapping' || runsByProfileId[profile.id]?.status === 'running') ? '运行中，先停止工程' : '删除配置'}
                     >
                       <Trash2 className="w-3.5 h-3.5" />
                     </button>
                   </div>
                   <p className="text-xs text-gray-500 leading-relaxed">{profile.description}</p>
                   <div className="mt-2 flex gap-1 flex-wrap">
                     {profile.projects.map((p, i) => (
                       <span key={i} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono">{p.name}</span>
                     ))}
                   </div>
                 </div>
               ))}

               <button 
                 onClick={handleCreateNew}
                 disabled={isEditing}
                 className="mt-1 shrink-0 border border-dashed border-gray-300 rounded-xl p-3 text-center text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50"
               >
                 + 添加新配置
               </button>
             </div>
          </div>

          {/* Right: Configuration & Console */}
          <div className="lg:col-span-8 flex min-h-0 flex-col gap-4 overflow-hidden">
            
            {/* Top: Edit Form OR Info Preview Card */}
            {isEditing && editForm ? (
              <div className="bg-white rounded-xl border border-blue-200 ring-4 ring-blue-50 p-5 flex flex-col gap-4 shrink-0 shadow-sm overflow-hidden h-[400px]">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 shrink-0">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-blue-500" /> 编辑环境配置
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditing(false)} className="text-xs font-medium text-gray-500 hover:text-gray-900 px-3 py-1.5">取消</button>
                    <button onClick={handleSave} className="text-xs font-medium bg-gray-900 text-white hover:bg-black px-4 py-1.5 rounded-lg flex items-center gap-1 shadow-sm"><Save className="w-3.5 h-3.5"/> 保存配置</button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 pb-2">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">配置名称</label>
                      <input type="text" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">IDE 选项</label>
                      <select value={editForm.ide} onChange={e => setEditForm({...editForm, ide: e.target.value as IDEType})} className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none bg-white">
                        <option value="cursor">Cursor</option>
                        <option value="code">VS Code</option>
                        <option value="webstorm">WebStorm</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">描述 (可选)</label>
                      <input type="text" value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className="w-full text-sm border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" />
                    </div>
                  </div>

                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase">工作区子工程组合 ({editForm.projects.length})</label>
                    <button onClick={addProjectToForm} className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5"><Plus className="w-3 h-3"/> 添加工程</button>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {editForm.projects.map((proj, idx) => (
                      <div key={proj.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg relative group">
                         <div className="absolute top-2 right-2 flex gap-2">
                           <button onClick={() => removeProjectFromForm(proj.id)} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5"/></button>
                         </div>
                         <div className="grid grid-cols-2 gap-3 mb-2 pr-6">
                           <div>
                             <span className="text-[10px] text-gray-400 block mb-0.5 font-mono">Project Name</span>
                             <input type="text" value={proj.name} onChange={e => updateProjectField(proj.id, 'name', e.target.value)} placeholder="e.g. biz-core" className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none" />
                           </div>
                           <div>
                             <span className="text-[10px] text-gray-400 block mb-0.5 font-mono">Branch</span>
                             <input type="text" value={proj.branch} onChange={e => updateProjectField(proj.id, 'branch', e.target.value)} placeholder="e.g. feat/JIRA-100" className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none text-blue-600" />
                           </div>
                           <div className="col-span-2">
                             <span className="text-[10px] text-gray-400 block mb-0.5 font-mono">Local Path</span>
                             <input type="text" value={proj.path} onChange={e => updateProjectField(proj.id, 'path', e.target.value)} placeholder="~/projects/" className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none" />
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200">
                           <div>
                             <span className="text-[10px] text-gray-400 block mb-0.5 font-mono">Install Command</span>
                             <input type="text" value={proj.installCmd} onChange={e => updateProjectField(proj.id, 'installCmd', e.target.value)} placeholder="yarn" className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none" />
                           </div>
                           <div>
                             <span className="text-[10px] text-gray-400 block mb-0.5 font-mono">Run Command (Start/Watch)</span>
                             <input type="text" value={proj.runCmd} onChange={e => updateProjectField(proj.id, 'runCmd', e.target.value)} placeholder="yarn dev/w" className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none text-orange-600" />
                           </div>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              // Preivew Plan Card
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4 shrink-0 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                  <Layers className="w-24 h-24" />
                </div>
                
                <div className="flex items-center justify-between z-10">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <CmdIcon className="w-4 h-4 text-gray-400" /> 
                    执行计划预览 
                    <button onClick={handleEdit} disabled={isCurrentRunning || !activeProfile} className="text-gray-400 hover:text-blue-500 transition-colors ml-2 disabled:opacity-40"><Edit2 className="w-3.5 h-3.5"/></button>
                  </h3>
                  
                  {activeProfile && (
                    <div className="flex items-center gap-2 text-xs font-mono bg-gray-50 px-2 py-1 border border-gray-100 rounded text-gray-600">
                      Target IDE: {activeProfile.ide}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 z-10 overflow-y-auto max-h-[160px] pr-2">
                  {!activeProfile ? (
                    <div className="text-xs text-gray-400 italic">请选择当前功能下的配置文件...</div>
                  ) : activeProfile.projects.map((proj, idx) => (
                    <div key={idx} className="flex flex-col p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold font-mono text-gray-800">{proj.name}</span>
                        <span className="flex items-center gap-1.5 text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                          <GitBranch className="w-3 h-3" /> {proj.branch}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] font-mono text-gray-500 overflow-hidden">
                        <div className="flex items-center gap-1 truncate"><Folder className="w-3 h-3 shrink-0" /> <span className="truncate">{proj.path}</span></div>
                        <div className="flex items-center gap-1 text-orange-600/80 shrink-0"><TerminalSquare className="w-3 h-3" /> {proj.runCmd || 'none'}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 z-10 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button 
                    onClick={handleLaunch}
                    disabled={isCurrentRunning || !activeProfile}
                    className="w-full bg-gray-900 text-white rounded-lg py-3 text-sm font-medium hover:bg-black flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50"
                  >
                    {isCurrentBootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" fill="currentColor" />}
                    {isCurrentBootstrapping ? '环境构建与依赖挂载中...' : isCurrentRunning ? '当前配置运行中' : '一键启动本地环境'}
                  </button>
                  <button
                    onClick={handleStopCurrentRun}
                    disabled={!isCurrentRunning || !activeRun?.runId}
                    className="w-full border border-red-200 text-red-600 bg-white rounded-lg py-3 text-sm font-medium hover:bg-red-50 flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-40 disabled:hover:bg-white"
                  >
                    <Square className="w-4 h-4" fill="currentColor" />
                    停止当前工程
                  </button>
                </div>
              </div>
            )}

            {/* Bottom: Simulated Daemon Terminal */}
            <div className="flex-1 bg-[#111111] rounded-xl overflow-hidden shadow-lg border border-gray-800 flex flex-col min-h-0">
              <div className="h-9 bg-[#1E1E1E] flex items-center justify-between px-4 border-b border-[#2A2A2A] shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                </div>
                <div className="flex items-center gap-2">
                  {!isCurrentBootstrapping && logs.length > 0 && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                  <p className="text-[10px] font-mono text-gray-500">Local Daemon Proxy [tty1]</p>
                </div>
              </div>
              
              <div className="flex-1 p-4 font-mono text-[12px] leading-relaxed text-gray-300 overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-gray-600 flex h-full items-center justify-center italic text-xs">Waiting for daemon hook...</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {logs.map(log => (
                      <div key={log.id} className="flex gap-3">
                        <span className={`shrink-0 ${
                          log.type === 'system' ? 'text-purple-400 font-bold' :
                          log.type === 'cmd' ? 'text-gray-400' :
                          log.type === 'success' ? 'text-green-400' :
                          log.type === 'error' ? 'text-red-400' :
                          log.type === 'warn' ? 'text-amber-400' :
                          'text-gray-300'
                        }`}>
                          {log.text}
                        </span>
                      </div>
                    ))}
                    <div ref={logsRef} />
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
