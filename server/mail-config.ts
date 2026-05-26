export const MAIL_ENV_DEFAULTS: Record<string, string> = {
  MAIL_IMAP_USER: 'wangjuan3@chanjet.com',
  MAIL_IMAP_HOST: 'imap.qiye.aliyun.com',
  MAIL_IMAP_PORT: '993',
  MAIL_DIGEST_SCHEDULE: '08:00',
  MAIL_DIGEST_LOOKBACK_HOURS: '24',
  MAIL_DIGEST_ENABLED: 'true',
};

export type MailImapConfig = {
  user: string;
  password: string;
  host: string;
  port: number;
  lookbackHours: number;
  digestSchedule: string;
  digestEnabled: boolean;
  configured: boolean;
};

export function getMailImapConfig(env: NodeJS.ProcessEnv = process.env): MailImapConfig {
  const user = env.MAIL_IMAP_USER?.trim() || MAIL_ENV_DEFAULTS.MAIL_IMAP_USER;
  const password = env.MAIL_IMAP_PASSWORD?.trim() ?? '';
  const host = env.MAIL_IMAP_HOST?.trim() || MAIL_ENV_DEFAULTS.MAIL_IMAP_HOST;
  const port = Number(env.MAIL_IMAP_PORT?.trim() || MAIL_ENV_DEFAULTS.MAIL_IMAP_PORT);
  const lookbackHours = Number(
    env.MAIL_DIGEST_LOOKBACK_HOURS?.trim() || MAIL_ENV_DEFAULTS.MAIL_DIGEST_LOOKBACK_HOURS
  );
  const digestSchedule = env.MAIL_DIGEST_SCHEDULE?.trim() || MAIL_ENV_DEFAULTS.MAIL_DIGEST_SCHEDULE;
  const digestEnabled = env.MAIL_DIGEST_ENABLED?.trim() !== 'false';

  return {
    user,
    password,
    host,
    port: Number.isFinite(port) ? port : 993,
    lookbackHours: Number.isFinite(lookbackHours) && lookbackHours > 0 ? lookbackHours : 24,
    digestSchedule,
    digestEnabled,
    configured: Boolean(user && password),
  };
}

export function maskEmail(user: string): string {
  const trimmed = user.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
