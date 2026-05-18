import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, SlidersHorizontal, Trash2, FolderOpen, KeyRound, CheckCircle2, XCircle, HelpCircle, AlertCircle, ChevronDown, ChevronRight, Expand, ChevronsUp } from 'lucide-react';
import PageHeader from '../components/PageHeader';

type ProjectCatalogEntry = { id: string; name: string; path: string };

type EnvFieldPlain = { kind: 'plain'; value: string };
type EnvFieldSecret = { kind: 'secret'; configured: boolean };
type EnvField = EnvFieldPlain | EnvFieldSecret;

type EnvUiResponse = {
  dotenvReadPath: string;
  dotenvWritePath: string;
  fileExists: boolean;
  fields: Record<string, EnvField>;
};

const ENV_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Jenkins', keys: ['JENKINS_USER', 'JENKINS_TOKEN'] },
  {
    title: 'Jira',
    keys: ['JIRA_SERVER_URL', 'JIRA_USERNAME', 'JIRA_PASSWORD', 'JIRA_API_TOKEN', 'JIRA_REST_PATH_PREFIX'],
  },
  {
    title: 'Confluence / Wiki',
    keys: ['CONFLUENCE_BASE_URL', 'CONFLUENCE_USERNAME', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD'],
  },
  {
    title: '知识库路径与搜索',
    keys: ['ASSISTANT_KB_LOCAL_DIRS', 'ASSISTANT_KB_SEARCH_URLS', 'ASSISTANT_WIKI_SEARCH_URL_TEMPLATE'],
  },
];

function isSecretKey(key: string): boolean {
  return (
    key.includes('TOKEN') ||
    key.includes('PASSWORD') ||
    key === 'JENKINS_TOKEN' ||
    key === 'JIRA_PASSWORD'
  );
}

