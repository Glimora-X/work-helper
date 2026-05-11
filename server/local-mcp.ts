import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {moduleDirname} from './module-dirname';

export type McpConfigKind = 'cursor-user' | 'cursor-project';

export interface LocalMcpServerEntry {
  kind: McpConfigKind;
  serverName: string;
  configPath: string;
  command?: string;
  argsPreview: string;
  url?: string;
}

export interface ScanLocalMcpResult {
  servers: LocalMcpServerEntry[];
  configsTried: { kind: McpConfigKind; path: string; exists: boolean }[];
  warnings: string[];
}

type McpJson = {
  mcpServers?: Record<string, unknown>;
};

function summarizeArgs(args: unknown): string {
  if (!Array.isArray(args)) return '';
  return args.map((a) => String(a)).join(' ').slice(0, 280);
}

function parseMcpFile(
  filePath: string,
  kind: McpConfigKind,
  out: LocalMcpServerEntry[]
): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return '无法读取文件';
  }
  let parsed: McpJson;
  try {
    parsed = JSON.parse(raw) as McpJson;
  } catch (e) {
    return e instanceof Error ? e.message : 'JSON 解析失败';
  }
  const servers = parsed.mcpServers;
  if (!servers || typeof servers !== 'object') {
    return '未找到有效的 mcpServers 对象';
  }
  for (const [serverName, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;
    const command = typeof c.command === 'string' ? c.command : undefined;
    const url = typeof c.url === 'string' ? c.url : undefined;
    const argsPreview = summarizeArgs(c.args);
    out.push({
      kind,
      serverName,
      configPath: filePath,
      command: command || (url ? '(url / sse)' : undefined),
      argsPreview,
      url,
    });
  }
  return null;
}

export function scanLocalMcp(): ScanLocalMcpResult {
  const home = path.resolve(os.homedir());
  const repoRoot = path.resolve(path.join(moduleDirname(), '..'));
  const configsTried: ScanLocalMcpResult['configsTried'] = [];
  const servers: LocalMcpServerEntry[] = [];
  const warnings: string[] = [];

  const userPath = path.join(home, '.cursor', 'mcp.json');
  const userExists = fs.existsSync(userPath);
  configsTried.push({ kind: 'cursor-user', path: userPath, exists: userExists });
  if (userExists) {
    const err = parseMcpFile(userPath, 'cursor-user', servers);
    if (err) warnings.push(`${userPath}: ${err}`);
  }

  const projectPath = path.join(repoRoot, '.cursor', 'mcp.json');
  const projectExists = fs.existsSync(projectPath);
  configsTried.push({ kind: 'cursor-project', path: projectPath, exists: projectExists });
  if (projectExists) {
    if (path.resolve(projectPath) === path.resolve(userPath)) {
      warnings.push('项目内 .cursor/mcp.json 与用户目录下为同一路径，已忽略重复解析。');
    } else {
      const err = parseMcpFile(projectPath, 'cursor-project', servers);
      if (err) warnings.push(`${projectPath}: ${err}`);
    }
  }

  servers.sort((a, b) => {
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    return a.serverName.localeCompare(b.serverName, 'zh-CN', { sensitivity: 'base' });
  });

  return { servers, configsTried, warnings };
}
