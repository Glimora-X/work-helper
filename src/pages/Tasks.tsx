import {Calendar, ChevronLeft, ChevronRight, Plus, Trash2} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import PageHeader from '../components/PageHeader';

const STORAGE_KEY = 'assistant-daily-todos-v1';

/** 与 public/fonts/LXGWWenKaiScreen.ttf 的 @font-face 名称一致 */
const FONT_WENKAI = '"LXGW WenKai Screen", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif';

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
};

function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftISODate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function loadStore(): Record<string, TodoItem[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TodoItem[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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

export default function Tasks() {
  const [store, setStore] = useState<Record<string, TodoItem[]>>({});
  const [selectedDate, setSelectedDate] = useState(todayISODate);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStore(loadStore());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const cleaned: Record<string, TodoItem[]> = {};
    for (const [k, list] of Object.entries(store)) {
      if (Array.isArray(list) && list.length > 0) cleaned[k] = list;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  }, [store, hydrated]);

  const todos = store[selectedDate] ?? [];

  const historyDates = useMemo(() => {
    return Object.keys(store)
      .filter((d) => (store[d]?.length ?? 0) > 0)
      .sort((a, b) => b.localeCompare(a));
  }, [store]);

  const setTodosForDate = useCallback((date: string, next: TodoItem[]) => {
    setStore((prev) => {
      const copy = {...prev};
      if (next.length === 0) delete copy[date];
      else copy[date] = next;
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

  const isToday = selectedDate === todayISODate();

  return (
    <div
      className="p-6 md:p-10 max-w-6xl mx-auto min-h-[calc(100vh-5rem)]"
      style={{fontFamily: FONT_WENKAI}}
    >
      <PageHeader
        title="每日待办"
        subtitle="按日期记录任务，数据保存在本机浏览器"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,220px)_1fr] gap-8">
        {/* 历史日期 */}
        <aside className="artistic-card p-4 md:p-5 h-fit lg:sticky lg:top-6">
          <div className="flex items-center gap-2 mb-4" style={{color: 'var(--text-secondary)'}}>
            <Calendar className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            <span className="text-sm font-medium">以往记录</span>
          </div>
          {historyDates.length === 0 ? (
            <p className="text-sm leading-relaxed" style={{color: 'var(--text-muted)'}}>
              添加任务后会按日期出现在这里
            </p>
          ) : (
            <ul className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
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
        <section className="artistic-card p-5 md:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-lg md:text-xl font-medium leading-snug" style={{color: 'var(--text-primary)'}}>
                {formatDateHeading(selectedDate)}
              </p>
              {!isToday ? (
                <button
                  type="button"
                  className="text-sm mt-2 underline-offset-2 hover:underline"
                  style={{color: 'var(--primary)'}}
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

          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTodo()}
              placeholder="输入待办，回车或点击添加"
              className="flex-1 min-w-0 rounded-xl border px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-500/30"
              style={{borderColor: 'var(--neutral-200)', color: 'var(--text-primary)'}}
              aria-label="新待办内容"
            />
            <button
              type="button"
              onClick={addTodo}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium text-white shrink-0"
              style={{backgroundColor: 'var(--primary)'}}
            >
              <Plus className="h-4 w-4" aria-hidden />
              添加
            </button>
          </div>

          {todos.length === 0 ? (
            <p className="text-center py-16 text-base" style={{color: 'var(--text-muted)'}}>
              这一天还没有待办，在上方输入并添加即可
            </p>
          ) : (
            <ul className="space-y-2">
              {todos.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors"
                  style={{
                    borderColor: 'var(--neutral-200)',
                    backgroundColor: t.done ? 'var(--neutral-50)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => toggleTodo(t.id)}
                    className="mt-1 h-4 w-4 rounded border-neutral-300 shrink-0"
                    aria-label={t.done ? '标记为未完成' : '标记为已完成'}
                  />
                  <span
                    className="flex-1 text-base leading-relaxed break-words"
                    style={{
                      color: 'var(--text-primary)',
                      textDecoration: t.done ? 'line-through' : undefined,
                      opacity: t.done ? 0.65 : 1,
                    }}
                  >
                    {t.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTodo(t.id)}
                    className="p-1.5 rounded-lg shrink-0 text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    aria-label="删除此条"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
