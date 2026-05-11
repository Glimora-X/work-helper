import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SkillSource = 'claude' | 'cursor' | 'agents' | 'codex';

export interface LocalSkillEntry {
  source: SkillSource;
  displayName: string;
  description: string;
  skillMdPath: string;
  skillDir: string;
}

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
]);

function isUnderRoot(absChild: string, rootAbs: string): boolean {
  const child = path.resolve(absChild);
  const root = path.resolve(rootAbs);
  return child === root || child.startsWith(root + path.sep);
}

function stripYamlScalar(s: string): string {
  let t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  return t.trim();
}

/** 读取 SKILL.md 顶部 YAML 中的 name / description（单行，常见格式） */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return {};
  const afterOpen = trimmed.slice(3);
  const firstNl = afterOpen.indexOf('\n');
  if (firstNl === -1) return {};
  let body = afterOpen.slice(firstNl + 1);
  const endRe = /\n---\s*(?:\n|$)/;
  const m = endRe.exec(body);
  if (!m) return {};
  const fm = body.slice(0, m.index);
  const nameLine = fm.match(/^\s*name:\s*(.+)$/m);
  const descLine = fm.match(/^\s*description:\s*(.+)$/m);
  return {
    name: nameLine ? stripYamlScalar(nameLine[1]) : undefined,
    description: descLine ? stripYamlScalar(descLine[1]) : undefined,
  };
}

function walk(opts: {
  dir: string;
  rootAbs: string;
  source: SkillSource;
  maxDepth: number;
  depth: number;
  out: LocalSkillEntry[];
}): void {
  const { dir, rootAbs, source, maxDepth, depth, out } = opts;
  if (depth > maxDepth) return;

  let resolved: string;
  try {
    resolved = path.resolve(dir);
  } catch {
    return;
  }
  if (!isUnderRoot(resolved, rootAbs)) return;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) return;

  const skillFile = path.join(resolved, 'SKILL.md');
  try {
    if (fs.existsSync(skillFile)) {
      const st = fs.statSync(skillFile);
      if (st.isFile()) {
        const content = fs.readFileSync(skillFile, 'utf8');
        const fm = parseSkillFrontmatter(content);
        const folderName = path.basename(resolved);
        out.push({
          source,
          displayName: fm.name || folderName,
          description: (fm.description || '').slice(0, 480),
          skillMdPath: skillFile,
          skillDir: resolved,
        });
      }
    }
  } catch {
    /* 跳过无法读取的 SKILL.md */
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const child = path.join(resolved, ent.name);
    walk({
      dir: child,
      rootAbs,
      source,
      maxDepth,
      depth: depth + 1,
      out,
    });
  }
}

export interface ScanLocalSkillsResult {
  skills: LocalSkillEntry[];
  rootsTried: { source: SkillSource; path: string; exists: boolean }[];
  warnings: string[];
}

export function scanLocalSkills(): ScanLocalSkillsResult {
  const home = path.resolve(os.homedir());
  const skills: LocalSkillEntry[] = [];
  const rootsTried: ScanLocalSkillsResult['rootsTried'] = [];
  const warnings: string[] = [];

  const roots: { source: SkillSource; rel: string }[] = [
    { source: 'claude', rel: path.join('.claude', 'skills') },
    { source: 'cursor', rel: path.join('.cursor', 'skills-cursor') },
    { source: 'agents', rel: path.join('.agents', 'skills') },
    { source: 'codex', rel: path.join('.codex', 'skills') },
  ];

  for (const { source, rel } of roots) {
    const abs = path.join(home, rel);
    const exists = fs.existsSync(abs);
    rootsTried.push({ source, path: abs, exists });
    if (!exists) {
      warnings.push(`目录不存在，已跳过：${abs}`);
      continue;
    }
    walk({ dir: abs, rootAbs: abs, source, maxDepth: 14, depth: 0, out: skills });
  }

  skills.sort((a, b) => {
    const byName = a.displayName.localeCompare(b.displayName, 'zh-CN', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.skillMdPath.localeCompare(b.skillMdPath);
  });

  return { skills, rootsTried, warnings };
}
