import fs from 'node:fs';
import path from 'node:path';
import { isConfluenceSearchConfigured, searchConfluenceFullText } from './confluence-search';

const TEXT_EXT = new Set(['.md', '.mdx', '.txt', '.markdown']);
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.cache',
]);

export interface KnowledgeHit {
  title: string;
  excerpt: string;
  source: string;
  kind: 'local' | 'wiki';
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  warnings: string[];
}

function parseLocalRoots(): string[] {
  const raw = process.env.ASSISTANT_KB_LOCAL_DIRS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

function termsFromQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s\u3000,，.。;；、]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

function makeExcerpt(content: string, terms: string[], maxLen: number): string {
  const low = content.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    const idx = low.indexOf(t);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  const i = bestIdx >= 0 ? bestIdx : 0;
  const start = Math.max(0, i - 100);
  const slice = content.slice(start, start + maxLen).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + slice + (start + maxLen < content.length ? '…' : '');
}

function fileMatches(content: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const low = content.toLowerCase();
  return terms.some((t) => low.includes(t));
}

function walkLocal(
  dir: string,
  opts: {
    rootLabel: string;
    terms: string[];
    maxDepth: number;
    depth: number;
    maxFiles: number;
    state: { files: number; hits: KnowledgeHit[] };
  }
): void {
  const { rootLabel, terms, maxDepth, depth, maxFiles, state } = opts;
  if (depth > maxDepth || state.files >= maxFiles || state.hits.length >= 14) return;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (state.files >= maxFiles || state.hits.length >= 14) return;
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkLocal(p, { rootLabel, terms, maxDepth, depth: depth + 1, maxFiles, state });
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;

    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 900_000) continue;

    state.files += 1;
    let content: string;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    if (!fileMatches(content, terms)) continue;

    const title = ent.name.replace(/\.(md|mdx|txt|markdown)$/i, '');
    const excerpt = makeExcerpt(content, terms, 420);
    state.hits.push({
      title: `${title}（${rootLabel}）`,
      excerpt,
      source: p,
      kind: 'local',
    });
  }
}

/** 多个 HTTP 全文检索端点：分号分隔；与 ASSISTANT_WIKI_SEARCH_URL_TEMPLATE 合并（去重）。语雀 / 自建 Wiki / CDN 搜索接口等均可各填一条。 */
export function parseRemoteSearchTemplates(): string[] {
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t) seen.add(t);
  };
  const legacy = process.env.ASSISTANT_WIKI_SEARCH_URL_TEMPLATE;
  if (legacy?.trim()) add(legacy);
  const multi = process.env.ASSISTANT_KB_SEARCH_URLS;
  if (multi?.trim()) {
    for (const part of multi.split(';')) {
      if (part.trim()) add(part);
    }
  }
  return [...seen];
}

export function getRemoteKnowledgeBridgeCount(): number {
  return parseRemoteSearchTemplates().length;
}

function bridgeLabelForWarn(tmpl: string, index: number): string {
  try {
    const base = tmpl.includes('{{query}}') ? tmpl.split('{{query}}')[0] : tmpl.split('?')[0];
    return new URL(base).hostname || `端点#${index + 1}`;
  } catch {
    return `端点#${index + 1}`;
  }
}

function normalizeWikiHits(data: unknown): KnowledgeHit[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  const arr =
    (Array.isArray(o.hits) && o.hits) ||
    (Array.isArray(o.results) && o.results) ||
    (Array.isArray(o.items) && o.items) ||
    [];
  const out: KnowledgeHit[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const title = String(it.title ?? it.name ?? 'Wiki');
    const excerpt = String(it.excerpt ?? it.snippet ?? it.body ?? it.text ?? '').slice(0, 600);
    const source = String(it.url ?? it.link ?? it.path ?? 'wiki');
    if (title || excerpt) {
      out.push({ title: title || 'Wiki', excerpt: excerpt || '（无摘要）', source, kind: 'wiki' });
    }
  }
  return out;
}

