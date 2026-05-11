import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export type LocalModelSource = 'ollama-cli' | 'ollama-manifest' | 'lm-studio';

export interface LocalModelEntry {
  source: LocalModelSource;
  name: string;
  sizeOrNote?: string;
  path?: string;
}

export interface ScanLocalModelsResult {
  models: LocalModelEntry[];
  rootsTried: { label: string; path: string; exists: boolean }[];
  warnings: string[];
}

function parseOllamaList(stdout: string): LocalModelEntry[] {
  const out: LocalModelEntry[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^NAME\b/i.test(t)) continue;
    const parts = t.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 1) continue;
    const name = parts[0];
    out.push({
      source: 'ollama-cli',
      name,
      sizeOrNote: parts.slice(1).join(' · ') || undefined,
    });
  }
  return out;
}

function scanOllamaManifestModels(home: string): LocalModelEntry[] {
  const base = path.join(home, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library');
  if (!fs.existsSync(base)) return [];
  const out: LocalModelEntry[] = [];
  let modelDirs: fs.Dirent[];
  try {
    modelDirs = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of modelDirs) {
    if (!ent.isDirectory()) continue;
    const modelName = ent.name;
    const mp = path.join(base, modelName);
    let tags: fs.Dirent[];
    try {
      tags = fs.readdirSync(mp, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const tag of tags) {
      const tagPath = path.join(mp, tag.name);
      const tagLabel = tag.isDirectory() ? tag.name : path.parse(tag.name).name;
      out.push({
        source: 'ollama-manifest',
        name: `${modelName}:${tagLabel}`,
        path: tagPath,
      });
    }
  }
  return out;
}

function walkGguf(
  dir: string,
  opts: { maxDepth: number; depth: number; out: LocalModelEntry[] }
): void {
  const { maxDepth, depth, out } = opts;
  if (depth > maxDepth) return;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) {
      let sizeNote: string | undefined;
      try {
        const st = fs.statSync(p);
        const mb = st.size / (1024 * 1024);
        if (Number.isFinite(mb)) sizeNote = `${mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`}`;
      } catch {
        /* */
      }
      out.push({
        source: 'lm-studio',
        name: e.name.replace(/\.gguf$/i, ''),
        path: p,
        sizeOrNote: sizeNote,
      });
    } else if (e.isDirectory()) {
      walkGguf(p, { maxDepth, depth: depth + 1, out });
    }
  }
}

function lmStudioModelRoots(home: string): string[] {
  const roots: string[] = [];
  if (process.platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Application Support', 'LM Studio', 'models'));
  }
  roots.push(path.join(home, '.cache', 'lm-studio', 'models'));
  return roots;
}

export function scanLocalModels(): ScanLocalModelsResult {
  const home = path.resolve(os.homedir());
  const rootsTried: ScanLocalModelsResult['rootsTried'] = [];
  const warnings: string[] = [];
  const byName = new Map<string, LocalModelEntry>();

  const add = (m: LocalModelEntry) => {
    const key =
      m.source === 'lm-studio' && m.path ? `lm:${m.path}` : `name:${m.name.toLowerCase()}`;
    if (byName.has(key)) return;
    byName.set(key, m);
  };

  const ollamaList = spawnSync('ollama', ['list'], {
    encoding: 'utf8',
    timeout: 12_000,
    shell: false,
  });
  const listOk = ollamaList.status === 0 && Boolean(ollamaList.stdout?.trim());
  rootsTried.push({
    label: 'Ollama CLI（ollama list）',
    path: 'ollama list',
    exists: listOk,
  });
  if (listOk && ollamaList.stdout) {
    for (const e of parseOllamaList(ollamaList.stdout)) add(e);
  } else if (ollamaList.error && (ollamaList.error as NodeJS.ErrnoException).code === 'ENOENT') {
    rootsTried[rootsTried.length - 1].exists = false;
  } else if (!listOk && ollamaList.stderr?.trim()) {
    warnings.push(`ollama list：${ollamaList.stderr.trim().slice(0, 200)}`);
  }

  const manBase = path.join(home, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library');
  const manExists = fs.existsSync(manBase);
  rootsTried.push({ label: 'Ollama 本地清单目录', path: manBase, exists: manExists });
  if (manExists) {
    for (const e of scanOllamaManifestModels(home)) add(e);
  }

  for (const root of lmStudioModelRoots(home)) {
    const exists = fs.existsSync(root);
    rootsTried.push({ label: 'LM Studio 模型目录', path: root, exists });
    if (!exists) continue;
    const found: LocalModelEntry[] = [];
    walkGguf(root, { maxDepth: 8, depth: 0, out: found });
    for (const e of found) add(e);
  }

  const models = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' })
  );

  return { models, rootsTried, warnings };
}
