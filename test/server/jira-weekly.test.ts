import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalWeekRangeMonday,
  weekJqlDateRange,
  jqlMyOpenIssues,
  jqlMyIssuesTouchedInWeek,
  buildWeeklySummaryMarkdown,
} from '../../server/jira-weekly';
import type { JiraSearchIssue } from '../../server/jira-rest';

test('getLocalWeekRangeMonday: fixed date lands in correct Monday week', () => {
  const wed = new Date(2026, 4, 7, 15, 0, 0); // 2026-05-07（本地周应含该日）
  const { weekStart, weekEndExclusive, labelZh } = getLocalWeekRangeMonday(0, wed);
  assert.equal(weekStart.getFullYear(), 2026);
  assert.equal(weekStart.getMonth(), 4);
  assert.equal(weekStart.getDate(), 4); // Monday May 4
  assert.equal(weekEndExclusive.getDate(), 11);
  assert.match(labelZh, /2026/);
});

test('jqlMyOpenIssues matches Issue Navigator style (chanjet Jira)', () => {
  const jql = jqlMyOpenIssues();
  assert.ok(jql.includes('resolution = Unresolved'));
  assert.ok(jql.includes('assignee in (currentUser())'));
});

test('weekJqlDateRange returns bracket-safe JQL dates', () => {
  const wed = new Date(2026, 4, 7);
  const r = weekJqlDateRange(0, wed);
  assert.equal(r.fromYmd, '2026-05-04');
  assert.equal(r.toYmdExclusive, '2026-05-11');
  const jql = jqlMyIssuesTouchedInWeek(r.fromYmd, r.toYmdExclusive);
  assert.ok(jql.includes('2026-05-04'));
  assert.ok(jql.includes('2026-05-11'));
});

test('buildWeeklySummaryMarkdown handles empty issues', () => {
  const md = buildWeeklySummaryMarkdown([], '某周');
  assert.ok(md.includes('暂无'));
});

test('buildWeeklySummaryMarkdown lists issues', () => {
  const issues: JiraSearchIssue[] = [
    {
      key: 'DEMO-1',
      fields: {
        summary: 'Fix bug',
        status: { name: '进行中' },
        issuetype: { name: '缺陷' },
        project: { key: 'DEMO' },
      },
    },
  ];
  const md = buildWeeklySummaryMarkdown(issues, '测试区间');
  assert.ok(md.includes('DEMO-1'));
  assert.ok(md.includes('进行中'));
});
