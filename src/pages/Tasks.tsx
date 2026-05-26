import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import PageHeader from '../components/PageHeader';
import {deployApiUrl} from '../lib/deploy-api-url';
import {
  appendJiraIssuesToToday,
  carryYesterdayIncompleteToToday,
  DAILY_TODOS_STORAGE_KEY,
  DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT,
  hasAutogenRunForDate,
  loadDailyTodos,
  markAutogenRunForDate,
  shiftISODate,
  todayISODate,
  type DailyTodoItem,
} from '../lib/daily-todos-storage';

/** 与 PKMer 文档站正文栈一致（见 themes/pkmer-doc-highlightr） */
const FONT_BODY = 'var(--font-body), "Noto Sans SC", "PingFang SC", sans-serif';

type TodoItem = DailyTodoItem;

function formatDateHeading(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dt);
}

/** 按本地日历判断该 ISO 日期是否为周五 */
function isFridayISODate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 5;
}

/** 未完成在前、已完成在后，各组内保持原有相对顺序 */
function todosDoneLast<T extends {done: boolean}>(list: T[]): T[] {
  return [...list.filter((t) => !t.done), ...list.filter((t) => t.done)];
}

type JiraStatusPayload = {configured?: boolean; serverUrl?: string};

type IncrementalAutogenResult = {carried: number; jira: number};

function normalizeStoreFromDisk(): Record<string, TodoItem[]> {
  const raw = loadDailyTodos();
  const normalized: Record<string, TodoItem[]> = {};
  for (const [k, list] of Object.entries(raw)) {
    if (Array.isArray(list) && list.length > 0) normalized[k] = todosDoneLast(list);
  }
  return normalized;
}

async function runIncrementalAutogenForToday(): Promise<IncrementalAutogenResult> {
  const carried = carryYesterdayIncompleteToToday();
  let jira = 0;
  try {
    const r = await fetch(deployApiUrl('jira', '/my-created-week'));
    if (r.ok) {
      const j = (await r.json()) as {
        issues?: {key: string; fields?: {summary?: string}}[];
      };
      jira = appendJiraIssuesToToday(
        (j.issues ?? []).map((row) => ({
          key: row.key,
          summary: row.fields?.summary,
        })),
      );
    }
  } catch {
    /* Jira 未配置或网络失败时仅结转昨日 */
  }
  return {carried, jira};
}

