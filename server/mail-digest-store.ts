import fs from 'node:fs';
import path from 'node:path';
import { moduleDirname } from './module-dirname';
import { resolveUserDataDataPath } from './assistant-data-paths';

export type MailDigestStats = {
  total: number;
  subscribed: number;
  other: number;
  lookbackHours: number;
};

export type MailDigestRecord = {
  markdown: string;
  generatedAt: string;
  stats: MailDigestStats;
  error?: string;
};

function repoRoot(): string {
  return path.resolve(moduleDirname(), '..');
}

export function mailDigestStorePath(): string {
  const override = process.env.MAIL_DIGEST_STORE_PATH?.trim();
  if (override) return path.resolve(override);
  const userData = resolveUserDataDataPath('mail-digest', 'latest.json');
  if (userData) return userData;
  return path.join(repoRoot(), 'data', 'mail-digest', 'latest.json');
}

export function readLatestMailDigest(): MailDigestRecord | null {
  const p = mailDigestStorePath();
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as MailDigestRecord;
    if (typeof data.markdown !== 'string' || typeof data.generatedAt !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeLatestMailDigest(record: MailDigestRecord): void {
  const p = mailDigestStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(record, null, 2) + '\n', 'utf8');
}
