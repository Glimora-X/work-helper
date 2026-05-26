import type { MailImapConfig } from './mail-config';
import { fetchUnreadMessagesSince, type MailMessage } from './mail-imap';
import { writeLatestMailDigest, type MailDigestRecord, type MailDigestStats } from './mail-digest-store';
import { loadMailSubscriptions, type MailSubscription } from './mail-subscriptions';

export type MatchedSubscription = {
  subscriptionId: string;
  subscriptionName: string;
};

function normalizeForMatch(value: string): string {
  return value.toLowerCase();
}

function containsAny(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return true;
  const h = normalizeForMatch(haystack);
  return needles.some((n) => h.includes(normalizeForMatch(n)));
}

export function matchMessageToSubscriptions(
  message: MailMessage,
  subscriptions: MailSubscription[]
): MatchedSubscription[] {
  const matches: MatchedSubscription[] = [];
  for (const sub of subscriptions) {
    if (sub.mailbox !== message.mailbox) continue;
    const fromOk = sub.fromContains.length === 0 || containsAny(message.from, sub.fromContains);
    const subjectOk =
      sub.subjectContains.length === 0 || containsAny(message.subject, sub.subjectContains);
    if (fromOk && subjectOk) {
      matches.push({ subscriptionId: sub.id, subscriptionName: sub.name });
    }
  }
  return matches;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDateHeading(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatMessageLine(message: MailMessage): string {
  const line = `- ${message.from} — ${message.subject} \`${message.mailbox}\` — ${formatTime(message.date)}`;
  if (!message.snippet) return line;
  return `${line}\n  - 摘要：${message.snippet}`;
}

export function buildMailDigestMarkdown(
  messages: MailMessage[],
  subscriptions: MailSubscription[],
  lookbackHours: number,
  generatedAt = new Date()
): { markdown: string; stats: MailDigestStats } {
  const unreadMessages = messages.filter((m) => m.unseen);
  const subscribedRows: { message: MailMessage; matches: MatchedSubscription[] }[] = [];
  const otherRows: MailMessage[] = [];

  for (const message of unreadMessages) {
    const matches = matchMessageToSubscriptions(message, subscriptions);
    if (matches.length > 0) {
      subscribedRows.push({ message, matches });
    } else {
      otherRows.push(message);
    }
  }

  const stats: MailDigestStats = {
    total: unreadMessages.length,
    subscribed: subscribedRows.length,
    other: otherRows.length,
    lookbackHours,
  };

  const lines: string[] = [
    `## 未读邮件摘要 · ${formatDateHeading(generatedAt)}`,
    '',
    `共 ${stats.total} 封未读（订阅规则匹配 ${stats.subscribed} 封，回溯 ${lookbackHours} 小时）`,
    '',
  ];

  if (subscribedRows.length === 0) {
    lines.push('### 订阅命中', '', '（无匹配未读邮件）', '');
  } else {
    lines.push('### 订阅命中', '');
    for (const row of subscribedRows) {
      const tags = row.matches.map((m) => m.subscriptionName).join('、');
      lines.push(formatMessageLine(row.message));
      lines.push(`  - 订阅：${tags}`);
    }
    lines.push('');
  }

  if (otherRows.length > 0) {
    lines.push('### 其它未读', '');
    for (const message of otherRows.slice(0, 20)) {
      lines.push(formatMessageLine(message));
    }
    if (otherRows.length > 20) {
      lines.push('', `… 另有 ${otherRows.length - 20} 封未展示`);
    }
    lines.push('');
  }

  return { markdown: lines.join('\n').trimEnd(), stats };
}

export async function buildAndStoreMailDigest(config: MailImapConfig): Promise<MailDigestRecord> {
  const subscriptionsFile = loadMailSubscriptions();
  const mailboxes =
    subscriptionsFile.subscriptions.length > 0
      ? subscriptionsFile.subscriptions.map((s) => s.mailbox)
      : ['INBOX'];

  const since = new Date(Date.now() - config.lookbackHours * 60 * 60 * 1000);
  const messages = await fetchUnreadMessagesSince(config, mailboxes, since);
  const { markdown, stats } = buildMailDigestMarkdown(
    messages,
    subscriptionsFile.subscriptions,
    config.lookbackHours
  );

  const record: MailDigestRecord = {
    markdown,
    generatedAt: new Date().toISOString(),
    stats,
  };
  writeLatestMailDigest(record);
  return record;
}