function jiraBrowseHref(serverUrl: string | undefined, issueKey: string): string | undefined {
  const base = serverUrl?.trim().replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/browse/${encodeURIComponent(issueKey)}`;
}

/** 从正文或 jiraKey 解析出 Jira 号，并把开头的 `[KEY]` 渲染为打开 Jira 的超链接 */
function TodoItemBody({
  text,
  jiraKey,
  jiraServerUrl,
  done,
}: {
  text: string;
  jiraKey?: string;
  jiraServerUrl?: string;
  done: boolean;
}) {
  const fromField = jiraKey?.trim().toUpperCase() ?? '';
  const fromBracket = (() => {
    const m = text.match(/^\[([A-Z][A-Z0-9]+-\d+)\]/i);
    return m ? m[1].toUpperCase() : '';
  })();
  const resolvedKey = fromField || fromBracket;
  const href = resolvedKey && jiraServerUrl ? jiraBrowseHref(jiraServerUrl, resolvedKey) : undefined;
  const bracket = `[${resolvedKey}]`;
  const styleSpan: CSSProperties = {
    color: 'var(--text-primary)',
    textDecoration: done ? 'line-through' : undefined,
    opacity: done ? 0.65 : 1,
  };

  if (href && resolvedKey) {
    const headLen = bracket.length;
    const startsWithBracket =
      text.length >= headLen && text.slice(0, headLen).toUpperCase() === bracket.toUpperCase();

    const linkEl = (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 font-mono text-sm font-semibold no-underline hover:underline shrink-0"
        style={{color: 'var(--accent-primary)'}}
        onClick={(e) => e.stopPropagation()}
      >
        {bracket}
        <ExternalLink className="w-3.5 h-3.5 opacity-70" aria-hidden />
      </a>
    );

    if (startsWithBracket) {
      const rest = text.slice(headLen).replace(/^\s+/, '');
      return (
        <span className="flex-1 text-base leading-relaxed break-words" style={styleSpan}>
          {linkEl}
          {rest ? <span> {rest}</span> : null}
        </span>
      );
    }

    return (
      <span className="flex-1 text-base leading-relaxed break-words" style={styleSpan}>
        {linkEl}
        <span> {text}</span>
      </span>
    );
  }

  return (
    <span className="flex-1 text-base leading-relaxed break-words" style={styleSpan}>
      {text}
    </span>
  );
}

export default function Tasks() {
  const [store, setStore] = useState<Record<string, TodoItem[]>>({});
  const [selectedDate, setSelectedDate] = useState(todayISODate);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [jiraServerUrl, setJiraServerUrl] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const dragFromIndex = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [autogenBusy, setAutogenBusy] = useState(false);
  const [autogenHint, setAutogenHint] = useState<string | null>(null);

  useEffect(() => {
    const raw = loadDailyTodos();
    const normalized: Record<string, TodoItem[]> = {};
    for (const [k, list] of Object.entries(raw)) {
      if (Array.isArray(list) && list.length > 0) normalized[k] = todosDoneLast(list);
    }
    setStore(normalized);
    setHydrated(true);
  }, []);

  const applyIncrementalAutogenResult = useCallback((result: IncrementalAutogenResult) => {
    setStore(normalizeStoreFromDisk());
    const {carried, jira} = result;
    const total = carried + jira;
    setAutogenHint(
      total > 0
        ? `已增量加入 ${total} 条（昨日未完成 ${carried}，本周 Jira ${jira}）`
        : '没有可新增项（今日已包含昨日未完成与本周 Jira）',
    );
  }, []);

  useEffect(() => {
    if (!autogenHint) return;
    const t = window.setTimeout(() => setAutogenHint(null), 4000);
    return () => window.clearTimeout(t);
  }, [autogenHint]);

  const triggerIncrementalAutogen = useCallback(
    async (opts: {markDaily: boolean}) => {
      setAutogenBusy(true);
      try {
        const result = await runIncrementalAutogenForToday();
        if (opts.markDaily) markAutogenRunForDate(todayISODate());
        applyIncrementalAutogenResult(result);
      } finally {
        setAutogenBusy(false);
      }
    },
    [applyIncrementalAutogenResult],
  );

  /** 每日一次：昨日未完成结转 + 本周指派且创建的 Jira 工单 */
  useEffect(() => {
    if (!hydrated) return;
    if (hasAutogenRunForDate(todayISODate())) return;
    let cancelled = false;
    (async () => {
      const result = await runIncrementalAutogenForToday();
      if (cancelled) return;
      markAutogenRunForDate(todayISODate());
      setStore(normalizeStoreFromDisk());
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const onManualIncrementalAutogen = () => {
    void triggerIncrementalAutogen({markDaily: false});
  };

  /** 周五当天若没有「写周报」则自动补一条（切换回该周五时会再次检查） */
  useEffect(() => {
    if (!hydrated) return;
    if (!isFridayISODate(selectedDate)) return;
    setStore((prev) => {
      const list = prev[selectedDate] ?? [];
      if (list.some((t) => t.text.trim() === DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT)) return prev;
      const item: TodoItem = {
        id: crypto.randomUUID(),
        text: DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT,
        done: false,
        createdAt: Date.now(),
      };
      return {...prev, [selectedDate]: todosDoneLast([...list, item])};
    });
  }, [hydrated, selectedDate]);

  useEffect(() => {
    setEditingId(null);
    setEditDraft('');
  }, [selectedDate]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(deployApiUrl('jira', '/status'));
        const j = (await r.json()) as JiraStatusPayload;
        if (cancelled || !j?.configured || typeof j.serverUrl !== 'string') return;
        setJiraServerUrl(j.serverUrl.replace(/\/$/, ''));
      } catch {
        /* 未配置 Jira 时条目仍为纯文本 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const cleaned: Record<string, TodoItem[]> = {};
    for (const [k, list] of Object.entries(store)) {
      if (Array.isArray(list) && list.length > 0) cleaned[k] = list;
    }
    localStorage.setItem(DAILY_TODOS_STORAGE_KEY, JSON.stringify(cleaned));
  }, [store, hydrated]);

  const todos = store[selectedDate] ?? [];

  const historyDates = useMemo(() => {
    return Object.keys(store)
      .filter((d) => (store[d]?.length ?? 0) > 0)
      .sort((a, b) => b.localeCompare(a));
  }, [store]);

  const setTodosForDate = useCallback((date: string, next: TodoItem[]) => {
    const ordered = todosDoneLast(next);
    setStore((prev) => {
      const copy = {...prev};
      if (ordered.length === 0) delete copy[date];
      else copy[date] = ordered;
      return copy;
    });
  }, []);

  const addTodo = () => {
    const text = draft.trim();
    if (!text) return;
    const item: TodoItem = {
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    };
    setTodosForDate(selectedDate, [...todos, item]);
    setDraft('');
  };

  const toggleTodo = (id: string) => {
    setTodosForDate(
      selectedDate,
      todos.map((t) => (t.id === id ? {...t, done: !t.done} : t)),
    );
  };

  const removeTodo = (id: string) => {
    setTodosForDate(
      selectedDate,
      todos.filter((t) => t.id !== id),
    );
  };

  const updateTodoText = (id: string, text: string) => {
    setTodosForDate(
      selectedDate,
      todos.map((t) => (t.id === id ? {...t, text} : t)),
    );
  };

  const moveTodo = useCallback((from: number, to: number) => {
    if (from === to) return;
    setStore((prev) => {
      const list = todosDoneLast([...(prev[selectedDate] ?? [])]);
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return prev;
      const [row] = list.splice(from, 1);
      list.splice(to, 0, row);
      return {...prev, [selectedDate]: todosDoneLast(list)};
    });
  }, [selectedDate]);

  const startEdit = (t: TodoItem) => {
    setEditingId(t.id);
    setEditDraft(t.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  const commitEdit = () => {
    if (!editingId) return;
    const text = editDraft.trim();
    if (!text) {
      cancelEdit();
      return;
    }
    updateTodoText(editingId, text);
    cancelEdit();
  };

  const onNewTodoKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    addTodo();
  };

  const isToday = selectedDate === todayISODate();

  return (
    <div className="pkmer-page" style={{fontFamily: FONT_BODY}}>
      <div className="pkmer-page-inner pkmer-page-inner--wide">
        <PageHeader
          title="每日待办"
          subtitle="按日期记录任务，数据保存在本机浏览器"
        />

        <div className="pkmer-content-fill">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,220px)_1fr] lg:items-stretch">
        {/* 历史日期 */}
        <aside className="pkmer-card flex max-h-[min(50vh,24rem)] min-h-0 flex-col p-4 md:p-5 lg:max-h-none">
          <div className="mb-4 flex shrink-0 items-center gap-2" style={{color: 'var(--text-secondary)'}}>
            <Calendar className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="text-sm font-medium">以往记录</span>
          </div>
          {historyDates.length === 0 ? (
            <p className="text-sm leading-relaxed" style={{color: 'var(--text-muted)'}}>
              添加任务后会按日期出现在这里
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {historyDates.map((d) => {
                const list = store[d] ?? [];
                const open = list.filter((t) => !t.done).length;
                const active = d === selectedDate;
                return (
                  <li key={d}>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(d)}
                      className="w-full text-left rounded-xl px-3 py-2.5 text-sm transition-colors border border-transparent"
                      style={{
                        backgroundColor: active ? 'var(--neutral-100)' : 'transparent',
                        borderColor: active ? 'var(--neutral-200)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span className="block font-medium">{d}</span>
                      <span className="text-xs mt-0.5 block" style={{color: 'var(--text-muted)'}}>
                        {open > 0 ? `未完成 ${open} 项` : '已全部完成'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* 当日列表 */}
        <section className="pkmer-card flex min-h-0 flex-col p-5 md:p-8">
          <div className="mb-6 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-lg md:text-xl font-medium leading-snug" style={{color: 'var(--text-primary)'}}>
                {formatDateHeading(selectedDate)}
              </p>
              {!isToday ? (
                <button
                  type="button"
                  className="text-sm mt-2 underline-offset-2 hover:underline"
                  style={{color: 'var(--accent-primary)'}}
                  onClick={() => setSelectedDate(todayISODate())}
                >
                  回到今天
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label="上一天"
                className="p-2 rounded-xl border transition-colors hover:bg-neutral-50"
                style={{borderColor: 'var(--neutral-200)'}}
                onClick={() => setSelectedDate((d) => shiftISODate(d, -1))}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl border px-2 py-2 text-sm bg-white"
                style={{borderColor: 'var(--neutral-200)', color: 'var(--text-primary)'}}
              />
              <button
                type="button"
                aria-label="下一天"
                className="p-2 rounded-xl border transition-colors hover:bg-neutral-50"
                style={{borderColor: 'var(--neutral-200)'}}
                onClick={() => setSelectedDate((d) => shiftISODate(d, 1))}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mb-6 flex shrink-0 flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onNewTodoKeyDown}
                placeholder="输入待办，回车或点击添加（输入法选字时的回车不会提交）"
                className="flex-1 min-w-0 rounded-xl border px-4 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-primary-600)_30%,transparent)]"
                style={{borderColor: 'var(--neutral-200)', color: 'var(--text-primary)'}}
                aria-label="新待办内容"
              />
              <button
                type="button"
                onClick={addTodo}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium text-white shrink-0"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                <Plus className="h-4 w-4" aria-hidden />
                添加
              </button>
            </div>
            {isToday ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={autogenBusy}
                  onClick={onManualIncrementalAutogen}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
                  style={{borderColor: 'var(--neutral-200)', color: 'var(--text-secondary)'}}
                  title="仅补充今日尚未存在的昨日未完成与本周 Jira，不覆盖已有项"
                >
                  {autogenBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                  ) : (
                    <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  同步待办
                </button>
                {autogenHint ? (
                  <span className="text-sm" style={{color: 'var(--text-muted)'}} role="status">
                    {autogenHint}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {todos.length === 0 ? (
            <p className="py-16 text-center text-base" style={{color: 'var(--text-muted)'}}>
              这一天还没有待办，在上方输入并添加即可
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {todos.map((t, index) => (
                <li
                  key={t.id}
                  className="flex items-start gap-2 sm:gap-3 rounded-xl border px-3 sm:px-4 py-3 transition-colors"
                  style={{
                    borderColor: 'var(--neutral-200)',
                    backgroundColor: t.done ? 'var(--neutral-50)' : 'transparent',
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragFromIndex.current;
                    dragFromIndex.current = null;
                    if (from === null || from === index) return;
                    moveTodo(from, index);
                  }}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      dragFromIndex.current = index;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragEnd={() => {
                      dragFromIndex.current = null;
                    }}
                    className="mt-0.5 p-1 rounded-lg shrink-0 text-neutral-300 hover:text-neutral-500 hover:bg-neutral-100 cursor-grab active:cursor-grabbing touch-none"
                    aria-label="拖拽排序"
                    title="拖拽调整顺序"
                  >
                    <GripVertical className="h-5 w-5" aria-hidden />
                  </button>
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => toggleTodo(t.id)}
                    className="mt-1 h-4 w-4 rounded border-neutral-300 shrink-0"
                    aria-label={t.done ? '标记为未完成' : '标记为已完成'}
                  />
                  {editingId === t.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                          return;
                        }
                        if (e.key !== 'Enter') return;
                        if (e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        commitEdit();
                      }}
                      onBlur={commitEdit}
                      className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-primary-600)_30%,transparent)]"
                      style={{borderColor: 'var(--neutral-200)', color: 'var(--text-primary)'}}
                      aria-label="编辑待办内容"
                    />
                  ) : (
                    <div
                      className="flex-1 min-w-0 rounded-lg px-1 py-0.5 -mx-1 hover:bg-neutral-100/80 transition-colors cursor-pointer"
                      onClick={() => startEdit(t)}
                      title="点击修改内容"
                    >
                      <TodoItemBody
                        text={t.text}
                        jiraKey={t.jiraKey}
                        jiraServerUrl={jiraServerUrl}
                        done={t.done}
                      />
                    </div>
                  )}
                  <div className="flex items-start gap-0.5 shrink-0">
                    {editingId !== t.id ? (
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                        aria-label="编辑此条"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeTodo(t.id)}
                      className="p-1.5 rounded-lg shrink-0 text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      aria-label="删除此条"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
