import {motion, AnimatePresence} from 'motion/react';
import {Cpu, Library, Network, RefreshCw, Search} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import PageHeader from '../components/PageHeader';
import './SkillsLibrary.css';

type TabId = 'skills' | 'mcp' | 'models';

type SkillSource = 'claude' | 'cursor' | 'agents' | 'codex';

type LocalSkillEntry = {
  source: SkillSource;
  displayName: string;
  description: string;
  skillMdPath: string;
  skillDir: string;
};

type ScanPayload = {
  skills: LocalSkillEntry[];
  rootsTried: {source: SkillSource; path: string; exists: boolean}[];
  warnings: string[];
  error?: string;
};

type McpConfigKind = 'cursor-user' | 'cursor-project';

type LocalMcpServerEntry = {
  kind: McpConfigKind;
  serverName: string;
  configPath: string;
  command?: string;
  argsPreview: string;
  url?: string;
};

type McpPayload = {
  servers: LocalMcpServerEntry[];
  configsTried: {kind: McpConfigKind; path: string; exists: boolean}[];
  warnings: string[];
  error?: string;
};

type LocalModelSource = 'ollama-cli' | 'ollama-manifest' | 'lm-studio';

type LocalModelEntry = {
  source: LocalModelSource;
  name: string;
  sizeOrNote?: string;
  path?: string;
};

type ModelsPayload = {
  models: LocalModelEntry[];
  rootsTried: {label: string; path: string; exists: boolean}[];
  warnings: string[];
  error?: string;
};

const SOURCE_LABEL: Record<SkillSource | 'all', string> = {
  all: '全部',
  claude: 'Claude',
  cursor: 'Cursor',
  agents: 'Agents',
  codex: 'Codex',
};

const MCP_KIND_LABEL: Record<McpConfigKind | 'all', string> = {
  all: '全部',
  'cursor-user': '用户目录',
  'cursor-project': '本仓库',
};

const MODEL_SOURCE_LABEL: Record<LocalModelSource | 'all', string> = {
  all: '全部',
  'ollama-cli': 'Ollama（CLI）',
  'ollama-manifest': 'Ollama（缓存）',
  'lm-studio': 'LM Studio',
};

function badgeClass(source: SkillSource): string {
  switch (source) {
    case 'claude':
      return 'skills-lib__badge skills-lib__badge--claude';
    case 'cursor':
      return 'skills-lib__badge skills-lib__badge--cursor';
    case 'agents':
      return 'skills-lib__badge skills-lib__badge--agents';
    case 'codex':
      return 'skills-lib__badge skills-lib__badge--codex';
    default:
      return 'skills-lib__badge';
  }
}

function mcpBadgeClass(kind: McpConfigKind): string {
  return kind === 'cursor-user'
    ? 'skills-lib__badge skills-lib__badge--cursor'
    : 'skills-lib__badge skills-lib__badge--agents';
}

function modelBadgeClass(source: LocalModelSource): string {
  switch (source) {
    case 'ollama-cli':
      return 'skills-lib__badge skills-lib__badge--codex';
    case 'ollama-manifest':
      return 'skills-lib__badge skills-lib__badge--claude';
    case 'lm-studio':
      return 'skills-lib__badge skills-lib__badge--cursor';
    default:
      return 'skills-lib__badge';
  }
}

const emptySkills: ScanPayload = {skills: [], rootsTried: [], warnings: []};
const emptyMcp: McpPayload = {servers: [], configsTried: [], warnings: []};
const emptyModels: ModelsPayload = {models: [], rootsTried: [], warnings: []};

