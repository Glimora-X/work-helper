/**
 * 每日待办（Tasks 页）与总结页「从 Jira 加入今日」共用同一 localStorage。
 */

export const DAILY_TODOS_STORAGE_KEY = 'assistant-daily-todos-v1';

export type DailyTodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  /** Jira issue key，用于去重与提测后自动勾选完成 */
  jiraKey?: string;
};

export function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cleanEmptyDates(store: Record<string, DailyTodoItem[]>): Record<string, DailyTodoItem[]> {
  const out: Record<string, DailyTodoItem[]> = {};
  for (const [k, list] of Object.entries(store)) {
    if (Array.isArray(list) && list.length > 0) out[k] = list;
  }
  return out;
}

function parseStore(raw: string): Record<string, DailyTodoItem[]> {
  try {
    const parsed = JSON.parse(raw) as Record<string, DailyTodoItem[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadDailyTodos(): Record<string, DailyTodoItem[]> {
  try {
    const raw = localStorage.getItem(DAILY_TODOS_STORAGE_KEY);
    if (!raw) return {};
    return parseStore(raw);
  } catch {
    return {};
  }
}

function persistStore(store: Record<string, DailyTodoItem[]>): void {
  localStorage.setItem(DAILY_TODOS_STORAGE_KEY, JSON.stringify(cleanEmptyDates(store)));
}

/** 将 Jira 工单加入「今天」的待办列表；已存在同一 jiraKey 则视为已加入 */
export function addJiraTodoToToday(issueKey: string, summary: string): { added: boolean } {
  const key = issueKey.trim().toUpperCase();
  const today = todayISODate();
  const store = loadDailyTodos();
  const list = store[today] ?? [];
  if (list.some((t) => t.jiraKey?.toUpperCase() === key)) {
    return { added: false };
  }
  const sum = summary.trim();
  const text = sum ? `[${key}] ${sum}` : `[${key}]`;
  const item: DailyTodoItem = {
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: Date.now(),
    jiraKey: key,
  };
  store[today] = [...list, item];
  persistStore(store);
  return { added: true };
}

/** 今日待办中出现的 Jira issue key（大写），用于总结页展示「已在今日待办」等 */
export function readTodayJiraIssueKeys(): Set<string> {
  const list = loadDailyTodos()[todayISODate()] ?? [];
  const s = new Set<string>();
  for (const t of list) {
    const k = t.jiraKey?.trim().toUpperCase();
    if (k) s.add(k);
  }
  return s;
}

/** 将今日待办中匹配该 Jira key 的未完成项标为已完成，返回勾选条数 */
export function markTodayTodosDoneForJiraKey(issueKey: string): number {
  const key = issueKey.trim().toUpperCase();
  const today = todayISODate();
  const store = loadDailyTodos();
  const list = store[today];
  if (!list?.length) return 0;
  let n = 0;
  const next = list.map((t) => {
    if (t.jiraKey?.toUpperCase() === key && !t.done) {
      n += 1;
      return { ...t, done: true };
    }
    return t;
  });
  if (n === 0) return 0;
  store[today] = next;
  persistStore(store);
  return n;
}
