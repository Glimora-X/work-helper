import type { JiraSearchIssue } from './jira-rest';

/** 自然周：周一 00:00:00.000 ～ 下周一 00:00:00.000（左闭右开），按本地时区 */
export function getLocalWeekRangeMonday(weekOffset = 0, now = new Date()): {
  weekStart: Date;
  weekEndExclusive: Date;
  labelZh: string;
} {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() + mondayDelta);
  thisMonday.setHours(0, 0, 0, 0);

  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() + weekOffset * 7);
  const endExclusive = new Date(start);
  endExclusive.setDate(start.getDate() + 7);

  const fmt = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const labelZh = `${fmt.format(start)} ～ ${fmt.format(new Date(endExclusive.getTime() - 86400000))}`;

  return { weekStart: start, weekEndExclusive: endExclusive, labelZh };
}

function formatJiraDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** JQL 用日期字面量（服务器按自身时区解释；与本地周界对齐的常见做法） */
export function weekJqlDateRange(weekOffset = 0, now = new Date()): {
  fromYmd: string;
  toYmdExclusive: string;
  labelZh: string;
} {
  const { weekStart, weekEndExclusive, labelZh } = getLocalWeekRangeMonday(weekOffset, now);
  return {
    fromYmd: formatJiraDate(weekStart),
    toYmdExclusive: formatJiraDate(weekEndExclusive),
    labelZh,
  };
}

/**
 * 与浏览器 Issue Navigator 列表一致（见 /rest/issueNav/…/issueTable 的 jql 参数）。
 * 程序仍走公开 REST `POST …/search`，不调 issueTable（依赖会话与内部契约）。
 */
export function jqlMyOpenIssues(): string {
  return 'resolution = Unresolved AND assignee in (currentUser()) ORDER BY updated DESC';
}

export function jqlMyIssuesTouchedInWeek(fromYmd: string, toYmdExclusive: string): string {
  return (
    `assignee in (currentUser()) AND updated >= "${fromYmd}" AND updated < "${toYmdExclusive}" ` +
    'ORDER BY updated DESC'
  );
}

export function buildWeeklySummaryMarkdown(
  issues: JiraSearchIssue[],
  rangeLabelZh: string
): string {
  const lines: string[] = [];
  lines.push(`# 工作周报（Jira）`);
  lines.push('');
  lines.push(`**统计周期**：${rangeLabelZh}`);
  lines.push('');
  lines.push(`本周在 Jira 中「指派给你」且发生更新的工单共 **${issues.length}** 条（含状态流转、评论、字段修改等触发的 updated）。`);
  lines.push('');

  if (issues.length === 0) {
    lines.push('本周暂无符合条件的工单。');
    return lines.join('\n');
  }

  const byStatus = new Map<string, JiraSearchIssue[]>();
  for (const issue of issues) {
    const s = issue.fields?.status?.name || '（未分类）';
    if (!byStatus.has(s)) byStatus.set(s, []);
    byStatus.get(s)!.push(issue);
  }

  lines.push('## 按状态汇总');
  lines.push('');
  for (const [status, list] of [...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    lines.push(`- **${status}**：${list.length} 条`);
  }
  lines.push('');
  lines.push('## 工单明细');
  lines.push('');
  for (const issue of issues) {
    const st = issue.fields?.status?.name || '';
    const ty = issue.fields?.issuetype?.name || '';
    const pr = issue.fields?.project?.key || '';
    const sum = (issue.fields?.summary || '').replace(/\s+/g, ' ').trim();
    const meta = [pr, ty, st].filter(Boolean).join(' · ');
    lines.push(`- **${issue.key}**（${meta}）${sum}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('*以上内容由助手根据 Jira 数据自动生成，可按需润色后发送。*');

  return lines.join('\n');
}