async function searchOneHttpBridge(
  query: string,
  tmpl: string,
  warnings: string[],
  bridgeLabel: string
): Promise<KnowledgeHit[]> {
  const urlStr = tmpl.includes('{{query}}')
    ? tmpl.split('{{query}}').join(encodeURIComponent(query))
    : tmpl + (tmpl.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(query);

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    warnings.push(`「${bridgeLabel}」检索 URL 无效`);
    return [];
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
      signal: ac.signal,
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!res.ok) {
      warnings.push(`「${bridgeLabel}」检索 HTTP ${res.status}`);
      return [];
    }
    if (ct.includes('application/json')) {
      try {
        return normalizeWikiHits(JSON.parse(text));
      } catch {
        warnings.push(`「${bridgeLabel}」返回的 JSON 无法解析`);
        return [];
      }
    }
    if (text.trim()) {
      return [
        {
          title: `${bridgeLabel} 文本响应`,
          excerpt: text.trim().slice(0, 800),
          source: urlStr,
          kind: 'wiki',
        },
      ];
    }
  } catch (e) {
    warnings.push(e instanceof Error ? `「${bridgeLabel}」请求失败：${e.message}` : `「${bridgeLabel}」请求失败`);
  } finally {
    clearTimeout(t);
  }
  return [];
}

async function searchAllHttpBridges(query: string, warnings: string[]): Promise<KnowledgeHit[]> {
  const templates = parseRemoteSearchTemplates();
  const merged: KnowledgeHit[] = [];
  for (let i = 0; i < templates.length; i++) {
    const label = bridgeLabelForWarn(templates[i], i);
    const part = await searchOneHttpBridge(query, templates[i], warnings, label);
    merged.push(...part);
  }
  return merged;
}

/** 在配置的本地目录与可选 Wiki HTTP 模板中检索，供Dottie-Assistant注入上下文 */
export async function searchKnowledge(query: string): Promise<KnowledgeSearchResult> {
  const warnings: string[] = [];
  const hits: KnowledgeHit[] = [];
  const terms = termsFromQuery(query);

  if (terms.length === 0 && query.trim().length > 0) {
    /** 单字查询：仍用整句做子串匹配 */
    terms.push(query.trim().toLowerCase());
  }

  const roots = parseLocalRoots();
  const remoteTemplates = parseRemoteSearchTemplates();
  const hasHttpBridges = remoteTemplates.length > 0;
  const hasConfluence = isConfluenceSearchConfigured();
  if (roots.length === 0 && !hasHttpBridges && !hasConfluence) {
    warnings.push(
      '未配置知识库：ASSISTANT_KB_LOCAL_DIRS（本地）；Confluence 型 Wiki 设 CONFLUENCE_BASE_URL；其它（语雀/自建/CDN 等）用 ASSISTANT_KB_SEARCH_URLS 或 ASSISTANT_WIKI_SEARCH_URL_TEMPLATE（GET 全文检索）。'
    );
  }

  const state = { files: 0, hits: [] as KnowledgeHit[] };
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      warnings.push(`知识库目录不存在：${root}`);
      continue;
    }
    const st = fs.statSync(root);
    const label = path.basename(root);
    if (st.isFile()) {
      state.files += 1;
      if (TEXT_EXT.has(path.extname(root).toLowerCase())) {
        try {
          const content = fs.readFileSync(root, 'utf8');
          if (fileMatches(content, terms)) {
            state.hits.push({
              title: path.basename(root),
              excerpt: makeExcerpt(content, terms, 420),
              source: root,
              kind: 'local',
            });
          }
        } catch {
          /* */
        }
      }
    } else if (st.isDirectory()) {
      walkLocal(root, {
        rootLabel: label,
        terms: terms.length ? terms : [query.trim().toLowerCase()].filter(Boolean),
        maxDepth: 8,
        depth: 0,
        maxFiles: 220,
        state,
      });
    }
  }
  hits.push(...state.hits);

  /** Wiki：若部署为 Atlassian Confluence，则 CQL `text ~ "..."` 全文检索正文 */
  const cfHits = await searchConfluenceFullText(query, warnings);
  for (const h of cfHits) {
    if (hits.length >= 16) break;
    hits.push(h);
  }

  const wikiHits = await searchAllHttpBridges(query, warnings);
  for (const h of wikiHits) {
    if (hits.length >= 16) break;
    hits.push(h);
  }

  return { hits, warnings };
}
