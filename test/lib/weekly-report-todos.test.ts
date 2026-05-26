import test from 'node:test';
import assert from 'node:assert/strict';
import type { DailyTodoItem } from '../../src/lib/daily-todos-storage.ts';
import {
  collectCompletedTodosFromStore,
  getWeekIsoDateBounds,
  mergeWeeklyMarkdownWithCompletedTodos,
  weekRangeLabelZh,
} from '../../src/lib/weekly-report-todos.ts';

const wed = new Date(2026, 4, 7, 12, 0, 0);

test('getWeekIsoDateBounds aligns with jira-weekly Monday week', () => {
  const r = getWeekIsoDateBounds(0, wed);
  assert.equal(r.fromInclusive, '2026-05-04');
  assert.equal(r.toExclusive, '2026-05-11');
});

test('collectCompletedTodosFromStore returns done items in range only', () => {
  const store: Record<string, DailyTodoItem[]> = {
    '2026-05-05': [
      { id: '1', text: '完成联调', done: true, createdAt: 1 },
      { id: '2', text: '未完成', done: false, createdAt: 2 },
    ],
    '2026-05-03': [{ id: '3', text: '上周', done: true, createdAt: 3 }],
    '2026-05-06': [{ id: '4', text: '写周报', done: true, createdAt: 4 }],
  };
  const list = collectCompletedTodosFromStore(store, 0, wed);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.text, '完成联调');
});

test('mergeWeeklyMarkdownWithCompletedTodos inserts section before footer', () => {
  const jiraMd = '# 工作周报\n\n---\n*以上内容由Dottie-Assistant根据 Jira 数据自动生成，可按需润色后发送。*';
  const merged = mergeWeeklyMarkdownWithCompletedTodos(jiraMd, [
    { date: '2026-05-05', text: '修缺陷' },
  ]);
  assert.ok(merged.includes('## 本周完成的每日待办'));
  assert.ok(merged.includes('修缺陷'));
  assert.ok(merged.indexOf('## 本周完成的每日待办') < merged.indexOf('---'));
});

test('weekRangeLabelZh formats Chinese range', () => {
  const label = weekRangeLabelZh(0, wed);
  assert.match(label, /2026/);
  assert.ok(label.includes('～'));
});
