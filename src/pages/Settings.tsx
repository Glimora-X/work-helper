import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, SlidersHorizontal, Trash2, FolderOpen, KeyRound } from 'lucide-react';
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
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvLoading(false);
    }
  }, []);

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
      setEnvHint(data.hint ?? '已保存');
      await loadEnv();
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
            <KeyRound className="h-4 w-4 shrink-0" style={{ color: 'var(--color-brand-amber-deep)' }} />
            <h2 className="pkmer-panel__title">Jenkins / Jira / Wiki（.env）</h2>
          </div>
          {envMeta ? (
            <p className="mb-4 font-mono text-[10px] leading-relaxed pkmer-text-secondary break-all">
              读取：{envMeta.dotenvReadPath}
              <br />
              写入：{envMeta.dotenvWritePath}
              {envMeta.fileExists ? '' : '（将创建新文件）'}
            </p>
          ) : null}
          {envLoading ? (
            <div className="flex items-center gap-2 text-xs pkmer-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : envError ? (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>
              {envError}
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {ENV_GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide pkmer-text-muted">{g.title}</h3>
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
                            onChange={(e) => setPlainValues((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="pkmer-input-line pkmer-input-line--mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {envHint ? (
                <p className="text-xs" style={{ color: 'var(--success)' }}>
                  {envHint}
                </p>
              ) : null}
              <button
                type="button"
                disabled={envSaving}
                onClick={() => void saveEnv()}
                className="pkmer-btn pkmer-btn--accent w-fit px-5 py-2.5 text-sm"
              >
                {envSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                合并写入 .env
              </button>
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