export default function SkillsLibrary() {
  const [tab, setTab] = useState<TabId>('skills');
  const [query, setQuery] = useState('');
  const [skillSource, setSkillSource] = useState<SkillSource | 'all'>('all');
  const [mcpKind, setMcpKind] = useState<McpConfigKind | 'all'>('all');
  const [modelSource, setModelSource] = useState<LocalModelSource | 'all'>('all');

  const [skillsData, setSkillsData] = useState<ScanPayload | null>(null);
  const [mcpData, setMcpData] = useState<McpPayload | null>(null);
  const [modelsData, setModelsData] = useState<ModelsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchErr(null);
    try {
      const [rs, rm, rmod] = await Promise.all([
        fetch('/api/local-skills'),
        fetch('/api/local-mcp'),
        fetch('/api/local-models'),
      ]);
      const [js, jm, jmod] = await Promise.all([
        rs.json() as Promise<ScanPayload>,
        rm.json() as Promise<McpPayload>,
        rmod.json() as Promise<ModelsPayload>,
      ]);

      setSkillsData(
        rs.ok ? js : {...emptySkills, warnings: js.warnings ?? [], error: js.error || `请求失败（${rs.status}）`}
      );
      setMcpData(
        rm.ok ? jm : {...emptyMcp, warnings: jm.warnings ?? [], error: jm.error || `请求失败（${rm.status}）`}
      );
      setModelsData(
        rmod.ok
          ? jmod
          : {...emptyModels, warnings: jmod.warnings ?? [], error: jmod.error || `请求失败（${rmod.status}）`}
      );
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
      setSkillsData(null);
      setMcpData(null);
      setModelsData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSkills = useMemo(() => {
    const skills = skillsData?.skills ?? [];
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (skillSource !== 'all' && s.source !== skillSource) return false;
      if (!q) return true;
      const hay = `${s.displayName}\n${s.description}\n${s.skillMdPath}\n${s.skillDir}\n${s.source}`.toLowerCase();
      return hay.includes(q);
    });
  }, [skillsData, query, skillSource]);

  const filteredMcp = useMemo(() => {
    const servers = mcpData?.servers ?? [];
    const q = query.trim().toLowerCase();
    return servers.filter((s) => {
      if (mcpKind !== 'all' && s.kind !== mcpKind) return false;
      if (!q) return true;
      const hay = `${s.serverName}\n${s.configPath}\n${s.command ?? ''}\n${s.argsPreview}\n${s.url ?? ''}\n${s.kind}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [mcpData, query, mcpKind]);

  const filteredModels = useMemo(() => {
    const models = modelsData?.models ?? [];
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (modelSource !== 'all' && m.source !== modelSource) return false;
      if (!q) return true;
      const hay = `${m.name}\n${m.path ?? ''}\n${m.sizeOrNote ?? ''}\n${m.source}`.toLowerCase();
      return hay.includes(q);
    });
  }, [modelsData, query, modelSource]);

  const copyPath = async (pathStr: string, id: string) => {
    try {
      await navigator.clipboard.writeText(pathStr);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  const tabMeta = useMemo(() => {
    switch (tab) {
      case 'skills':
        return {
          count: skillsData?.skills.length ?? 0,
          filtered: filteredSkills.length,
          warn: skillsData?.warnings,
          err: skillsData?.error,
        };
      case 'mcp':
        return {
          count: mcpData?.servers.length ?? 0,
          filtered: filteredMcp.length,
          warn: mcpData?.warnings,
          err: mcpData?.error,
        };
      case 'models':
        return {
          count: modelsData?.models.length ?? 0,
          filtered: filteredModels.length,
          warn: modelsData?.warnings,
          err: modelsData?.error,
        };
      default:
        return {count: 0, filtered: 0, warn: undefined as string[] | undefined, err: undefined as string | undefined};
    }
  }, [tab, skillsData, mcpData, modelsData, filteredSkills.length, filteredMcp.length, filteredModels.length]);

  return (
    <div className="skills-lib">
      <div className="skills-lib__inner">
        <PageHeader
          icon={Library}
          title="本地资源库"
          subtitle={
            <>
              本页汇总本机{' '}
              <strong style={{color: 'var(--text-primary)', fontWeight: 600}}>Agent 技能</strong>（
              <code className="skills-lib__inline-code">SKILL.md</code>）、
              <strong style={{color: 'var(--text-primary)', fontWeight: 600}}> Cursor MCP</strong> 与
              <strong style={{color: 'var(--text-primary)', fontWeight: 600}}> 本地模型</strong>
              （Ollama / LM Studio）。开发模式下需同时运行 deploy-api（默认 8787，经 Vite 代理）。
            </>
          }
        />

        <div className="skills-lib__tabs" role="tablist" aria-label="资源类型">
          {(
            [
              {id: 'skills' as const, label: '本地技能', Icon: Library},
              {id: 'mcp' as const, label: '本地 MCP', Icon: Network},
              {id: 'models' as const, label: '本地模型', Icon: Cpu},
            ] as const
          ).map(({id, label, Icon}) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`skills-lib__tab${tab === id ? ' skills-lib__tab--on' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon className="skills-lib__tab-icon" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="skills-lib__toolbar">
          <div className="skills-lib__search-wrap">
            <Search className="skills-lib__search-icon" aria-hidden />
            <input
              type="search"
              className="skills-lib__search"
              placeholder={
                tab === 'skills'
                  ? '按名称、描述、路径搜索技能…'
                  : tab === 'mcp'
                    ? '按 MCP 名称、命令、配置路径搜索…'
                    : '按模型名、路径搜索…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="skills-lib__chips" role="group" aria-label="筛选与操作">
            {tab === 'skills'
              ? (['all', 'claude', 'cursor', 'agents', 'codex'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`skills-lib__chip${skillSource === key ? ' skills-lib__chip--on' : ''}`}
                    onClick={() => setSkillSource(key)}
                  >
                    {SOURCE_LABEL[key]}
                  </button>
                ))
              : null}
            {tab === 'mcp'
              ? (['all', 'cursor-user', 'cursor-project'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`skills-lib__chip${mcpKind === key ? ' skills-lib__chip--on' : ''}`}
                    onClick={() => setMcpKind(key)}
                  >
                    {MCP_KIND_LABEL[key]}
                  </button>
                ))
              : null}
            {tab === 'models'
              ? (['all', 'ollama-cli', 'ollama-manifest', 'lm-studio'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`skills-lib__chip${modelSource === key ? ' skills-lib__chip--on' : ''}`}
                    onClick={() => setModelSource(key)}
                  >
                    {MODEL_SOURCE_LABEL[key]}
                  </button>
                ))
              : null}
            <button type="button" className="skills-lib__chip" onClick={() => void load()} title="重新扫描" aria-label="重新扫描">
              <RefreshCw className="skills-lib__chip-refresh" aria-hidden />
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="skills-lib__empty" role="status">
            <div className="skills-lib__spinner" />
            正在扫描本机技能、MCP 与模型…
          </div>
        ) : fetchErr ? (
          <div className="skills-lib__error">
            <p className="skills-lib__error-title">
              <Library className="h-5 w-5 shrink-0" aria-hidden />
              <strong>无法加载数据</strong>
            </p>
            <p className="skills-lib__error-msg">{fetchErr}</p>
            <p className="skills-lib__error-hint">
              请确认已执行 <code>npm run dev</code> 或单独启动 deploy-api，且 Vite 代理指向正确端口。
            </p>
          </div>
        ) : (
          <>
            <p className="skills-lib__meta">
              {tab === 'skills' ? '技能' : tab === 'mcp' ? 'MCP 服务' : '模型'}共{' '}
              <strong style={{color: 'var(--text-primary)'}}>{tabMeta.count}</strong> 项
              {query.trim() ||
              (tab === 'skills' && skillSource !== 'all') ||
              (tab === 'mcp' && mcpKind !== 'all') ||
              (tab === 'models' && modelSource !== 'all') ? (
                <>
                  ，当前显示 <strong style={{color: 'var(--primary)'}}>{tabMeta.filtered}</strong> 项
                </>
              ) : null}
            </p>
            {tabMeta.err ? (
              <p className="skills-lib__warn skills-lib__warn--error" role="alert">
                {tabMeta.err}
              </p>
            ) : null}
            {tabMeta.warn?.length ? (
              <p className="skills-lib__warn">
                {tabMeta.warn.slice(0, 3).join(' ')}
                {tabMeta.warn.length > 3 ? ` …共 ${tabMeta.warn.length} 条提示` : ''}
              </p>
            ) : null}

            {tab === 'skills' ? (
              filteredSkills.length === 0 ? (
                <div className="skills-lib__empty">
                  {skillsData && skillsData.skills.length === 0
                    ? '未发现任何 SKILL.md。可将技能放在 ~/.claude/skills、~/.cursor/skills-cursor 等目录下。'
                    : '没有符合筛选条件的技能，试试清空搜索或切换来源。'}
                </div>
              ) : (
                <div className="skills-lib__grid">
                  <AnimatePresence mode="popLayout">
                    {filteredSkills.map((s, i) => {
                      const id = s.skillMdPath;
                      return (
                        <motion.article
                          key={id}
                          layout
                          initial={{opacity: 0, y: 12}}
                          animate={{opacity: 1, y: 0}}
                          exit={{opacity: 0, scale: 0.96}}
                          transition={{delay: Math.min(i * 0.03, 0.45), duration: 0.35, ease: [0.22, 1, 0.36, 1]}}
                          className="skills-lib__card"
                        >
                          <div className="skills-lib__card-head">
                            <h2 className="skills-lib__card-name">{s.displayName}</h2>
                            <span className={badgeClass(s.source)}>{SOURCE_LABEL[s.source]}</span>
                          </div>
                          {s.description ? <p className="skills-lib__desc">{s.description}</p> : <p className="skills-lib__desc">（无描述）</p>}
                          <p className="skills-lib__path">{s.skillMdPath}</p>
                          <div className="skills-lib__actions">
                            <button
                              type="button"
                              className={`skills-lib__copy${copiedId === id ? ' skills-lib__copy--done' : ''}`}
                              onClick={() => void copyPath(s.skillMdPath, id)}
                            >
                              {copiedId === id ? '已复制路径' : '复制路径'}
                            </button>
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )
            ) : null}

            {tab === 'mcp' ? (
              filteredMcp.length === 0 ? (
                <div className="skills-lib__empty">
                  {mcpData && mcpData.servers.length === 0
                    ? '未发现 MCP 配置。可在 ~/.cursor/mcp.json 或本仓库 .cursor/mcp.json 中配置 mcpServers。'
                    : '没有符合筛选条件的 MCP，试试清空搜索或切换来源。'}
                </div>
              ) : (
                <div className="skills-lib__grid">
                  <AnimatePresence mode="popLayout">
                    {filteredMcp.map((s, i) => {
                      const id = `${s.configPath}::${s.serverName}`;
                      return (
                        <motion.article
                          key={id}
                          layout
                          initial={{opacity: 0, y: 12}}
                          animate={{opacity: 1, y: 0}}
                          exit={{opacity: 0, scale: 0.96}}
                          transition={{delay: Math.min(i * 0.03, 0.45), duration: 0.35, ease: [0.22, 1, 0.36, 1]}}
                          className="skills-lib__card"
                        >
                          <div className="skills-lib__card-head">
                            <h2 className="skills-lib__card-name">{s.serverName}</h2>
                            <span className={mcpBadgeClass(s.kind)}>{MCP_KIND_LABEL[s.kind]}</span>
                          </div>
                          {s.command ? <p className="skills-lib__desc">命令：{s.command}</p> : null}
                          {s.url ? <p className="skills-lib__desc">URL：{s.url}</p> : null}
                          {s.argsPreview ? <p className="skills-lib__path skills-lib__path--args">{s.argsPreview}</p> : null}
                          <p className="skills-lib__path">{s.configPath}</p>
                          <div className="skills-lib__actions">
                            <button
                              type="button"
                              className={`skills-lib__copy${copiedId === id ? ' skills-lib__copy--done' : ''}`}
                              onClick={() => void copyPath(s.configPath, id)}
                            >
                              {copiedId === id ? '已复制配置路径' : '复制配置路径'}
                            </button>
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )
            ) : null}

            {tab === 'models' ? (
              filteredModels.length === 0 ? (
                <div className="skills-lib__empty">
                  {modelsData && modelsData.models.length === 0
                    ? '未发现本地模型。可安装 Ollama 并拉取模型，或将 .gguf 放入 LM Studio 模型目录。'
                    : '没有符合筛选条件的模型，试试清空搜索或切换来源。'}
                </div>
              ) : (
                <div className="skills-lib__grid">
                  <AnimatePresence mode="popLayout">
                    {filteredModels.map((m, i) => {
                      const id = m.path ?? `${m.source}::${m.name}`;
                      return (
                        <motion.article
                          key={id}
                          layout
                          initial={{opacity: 0, y: 12}}
                          animate={{opacity: 1, y: 0}}
                          exit={{opacity: 0, scale: 0.96}}
                          transition={{delay: Math.min(i * 0.03, 0.45), duration: 0.35, ease: [0.22, 1, 0.36, 1]}}
                          className="skills-lib__card"
                        >
                          <div className="skills-lib__card-head">
                            <h2 className="skills-lib__card-name">{m.name}</h2>
                            <span className={modelBadgeClass(m.source)}>{MODEL_SOURCE_LABEL[m.source]}</span>
                          </div>
                          {m.sizeOrNote ? <p className="skills-lib__desc">{m.sizeOrNote}</p> : null}
                          {m.path ? <p className="skills-lib__path">{m.path}</p> : null}
                          <div className="skills-lib__actions">
                            {m.path ? (
                              <button
                                type="button"
                                className={`skills-lib__copy${copiedId === id ? ' skills-lib__copy--done' : ''}`}
                                onClick={() => void copyPath(m.path!, id)}
                              >
                                {copiedId === id ? '已复制路径' : '复制路径'}
                              </button>
                            ) : null}
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
