import {motion, AnimatePresence} from 'motion/react';
import {Library, RefreshCw, Search} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import PageHeader from '../components/PageHeader';
import './SkillsLibrary.css';

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

const SOURCE_LABEL: Record<SkillSource | 'all', string> = {
  all: '全部',
  claude: 'Claude',
  cursor: 'Cursor',
  agents: 'Agents',
  codex: 'Codex',
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

export default function SkillsLibrary() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SkillSource | 'all'>('all');
  const [data, setData] = useState<ScanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchErr(null);
    try {
      const res = await fetch('/api/local-skills');
      const json = (await res.json()) as ScanPayload;
      if (!res.ok) {
        setFetchErr(json.error || `请求失败（${res.status}）`);
        setData({skills: [], rootsTried: [], warnings: json.warnings || []});
        return;
      }
      setData(json);
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const skills = data?.skills ?? [];
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (source !== 'all' && s.source !== source) return false;
      if (!q) return true;
      const hay = `${s.displayName}\n${s.description}\n${s.skillMdPath}\n${s.skillDir}\n${s.source}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, query, source]);

  const copyPath = async (path: string, id: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="skills-lib">
      <div className="skills-lib__inner">
        <PageHeader
          icon={Library}
          title="本地技能库"
          subtitle={
            <>
              扫描本机常见目录中的{' '}
              <code
                style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '0.85em',
                  color: 'var(--primary)',
                  background: 'rgba(59, 130, 246, 0.1)',
                  padding: '0.1em 0.4em',
                  borderRadius: 5,
                  border: '1px solid rgba(59, 130, 246, 0.18)',
                }}
              >
                SKILL.md
              </code>{' '}
              （Claude、Cursor、Agents、Codex）。开发模式下需同时运行 deploy-api（默认 8787 端口）。
            </>
          }
        />

        <div className="skills-lib__toolbar">
          <div className="skills-lib__search-wrap">
            <Search className="skills-lib__search-icon" aria-hidden />
            <input
              type="search"
              className="skills-lib__search"
              placeholder="按名称、描述、路径搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索技能"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="skills-lib__chips" role="group" aria-label="按来源筛选">
            {(['all', 'claude', 'cursor', 'agents', 'codex'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={`skills-lib__chip${source === key ? ' skills-lib__chip--on' : ''}`}
                onClick={() => setSource(key)}
              >
                {SOURCE_LABEL[key]}
              </button>
            ))}
            <button
              type="button"
              className="skills-lib__chip"
              onClick={() => void load()}
              title="重新扫描"
              aria-label="重新扫描"
            >
              <RefreshCw
                className="inline-block h-3.5 w-3.5 align-middle"
                style={{marginRight: '0.25rem', opacity: 0.85}}
              />
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="skills-lib__empty" role="status">
            <div className="skills-lib__spinner" />
            正在扫描本机技能…
          </div>
        ) : fetchErr ? (
          <div className="skills-lib__error">
            <p style={{margin: '0 0 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem'}}>
              <Library className="h-5 w-5 shrink-0" aria-hidden />
              <strong>无法加载技能数据</strong>
            </p>
            <p style={{margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)'}}>{fetchErr}</p>
            <p style={{margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)'}}>
              请确认已执行 <code>npm run dev</code> 或单独启动 deploy-api，且 Vite 代理指向正确端口。
            </p>
          </div>
        ) : (
          <>
            <p className="skills-lib__meta">
              共 <strong style={{color: 'var(--text-primary)'}}>{data?.skills.length ?? 0}</strong> 项技能
              {query.trim() || source !== 'all' ? (
                <>
                  ，当前显示 <strong style={{color: 'var(--primary)'}}>{filtered.length}</strong> 项
                </>
              ) : null}
            </p>
            {data?.warnings?.length ? (
              <p className="skills-lib__warn">
                {data.warnings.slice(0, 3).join(' ')}
                {data.warnings.length > 3 ? ` …共 ${data.warnings.length} 条提示` : ''}
              </p>
            ) : null}

            {filtered.length === 0 ? (
              <div className="skills-lib__empty">
                {data && data.skills.length === 0
                  ? '未发现任何 SKILL.md。若你使用自定义路径，可将技能放在 ~/.claude/skills 等标准目录下。'
                  : '没有符合筛选条件的技能，试试清空搜索或切换来源。'}
              </div>
            ) : (
              <div className="skills-lib__grid">
                <AnimatePresence mode="popLayout">
                  {filtered.map((s, i) => {
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
            )}
          </>
        )}
      </div>
    </div>
  );
}

