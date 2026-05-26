/**
 * 每日待办（Tasks 页）与总结页「从 Jira 加入今日」共用同一 localStorage。
 */

export const DAILY_TODOS_STORAGE_KEY = 'assistant-daily-todos-v1';

/** 记录某日是否已执行「今日待办自动生成」 */
export const AUTOGEN_DAILY_TODOS_KEY = 'assistant-daily-todos-autogen-v1';

/** 周五默认待办文案（Tasks 页自动补全，去重按 trim 后全文匹配） */
export const DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT = '写周报';

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

export function shiftISODate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function loadAutogenMarks(): Record<string, true> {
  try {
    const raw = localStorage.getItem(AUTOGEN_DAILY_TODOS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, true> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function persistAutogenMarks(marks: Record<string, true>): void {
  localStorage.setItem(AUTOGEN_DAILY_TODOS_KEY, JSON.stringify(marks));
}

export function hasAutogenRunForDate(iso: string): boolean {
  return loadAutogenMarks()[iso] === true;
}

export function markAutogenRunForDate(iso: string): void {
  const marks = loadAutogenMarks();
  marks[iso] = true;
  persistAutogenMarks(marks);
}

function todayHasJiraKey(list: DailyTodoItem[], key: string): boolean {
  return list.some((t) => t.jiraKey?.toUpperCase() === key);
}

function todayHasText(list: DailyTodoItem[], text: string): boolean {
  return list.some((t) => t.text.trim() === text);
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

/** 将纯文本加入「今天」的待办；同日 trim 后全文相同视为重复 */
export function addPlainTextTodoToToday(text: string): { added: boolean; reason?: 'duplicate' | 'empty' } {
  const t = text.trim();
  if (!t) return { added: false, reason: 'empty' };
  const today = todayISODate();
  const store = loadDailyTodos();
  const list = store[today] ?? [];
  if (list.some((item) => item.text.trim() === t)) {
    return { added: false, reason: 'duplicate' };
  }
  const item: DailyTodoItem = {
    id: crypto.randomUUID(),
    text: t,
    done: false,
    createdAt: Date.now(),
  };
  store[today] = [...list, item];
  persistStore(store);
  return { added: true };
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

/** 将昨日未完成项复制到今日（新 id，done=false；按 jiraKey / trim 全文去重） */
export function carryYesterdayIncompleteToToday(): number {
  const today = todayISODate();
  const yesterday = shiftISODate(today, -1);
  const store = loadDailyTodos();
  const from = store[yesterday] ?? [];
  const incomplete = from.filter((t) => !t.done);
  if (incomplete.length === 0) return 0;

  const list = [...(store[today] ?? [])];
  let added = 0;
  for (const src of incomplete) {
    const text = src.text.trim();
    if (!text) continue;
    const jiraKey = src.jiraKey?.trim().toUpperCase();
    if (jiraKey && todayHasJiraKey(list, jiraKey)) continue;
    if (!jiraKey && todayHasText(list, text)) continue;
    list.push({
      id: crypto.randomUUID(),
      text: src.text,
      done: false,
      createdAt: Date.now(),
      ...(jiraKey ? {jiraKey} : {}),
    });
    added += 1;
  }
  if (added === 0) return 0;
  store[today] = list;
  persistStore(store);
  return added;
}

export type JiraIssueForTodo = {key: string; summary?: string};

/** 批量将 Jira 工单加入今日待办（单次读写；已存在 jiraKey 则跳过） */
export function appendJiraIssuesToToday(issues: JiraIssueForTodo[]): number {
  if (issues.length === 0) return 0;
  const today = todayISODate();
  const store = loadDailyTodos();
  const list = [...(store[today] ?? [])];
  let added = 0;
  for (const issue of issues) {
    const key = issue.key.trim().toUpperCase();
    if (!key) continue;
    if (todayHasJiraKey(list, key)) continue;
    const sum = (issue.summary ?? '').trim();
    const text = sum ? `[${key}] ${sum}` : `[${key}]`;
    list.push({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
      jiraKey: key,
    });
    added += 1;
  }
  if (added === 0) return 0;
  store[today] = list;
  persistStore(store);
  return added;
}