export default function Settings() {
  const [catalog, setCatalog] = useState<ProjectCatalogEntry[]>([]);
  const [catalogPath, setCatalogPath] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSaving, setCatalogSaving] = useState(false);

  const [envMeta, setEnvMeta] = useState<Pick<EnvUiResponse, 'dotenvReadPath' | 'dotenvWritePath' | 'fileExists'> | null>(
    null
  );
  const [plainValues, setPlainValues] = useState<Record<string, string>>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [clearSecrets, setClearSecrets] = useState<Record<string, boolean>>({});
  const [secretConfigured, setSecretConfigured] = useState<Record<string, boolean>>({});
  const [envLoading, setEnvLoading] = useState(true);
  const [envSaving, setEnvSaving] = useState(false);
  const [envHint, setEnvHint] = useState<string | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [connectionTestResults, setConnectionTestResults] = useState<Record<string, 'success' | 'error' | null>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/assistant/project-catalog');
      const data = (await res.json()) as { path?: string; entries?: ProjectCatalogEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCatalogPath(data.path ?? '');
      setCatalog(Array.isArray(data.entries) ? data.entries : []);
    } catch (e) {
      setCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadEnv = useCallback(async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const res = await fetch('/api/assistant/env-ui');
      const data = (await res.json()) as EnvUiResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEnvMeta({
        dotenvReadPath: data.dotenvReadPath,
        dotenvWritePath: data.dotenvWritePath,
        fileExists: data.fileExists,
      });
      const plain: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      const configured: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(data.fields ?? {})) {
        if (v.kind === 'plain') plain[k] = v.value;
        else {
          secrets[k] = '';
          configured[k] = v.configured;
        }
      }
      setPlainValues(plain);
      setSecretInputs(secrets);
      setSecretConfigured(configured);
      setClearSecrets({});
      setValidationErrors({});
      setConnectionTestResults({});
      // Auto-expand first group on initial load
      if (Object.keys(expandedGroups).length === 0) {
        setExpandedGroups({ 'Jenkins': true });
      }
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvLoading(false);
    }
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveEnv();
        void saveCatalog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [plainValues, secretInputs, catalog]);

  const toggleGroup = (title: string) => {
    setExpandedGroups(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    ENV_GROUPS.forEach(g => { allExpanded[g.title] = true; });
    setExpandedGroups(allExpanded);
  };

  const collapseAll = () => {
    setExpandedGroups({});
  };

  const testConnection = async (service: 'jenkins' | 'jira' | 'confluence') => {
    setTestingConnection(service);
    try {
      const endpoint = `/api/assistant/test-connection/${service}`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = (await res.json()) as { success?: boolean; error?: string };
      
      if (res.ok && data.success) {
        setConnectionTestResults(prev => ({ ...prev, [service]: 'success' }));
        setTimeout(() => {
          setConnectionTestResults(prev => ({ ...prev, [service]: null }));
        }, 3000);
      } else {
        setConnectionTestResults(prev => ({ ...prev, [service]: 'error' }));
        setEnvError(data.error || `${service} 连接测试失败`);
      }
    } catch (e) {
      setConnectionTestResults(prev => ({ ...prev, [service]: 'error' }));
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingConnection(null);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadEnv();
  }, [loadEnv]);

  const updateCatalogRow = (id: string, field: 'name' | 'path', value: string) => {
    setCatalog((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addCatalogRow = () => {
    setCatalog((prev) => [...prev, { id: `row_${Date.now()}`, name: '', path: '' }]);
  };

  const removeCatalogRow = (id: string) => {
    setCatalog((prev) => prev.filter((r) => r.id !== id));
  };

  const saveCatalog = async () => {
    setCatalogSaving(true);
    try {
      const res = await fetch('/api/assistant/project-catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: catalog }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadCatalog();
    } catch (e) {
      console.error(e);
    } finally {
      setCatalogSaving(false);
    }
  };

  const saveEnv = async () => {
    // Validate before saving
    const errors: Record<string, string> = {};
    if (plainValues['JENKINS_USER'] && !plainValues['JENKINS_TOKEN']) {
      errors['JENKINS_TOKEN'] = 'Jenkins Token 是必需的';
    }
    if (plainValues['JIRA_SERVER_URL'] && !plainValues['JIRA_USERNAME'] && !plainValues['JIRA_API_TOKEN']) {
      errors['JIRA_API_TOKEN'] = 'Jira API Token 或用户名是必需的';
    }
    
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setEnvError('请修复验证错误后再保存');
      return;
    }

    setEnvSaving(true);
    setEnvHint(null);
    setEnvError(null);
    try {
      const patch: Record<string, string> = { ...plainValues };
      for (const [k, v] of Object.entries(secretInputs)) {
        const s = typeof v === 'string' ? v : String(v ?? '');
        if (s.trim()) patch[k] = s;
      }
      const removeKeys = Object.entries(clearSecrets)
        .filter(([, on]) => on)
        .map(([k]) => k);
      const res = await fetch('/api/assistant/env-ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch, removeKeys }),
      });
      const data = (await res.json()) as { hint?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEnvHint(data.hint ?? '✅ 已成功保存到 .env 文件');
      await loadEnv();
      // Clear hint after 3 seconds
      setTimeout(() => setEnvHint(null), 3000);
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvSaving(false);
    }
  };

  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--narrow">
        <PageHeader
          icon={SlidersHorizontal}
          title="设置"
          subtitle="维护本地工程目录表，以及 Jenkins / Jira / Wiki 等写入项目 .env 的凭据（由本机 deploy-api 落盘）"
        />

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <section className="pkmer-panel">
          <div className="pkmer-panel__head">
            <FolderOpen className="h-4 w-4 pkmer-icon-indigo shrink-0" />
            <h2 className="pkmer-panel__title">启动工程目录</h2>
            <span className="pkmer-panel__meta">保存至 {catalogPath || 'config/assistant-project-catalog.json'}</span>
          </div>
          <p className="mb-4 text-xs leading-relaxed pkmer-text-secondary">
            为常用仓库登记「显示名」与「本地路径」。在「启动」页编辑工作区时，可从下拉框一键填入名称与路径。
          </p>
          {catalogLoading ? (
            <div className="flex items-center gap-2 text-xs pkmer-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {catalog.length === 0 ? (
                  <p className="text-xs pkmer-text-muted">暂无登记，点击下方添加一行。</p>
                ) : (
                  catalog.map((row) => (
                    <div key={row.id} className="pkmer-stack-row pkmer-stack-row--catalog">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateCatalogRow(row.id, 'name', e.target.value)}
                        placeholder="工程名，如 cc-web"
                        className="pkmer-input-line pkmer-input-line--mono"
                      />
                      <input
                        type="text"
                        value={row.path}
                        onChange={(e) => updateCatalogRow(row.id, 'path', e.target.value)}
                        placeholder="~/Documents/work-space/..."
                        className="pkmer-input-line pkmer-input-line--mono"
                      />
                      <button
                        type="button"
                        onClick={() => removeCatalogRow(row.id)}
                        className="pkmer-btn-delete-row"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> 删除
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={addCatalogRow} className="pkmer-btn-dashed">
                  <Plus className="h-3.5 w-3.5" /> 添加一行
                </button>
                <button
                  type="button"
                  disabled={catalogSaving}
                  onClick={() => void saveCatalog()}
                  className="pkmer-btn-ink text-sm px-4 py-2"
                >
                  {catalogSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存目录表
                </button>
              </div>
            </>
          )}
        </section>

        <section className="pkmer-panel">
          <div className="pkmer-panel__head">
            <KeyRound className="h-4 w-4 pkmer-icon-secondary shrink-0" />
            <h2 className="pkmer-panel__title">Jenkins / Jira / Wiki（.env）</h2>
            <span className="pkmer-panel__meta">⌘S 快速保存</span>
          </div>
          {envMeta ? (
            <details className="mb-4 rounded-lg">
              <summary className="cursor-pointer text-[10px] font-mono pkmer-text-secondary hover:pkmer-text-body">
                路径详情
              </summary>
              <p className="mt-2 font-mono text-[10px] leading-relaxed pkmer-text-secondary break-all pl-3">
                读取：{envMeta.dotenvReadPath}
                <br />
                写入：{envMeta.dotenvWritePath}
                {envMeta.fileExists ? '' : '（将创建新文件）'}
              </p>
            </details>
          ) : null}
          {envLoading ? (
            <div className="flex items-center gap-2 text-xs pkmer-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : envError ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs" style={{ color: 'var(--danger)' }}>
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{envError}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <span className="text-xs pkmer-text-muted">点击组标题展开/收起配置项</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={expandAll}
                    className="text-xs pkmer-link-indigo hover:underline flex items-center gap-1"
                  >
                    <Expand className="h-3 w-3" /> 全部展开
                  </button>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="text-xs pkmer-link-indigo hover:underline flex items-center gap-1"
                  >
                    <ChevronsUp className="h-3 w-3" /> 全部收起
                  </button>
                </div>
              </div>

              {ENV_GROUPS.map((g) => {
                const helpText: Record<string, string> = {
                  'Jenkins': 'Jenkins 用户凭据，用于触发构建和部署流水线',
                  'Jira': 'Jira 服务器地址和认证信息，用于任务跟踪和周报生成',
                  'Confluence / Wiki': 'Confluence/Wiki 访问凭据，用于知识库搜索和文档集成',
                  '知识库路径与搜索': '本地知识库目录和远程搜索 URL，AI 助手的知识来源',
                };
                
                const isExpanded = expandedGroups[g.title] || false;
                const configuredCount = g.keys.filter(key => {
                  if (isSecretKey(key)) return secretConfigured[key];
                  return plainValues[key] && plainValues[key].trim() !== '';
                }).length;
                const statusText = configuredCount === 0 ? '未配置' : configuredCount === g.keys.length ? '已配置' : `部分配置 (${configuredCount}/${g.keys.length})`;
                const statusColor = configuredCount === 0 ? 'pkmer-text-muted' : configuredCount === g.keys.length ? 'text-green-600' : 'text-amber-600';
                
                return (
                  <div key={g.title} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                    {/* Group Header - Always Visible */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.title)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 pkmer-text-muted shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 pkmer-text-muted shrink-0" />
                      )}
                      <h3 className="text-sm font-semibold pkmer-text-body flex-1">{g.title}</h3>
                      <span className={`text-xs font-medium ${statusColor}`}>{statusText}</span>
                      {['Jenkins', 'Jira', 'Confluence / Wiki'].includes(g.title) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const service = g.title.includes('Jenkins') ? 'jenkins' : g.title.includes('Jira') ? 'jira' : 'confluence';
                            void testConnection(service);
                          }}
                          disabled={testingConnection !== null}
                          className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] pkmer-text-secondary hover:border-gray-300 hover:pkmer-text-body disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {testingConnection === (g.title.includes('Jenkins') ? 'jenkins' : g.title.includes('Jira') ? 'jira' : 'confluence') ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" /> 测试中…
                            </>
                          ) : connectionTestResults[g.title.includes('Jenkins') ? 'jenkins' : g.title.includes('Jira') ? 'jira' : 'confluence'] === 'success' ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-green-600" /> 成功
                            </>
                          ) : connectionTestResults[g.title.includes('Jenkins') ? 'jenkins' : g.title.includes('Jira') ? 'jira' : 'confluence'] === 'error' ? (
                            <>
                              <XCircle className="h-3 w-3 text-red-600" /> 失败
                            </>
                          ) : (
                            '测试连接'
                          )}
                        </button>
                      )}
                    </button>

                    {/* Group Content - Expandable */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/50">
                        <div className="mb-3 flex items-center gap-2">
                          <div className="group relative">
                            <HelpCircle className="h-3.5 w-3.5 pkmer-text-muted cursor-help" />
                            <div className="absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-lg border border-gray-200 bg-white p-2 text-xs font-normal normal-case tracking-normal text-gray-700 shadow-lg group-hover:block">
                              {helpText[g.title]}
                            </div>
                          </div>
                          <span className="text-xs pkmer-text-muted">{helpText[g.title]}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                      {g.keys.map((key) => {
                        const secret = isSecretKey(key);
                        if (secret) {
                          const configured = secretConfigured[key];
                          const wantClear = clearSecrets[key];
                          return (
                            <div key={key} className="pkmer-field-box">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <label className="font-mono text-[10px] pkmer-text-secondary">{key}</label>
                                {configured ? (
                                  <span className="pkmer-badge-success">已配置</span>
                                ) : (
                                  <span className="text-[10px] pkmer-text-muted">未配置</span>
                                )}
                              </div>
                              <input
                                type="password"
                                autoComplete="off"
                                value={secretInputs[key] ?? ''}
                                onChange={(e) => setSecretInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder="留空则不修改；填写则覆盖保存"
                                className="pkmer-input-line pkmer-input-line--mono"
                              />
                              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] pkmer-text-secondary">
                                <input
                                  type="checkbox"
                                  checked={wantClear}
                                  onChange={(e) => setClearSecrets((prev) => ({ ...prev, [key]: e.target.checked }))}
                                />
                                从 .env 中删除此项（保存时生效）
                              </label>
                            </div>
                          );
                        }
                        return (
                          <div key={key} className="pkmer-field-box">
                            <label className="mb-1 block font-mono text-[10px] pkmer-text-secondary">{key}</label>
                            <input
                              type="text"
                              value={plainValues[key] ?? ''}
                              onChange={(e) => {
                                setPlainValues((prev) => ({ ...prev, [key]: e.target.value }));
                                if (validationErrors[key]) {
                                  setValidationErrors(prev => {
                                    const next = { ...prev };
                                    delete next[key];
                                    return next;
                                  });
                                }
                              }}
                              className={`pkmer-input-line pkmer-input-line--mono ${validationErrors[key] ? 'border-red-500 focus:border-red-500' : ''}`}
                            />
                            {validationErrors[key] && (
                              <p className="mt-1 flex items-center gap-1 text-[10px] text-red-600">
                                <AlertCircle className="h-3 w-3" /> {validationErrors[key]}
                              </p>
                            )}
                          </div>
                        );
                      })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {/* Sticky Footer Action Bar */}
              <div className="sticky bottom-0 z-10 bg-gradient-to-t from-white via-white to-transparent pt-4 pb-2 -mx-1 px-1">
                {envHint ? (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{envHint}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="flex items-center gap-2 text-xs pkmer-text-muted">
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>修改后记得保存</span>
                  </div>
                  <button
                    type="button"
                    disabled={envSaving}
                    onClick={() => void saveEnv()}
                    className="pkmer-btn pkmer-btn--accent px-6 py-2.5 text-sm shadow-lg hover:shadow-xl transition-all"
                  >
                    {envSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    合并写入 .env
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
