import { ImapFlow } from 'imapflow';
import type { MailImapConfig } from './mail-config';

export type MailMessage = {
  uid: number;
  mailbox: string;
  subject: string;
  from: string;
  date: Date;
  unseen: boolean;
  snippet: string;
};

function formatAddressList(addresses: { address?: string; name?: string }[] | undefined): string {
  if (!addresses?.length) return '';
  return addresses
    .map((a) => {
      const addr = a.address?.trim() ?? '';
      const name = a.name?.trim() ?? '';
      if (name && addr) return `${name} <${addr}>`;
      return addr || name;
    })
    .filter(Boolean)
    .join(', ');
}

function extractSnippet(source: Buffer | undefined): string {
  if (!source?.length) return '';
  const text = source.toString('utf8').replace(/\s+/g, ' ').trim();
  return text.slice(0, 200);
}

export function createImapClient(config: Pick<MailImapConfig, 'host' | 'port' | 'user' | 'password'>): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  });
}

export async function testMailImapConnection(
  config: Pick<MailImapConfig, 'host' | 'port' | 'user' | 'password'>
): Promise<void> {
  const client = createImapClient(config);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

/** 拉取 lookback 窗口内的未读邮件（IMAP SEARCH UNSEEN + SINCE） */
export async function fetchUnreadMessagesSince(
  config: MailImapConfig,
  mailboxes: string[],
  since: Date
): Promise<MailMessage[]> {
  const uniqueMailboxes = [...new Set(mailboxes.map((m) => m.trim() || 'INBOX'))];
  const client = createImapClient(config);
  const out: MailMessage[] = [];

  try {
    await client.connect();
    for (const mailbox of uniqueMailboxes) {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const uids = await client.search({ seen: false, since }, { uid: true });
        if (!uids || uids.length === 0) continue;

        for await (const msg of client.fetch(uids, {
          uid: true,
          envelope: true,
          flags: true,
          source: { start: 0, maxLength: 800 },
        })) {
          if (!msg.uid) continue;
          if (msg.flags?.has('\\Seen')) continue;
          const envelope = msg.envelope;
          out.push({
            uid: msg.uid,
            mailbox,
            subject: envelope?.subject?.trim() || '(无主题)',
            from: formatAddressList(envelope?.from as { address?: string; name?: string }[] | undefined),
            date: envelope?.date ? new Date(envelope.date) : new Date(),
            unseen: !msg.flags?.has('\\Seen'),
            snippet: extractSnippet(msg.source),
          });
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  out.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out;
}
