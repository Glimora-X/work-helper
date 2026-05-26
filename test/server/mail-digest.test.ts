import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMailDigestMarkdown,
  matchMessageToSubscriptions,
} from '../../server/mail-digest';
import type { MailMessage } from '../../server/mail-imap';
import type { MailSubscription } from '../../server/mail-subscriptions';

const subscriptions: MailSubscription[] = [
  {
    id: 'jira',
    name: 'Jira',
    fromContains: ['jira@chanjet.com'],
    subjectContains: [],
    mailbox: 'INBOX',
  },
  {
    id: 'release',
    name: '发布',
    fromContains: [],
    subjectContains: ['发布'],
    mailbox: 'INBOX',
  },
];

function msg(partial: Partial<MailMessage> & Pick<MailMessage, 'from' | 'subject'>): MailMessage {
  return {
    uid: 1,
    mailbox: 'INBOX',
    date: new Date('2026-05-26T09:00:00'),
    unseen: true,
    snippet: 'hello',
    ...partial,
  };
}

test('matchMessageToSubscriptions: fromContains', () => {
  const m = msg({ from: 'Jira <jira@chanjet.com>', subject: 'Issue updated' });
  const hits = matchMessageToSubscriptions(m, subscriptions);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.subscriptionId, 'jira');
});

test('matchMessageToSubscriptions: subjectContains', () => {
  const m = msg({ from: 'boss@chanjet.com', subject: '今晚发布评审' });
  const hits = matchMessageToSubscriptions(m, subscriptions);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.subscriptionId, 'release');
});

test('matchMessageToSubscriptions: empty filters match any', () => {
  const sub: MailSubscription[] = [
    {
      id: 'all-inbox',
      name: '全部',
      fromContains: [],
      subjectContains: [],
      mailbox: 'INBOX',
    },
  ];
  const hits = matchMessageToSubscriptions(msg({ from: 'a@b.com', subject: 'x' }), sub);
  assert.equal(hits.length, 1);
});

test('buildMailDigestMarkdown splits subscribed vs other unread', () => {
  const messages: MailMessage[] = [
    msg({ uid: 1, from: 'jira@chanjet.com', subject: 'JIRA-1', unseen: true }),
    msg({ uid: 2, from: 'other@chanjet.com', subject: 'Hello', unseen: true }),
    msg({ uid: 3, from: 'read@chanjet.com', subject: 'Already read', unseen: false }),
  ];
  const { markdown, stats } = buildMailDigestMarkdown(messages, subscriptions, 24);
  assert.equal(stats.total, 2);
  assert.equal(stats.subscribed, 1);
  assert.equal(stats.other, 1);
  assert.ok(markdown.includes('### 订阅命中'));
  assert.ok(markdown.includes('### 其它未读'));
  assert.ok(markdown.includes('JIRA-1'));
  assert.ok(!markdown.includes('Already read'));
});

test('buildMailDigestMarkdown: no unread messages', () => {
  const { markdown, stats } = buildMailDigestMarkdown([], subscriptions, 24);
  assert.equal(stats.total, 0);
  assert.ok(markdown.includes('（无匹配未读邮件）'));
});
