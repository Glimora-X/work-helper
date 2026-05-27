import fs from 'node:fs';
import path from 'node:path';
import {
  resolveBundledConfigDir,
  resolveRepoConfigPath,
  resolveUserDataConfigPath,
  seedUserConfigFromBundle,
} from './assistant-data-paths';

export type MailSubscription = {
  id: string;
  name: string;
  fromContains: string[];
  subjectContains: string[];
  mailbox: string;
};

export type MailSubscriptionsFile = {
  version: 1;
  subscriptions: MailSubscription[];
};

export function mailSubscriptionsPath(): string {
  const override = process.env.MAIL_SUBSCRIPTIONS_PATH?.trim();
  if (override) return path.resolve(override);
  const userData = resolveUserDataConfigPath('mail-subscriptions.json');
  if (userData) return userData;
  const bundled = resolveBundledConfigDir();
  if (bundled) return path.join(bundled, 'mail-subscriptions.json');
  return resolveRepoConfigPath('mail-subscriptions.json');
}

function isValidSubscription(raw: unknown): raw is MailSubscription {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.trim().length > 0 &&
    typeof s.name === 'string' &&
    Array.isArray(s.fromContains) &&
    s.fromContains.every((x) => typeof x === 'string') &&
    Array.isArray(s.subjectContains) &&
    s.subjectContains.every((x) => typeof x === 'string') &&
    typeof s.mailbox === 'string' &&
    s.mailbox.trim().length > 0
  );
}

export function validateMailSubscriptionsFile(data: unknown): MailSubscriptionsFile {
  if (!data || typeof data !== 'object') {
    throw new Error('subscriptions 须为 JSON 对象');
  }
  const body = data as Record<string, unknown>;
  if (body.version !== 1) {
    throw new Error('version 须为 1');
  }
  if (!Array.isArray(body.subscriptions)) {
    throw new Error('subscriptions 须为数组');
  }
  const ids = new Set<string>();
  const subscriptions: MailSubscription[] = [];
  for (const item of body.subscriptions) {
    if (!isValidSubscription(item)) {
      throw new Error('subscriptions 中存在无效条目');
    }
    const id = item.id.trim();
    if (ids.has(id)) {
      throw new Error(`重复的 subscription id: ${id}`);
    }
    ids.add(id);
    subscriptions.push({
      id,
      name: item.name.trim() || id,
      fromContains: item.fromContains.map((x) => x.trim()).filter(Boolean),
      subjectContains: item.subjectContains.map((x) => x.trim()).filter(Boolean),
      mailbox: item.mailbox.trim() || 'INBOX',
    });
  }
  return { version: 1, subscriptions };
}

export function loadMailSubscriptions(): MailSubscriptionsFile {
  const p = mailSubscriptionsPath();
  const userWritable = resolveUserDataConfigPath('mail-subscriptions.json');
  if (userWritable && path.resolve(p) === path.resolve(userWritable)) {
    seedUserConfigFromBundle('mail-subscriptions.json', userWritable);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { version: 1, subscriptions: [] };
  }
  return validateMailSubscriptionsFile(JSON.parse(raw));
}

export function saveMailSubscriptions(data: MailSubscriptionsFile): void {
  const validated = validateMailSubscriptionsFile(data);
  const p = mailSubscriptionsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(validated, null, 2) + '\n', 'utf8');
}
