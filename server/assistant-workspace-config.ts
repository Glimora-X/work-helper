import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { moduleDirname } from './module-dirname';
import { resolveRepoConfigPath, resolveUserDataConfigPath } from './assistant-data-paths';

function resolveAssistantDotenvPath(): string | null {
  const assistant = process.env.ASSISTANT_DOTENV_PATH?.trim();
  if (!assistant) return null;
  const abs = path.resolve(assistant);
  return fs.existsSync(abs) ? abs : null;
}

function resolveExplicitDeployDotenvPath(): string | null {
  const explicit = process.env.DEPLOY_API_DOTENV?.trim();
  if (!explicit) return null;
  const abs = path.resolve(explicit);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * 与 deploy-api 启动时一致：解析要加载的 `.env` 路径（第一个存在的文件）。
 * 桌面包：Electron 设置 ASSISTANT_DOTENV_PATH 时优先读用户数据目录，避免只配在项目根却不生效。
 */
export function resolveDeployApiDotenvPath(): string | null {
  const assistant = resolveAssistantDotenvPath();
  if (assistant) return assistant;
  const explicit = resolveExplicitDeployDotenvPath();
  if (explicit) return explicit;
  const repoStyle = path.join(moduleDirname(), '..', '.env');
  if (fs.existsSync(repoStyle)) return path.resolve(repoStyle);
  const besideApi = path.join(moduleDirname(), '.env');
  if (fs.existsSync(besideApi)) return path.resolve(besideApi);
  return null;
}

/** 写入目标：桌面包已设 ASSISTANT_DOTENV_PATH 时始终落用户数据目录；否则沿用已存在的 .env 路径 */
export function resolveWritableDotenvPath(): string {
  const assistant = process.env.ASSISTANT_DOTENV_PATH?.trim();
  if (assistant) return path.resolve(assistant);
  const found = resolveDeployApiDotenvPath();
  if (found) return found;
  const explicit = process.env.DEPLOY_API_DOTENV?.trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(moduleDirname(), '..', '.env');
}

/** 启动或设置页保存后：从 resolveDeployApiDotenvPath 指向的文件加载进 process.env */
export function reloadDeployApiDotenv(options?: { override?: boolean }): string | null {
  const envPath = resolveDeployApiDotenvPath();
  if (envPath) {
    loadDotenv({ path: envPath, override: options?.override ?? false });
  }
  return envPath;
}

export type ProjectCatalogEntry = {
  id: string;
  /** 显示名 / 与启动页「工程名」对应 */
  name: string;
  /** 本地目录，可含 ~ */
  path: string;
};

export type ProjectCatalogFile = {
  version: 1;
  entries: ProjectCatalogEntry[];
};

function repoRoot(): string {
  return path.resolve(moduleDirname(), '..');
}

export function projectCatalogPath(): string {
  const override = process.env.ASSISTANT_PROJECT_CATALOG_PATH?.trim();
  if (override) return path.resolve(override);
  const userData = resolveUserDataConfigPath('assistant-project-catalog.json');
  if (userData) return userData;
  return resolveRepoConfigPath('assistant-project-catalog.json');
}

export function loadProjectCatalog(): ProjectCatalogEntry[] {
  const p = projectCatalogPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as ProjectCatalogFile;
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) return [];
    return data.entries.filter(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        typeof e.path === 'string'
    );
  } catch {
    return [];
  }
}

export function saveProjectCatalog(entries: ProjectCatalogEntry[]): void {
  const p = projectCatalogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body: ProjectCatalogFile = { version: 1, entries };
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + '\n', 'utf8');
}

/** 与 .env.example / deploy-api 使用变量对齐 */
export const ASSISTANT_ENV_UI_KEYS = [
  'JENKINS_USER',
  'JENKINS_TOKEN',
  'JIRA_SERVER_URL',
  'JIRA_USERNAME',
  'JIRA_PASSWORD',
  'JIRA_API_TOKEN',
  'JIRA_REST_PATH_PREFIX',
  'CONFLUENCE_BASE_URL',
  'CONFLUENCE_USERNAME',
  'CONFLUENCE_API_TOKEN',
  'CONFLUENCE_PASSWORD',
  'ASSISTANT_KB_LOCAL_DIRS',
  'ASSISTANT_KB_SEARCH_URLS',
  'ASSISTANT_WIKI_SEARCH_URL_TEMPLATE',
  'MAIL_IMAP_USER',
  'MAIL_IMAP_PASSWORD',
  'MAIL_IMAP_HOST',
  'MAIL_IMAP_PORT',
  'MAIL_DIGEST_SCHEDULE',
  'MAIL_DIGEST_LOOKBACK_HOURS',
  'MAIL_DIGEST_ENABLED',
] as const;

export type AssistantEnvUiKey = (typeof ASSISTANT_ENV_UI_KEYS)[number];

const SECRET_KEYS = new Set<AssistantEnvUiKey>([
  'JENKINS_TOKEN',
  'JIRA_PASSWORD',
  'JIRA_API_TOKEN',
  'CONFLUENCE_API_TOKEN',
  'CONFLUENCE_PASSWORD',
  'MAIL_IMAP_PASSWORD',
]);

export function isSecretEnvKey(key: string): boolean {
  return SECRET_KEYS.has(key as AssistantEnvUiKey);
}

/**
 * 简单解析 .env：支持 KEY=value、可选引号；忽略空行与 # 注释行。
 */
export function parseEnvValues(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      const q = val[0];
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    out.set(key, val);
  }
  return out;
}

function escapeEnvValue(value: string): string {
  if (value === '') return '""';
  if (/[\s#"']/.test(value) || value.includes('\n')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return value;
}

export function formatEnvLine(key: string, value: string): string {
  return `${key}=${escapeEnvValue(value)}`;
}

/**
 * 合并更新：updates 中出现的键写入或替换行；removeKeys 中的键整行删除。
 * 保留原文件中的其它行与注释顺序（逐行扫描）。
 */
export function mergeEnvFileContent(
  existingContent: string,
  updates: Record<string, string>,
  removeKeys: string[]
): string {
  const updateSet = new Set(Object.keys(updates));
  const removeSet = new Set(removeKeys);
  const lines = existingContent.split(/\r?\n/);
  const out: string[] = [];
  const applied = new Set<string>();

  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    const key = m?.[1];
    if (key && updateSet.has(key)) {
      out.push(formatEnvLine(key, updates[key]!));
      applied.add(key);
      continue;
    }
    if (key && removeSet.has(key)) {
      continue;
    }
    out.push(line);
  }

  const toAppend: string[] = [];
  for (const k of updateSet) {
    if (applied.has(k)) continue;
    toAppend.push(formatEnvLine(k, updates[k]!));
  }
  if (toAppend.length === 0) return out.join('\n');
  const tail = out.join('\n');
  const prefix = tail.length > 0 ? tail + (tail.endsWith('\n') ? '' : '\n') : '';
  return prefix + toAppend.join('\n') + '\n';
}

export function readEnvFileIfExists(absPath: string): string | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

export function writeEnvFile(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}
