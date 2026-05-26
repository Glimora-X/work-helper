import {DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT, type DailyTodoItem} from './daily-todos-storage';

export type CompletedTodoEntry = {
  date: string;
  text: string;
  jiraKey?: string;
};

/** 自然周 ISO 日期界（左闭右开），与 server/jira-weekly 一致 */
function parseIsoLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 与 server/jira-weekly `labelZh` 同口径的自然周文案 */
export function weekRangeLabelZh(weekOffset = 0, now = new Date()): string {
  const { fromInclusive, toExclusive } = getWeekIsoDateBounds(weekOffset, now);
  const start = parseIsoLocalDate(fromInclusive);
  const end = parseIsoLocalDate(toExclusive);
  end.setDate(end.getDate() - 1);
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${fmt.format(start)} ～ ${fmt.format(end)}`;
}

export function getWeekIsoDateBounds(
  weekOffset = 0,
  now = new Date()
): { fromInclusive: string; toExclusive: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() + mondayDelta);
  thisMonday.setHours(0, 0, 0, 0);

  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() + weekOffset * 7);
  const endExclusive = new Date(start);
  endExclusive.setDate(start.getDate() + 7);

  const fmt = (dt: Date) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dayNum = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayNum}`;
  };

  return { fromInclusive: fmt(start), toExclusive: fmt(endExclusive) };
}

export function isIsoDateInWeekRange(
  isoDate: string,
  fromInclusive: string,
  toExclusive: string
): boolean {
  return isoDate >= fromInclusive && isoDate < toExclusive;
}

/** 从每日待办存储中收集所选自然周内已勾选的待办（按 Tasks 页日期归档） */
export function collectCompletedTodosFromStore(
  store: Record<string, DailyTodoItem[]>,
  weekOffset = 0,
  now = new Date()
): CompletedTodoEntry[] {
  const { fromInclusive, toExclusive } = getWeekIsoDateBounds(weekOffset, now);
  const out: CompletedTodoEntry[] = [];

  for (const [date, list] of Object.entries(store)) {
    if (!isIsoDateInWeekRange(date, fromInclusive, toExclusive)) continue;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item?.done) continue;
      const text = String(item.text ?? '').trim();
      if (!text || text === DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT) continue;
      const jiraKey = item.jiraKey?.trim().toUpperCase() || undefined;
      out.push({ date, text, jiraKey });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text, 'zh'));
  return out;
}

export function buildCompletedTodosMarkdownSection(completedTodos: CompletedTodoEntry[]): string {
  if (completedTodos.length === 0) return '';

  const lines: string[] = [];
  lines.push('## 本周完成的每日待办');
  lines.push('');
  lines.push(
    `共 **${completedTodos.length}** 条（按 Tasks 页日期归档；仅统计已勾选完成项，不含「${DEFAULT_FRIDAY_WEEKLY_REPORT_TEXT}」占位）。`
  );
  lines.push('');

  const byDate = new Map<string, CompletedTodoEntry[]>();
  for (const t of completedTodos) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  for (const [date, items] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${date}`);
    for (const item of items) {
      const jira = item.jiraKey ? ` · ${item.jiraKey}` : '';
      lines.push(`- ${item.text}${jira}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

const WEEKLY_REPORT_FOOTER = '\n---\n*以上内容由Dottie-Assistant';

/** 在 Jira 周报 Markdown 的页脚之前插入「本周完成的每日待办」章节 */
export function mergeWeeklyMarkdownWithCompletedTodos(
  jiraMarkdown: string,
  completedTodos: CompletedTodoEntry[]
): string {
  const section = buildCompletedTodosMarkdownSection(completedTodos);
  if (!section) return jiraMarkdown;

  const footerIdx = jiraMarkdown.indexOf(WEEKLY_REPORT_FOOTER);
  if (footerIdx >= 0) {
    return `${jiraMarkdown.slice(0, footerIdx).trimEnd()}\n\n${section}\n\n${jiraMarkdown.slice(footerIdx).trimStart()}`;
  }
  return `${jiraMarkdown.trimEnd()}\n\n${section}`;
}

/** Jira 不可用时，仅根据本地待办生成周报草稿 */
export function buildTodosOnlyWeeklyMarkdown(
  completedTodos: CompletedTodoEntry[],
  rangeLabelZh: string
): string {
  const section = buildCompletedTodosMarkdownSection(completedTodos);
  const lines: string[] = [];
  lines.push('# 工作周报');
  lines.push('');
  lines.push(`**统计周期**：${rangeLabelZh}`);
  lines.push('');
  lines.push(
    `本周在「每日待办」中勾选完成 **${completedTodos.length}** 条（Jira 数据未加载或不可用）。`
  );
  lines.push('');
  lines.push(section);
  lines.push('');
  lines.push('---');
  lines.push('*以上内容由 Dottie-Assistant 根据本地待办数据生成，可按需润色后发送。*');
  return lines.join('\n');
}
