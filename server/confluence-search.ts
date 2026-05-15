/**
 * 「Wiki」在代码里若指 Atlassian Confluence，则用本模块做全文检索（CQL `text ~ "..."`）。
 * 其它 Wiki 产品（MediaWiki、自建站等）请用 ASSISTANT_WIKI_SEARCH_URL_TEMPLATE 自建 HTTP 检索。
 * 凭据可与 Jira 同源：未单独配置 CONFLUENCE_* 时回退 JIRA_USERNAME + JIRA_API_TOKEN / JIRA_PASSWORD。
 */

function trimCred(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^["']+|["']+$/g, '');
  s = s.replace(/["',;\s]+$/g, '');
  return s;
}

function normalizeConfluenceBase(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.hostname.endsWith('.atlassian.net') && !/\/wiki$/i.test(s)) {
      s = `${s}/wiki`;
    }
  } catch {
    /* 保持原样 */
  }
  return s.replace(/\/+$/, '');
}

function restApiRootFromBase(base: string): string {
  return `${base}/rest/api`;
}

/** CQL 双引号字符串内转义 */
function escapeCqlDoubleQuoted(q: string): string {
  const t = q.trim().slice(0, 400);
  return t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ConfluenceSearchConfig =
  | { ok: true; restRoot: string; siteBase: string; authHeader: string }
  | { ok: false; reason: string };

export function resolveConfluenceSearch(env: NodeJS.ProcessEnv = process.env): ConfluenceSearchConfig {
  const rawBase = trimCred(env.CONFLUENCE_BASE_URL);
  if (!rawBase) {
    return { ok: false, reason: '未设置 CONFLUENCE_BASE_URL' };
  }

  const siteBase = normalizeConfluenceBase(rawBase);
  const restRoot = restApiRootFromBase(siteBase);

  const user =
    trimCred(env.CONFLUENCE_USERNAME) ||
    trimCred(env.JIRA_USERNAME) ||
    (trimCred(env.JIRA_PASSWORD) || trimCred(env.JIRA_API_TOKEN) ? trimCred(env.JENKINS_USER) : undefined);

  const pass = trimCred(env.CONFLUENCE_PASSWORD) || trimCred(env.JIRA_PASSWORD);
  const token = trimCred(env.CONFLUENCE_API_TOKEN) || trimCred(env.JIRA_API_TOKEN);

  if (!user) {
    return {
      ok: false,
      reason: '缺少登录名：请设置 CONFLUENCE_USERNAME，或未设置时配置 JIRA_USERNAME（或与 Jira 相同的 JENKINS_USER + 密钥）',
    };
  }

  if (pass) {
    const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    return { ok: true, restRoot, siteBase, authHeader };
  }
  if (token) {
    const authHeader = 'Basic ' + Buffer.from(`${user}:${token}`, 'utf8').toString('base64');
    return { ok: true, restRoot, siteBase, authHeader };
  }

  return {
    ok: false,
    reason: '缺少密钥：请设置 CONFLUENCE_PASSWORD / CONFLUENCE_API_TOKEN，或回退 JIRA_PASSWORD / JIRA_API_TOKEN',
  };
}

type ConfluenceSearchJson = {
  results?: {
    id?: string;
    type?: string;
    title?: string;
    excerpt?: string;
    body?: { view?: { value?: string }; storage?: { value?: string } };
    _links?: { webui?: string; self?: string };
  }[];
  size?: number;
  message?: string;
  statusCode?: number;
};

function hitUrl(siteBase: string, item: NonNullable<ConfluenceSearchJson['results']>[0]): string {
  const webui = item._links?.webui;
  if (webui && webui.startsWith('http')) return webui;
  if (webui) {
    try {
      return new URL(webui.replace(/^\/+/, ''), `${siteBase}/`).href;
    } catch {
      return `${siteBase}${webui.startsWith('/') ? '' : '/'}${webui}`;
    }
  }
  return item._links?.self || siteBase;
}

function excerptFromItem(item: NonNullable<ConfluenceSearchJson['results']>[0]): string {
  if (item.excerpt?.trim()) return item.excerpt.trim().slice(0, 600);
  const html = item.body?.view?.value || item.body?.storage?.value;
  if (html) return stripHtml(html).slice(0, 600);
  return '';
}

/**
 * Confluence REST：GET /rest/api/content/search?cql=text ~ "..." 全文检索页面/博客等。
 * @see https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content/#api-wiki-rest-api-content-search-get
 */
export type ConfluenceWikiHit = {
  title: string;
  excerpt: string;
  source: string;
  kind: 'wiki';
};

export async function searchConfluenceFullText(
  query: string,
  warnings: string[]
): Promise<ConfluenceWikiHit[]> {
  const cfg = resolveConfluenceSearch();
  if (cfg.ok === false) {
    if (trimCred(process.env.CONFLUENCE_BASE_URL)) {
      warnings.push(`Wiki（Confluence）：${cfg.reason}`);
    }
    return [];
  }

  const q = query.trim();
  if (!q) return [];

  const cql = `text ~ "${escapeCqlDoubleQuoted(q)}" and type in ("page","blogpost")`;
  const url = new URL(`${cfg.restRoot}/content/search`);
  url.searchParams.set('cql', cql);
  url.searchParams.set('limit', '12');
  url.searchParams.set('expand', 'body.view');

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url.href, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: cfg.authHeader,
      },
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        const j = JSON.parse(text) as { message?: string; data?: { message?: string } };
        detail = j.message || j.data?.message || detail;
      } catch {
        /* */
      }
      warnings.push(`Wiki（Confluence）全文检索 HTTP ${res.status}：${detail}`);
      return [];
    }

    let data: ConfluenceSearchJson;
    try {
      data = JSON.parse(text) as ConfluenceSearchJson;
    } catch {
      warnings.push('Wiki（Confluence）返回非 JSON');
      return [];
    }

    const results = data.results ?? [];
    const out: ConfluenceWikiHit[] = [];
    for (const item of results) {
      const title = item.title?.trim() || '（无标题）';
      const excerpt = excerptFromItem(item) || '（无摘要）';
      const source = hitUrl(cfg.siteBase, item);
      out.push({ title, excerpt, source, kind: 'wiki' });
    }
    return out;
  } catch (e) {
    warnings.push(e instanceof Error ? `Wiki（Confluence）请求失败：${e.message}` : 'Wiki（Confluence）请求失败');
    return [];
  } finally {
    clearTimeout(t);
  }
}

export function isConfluenceSearchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(trimCred(env.CONFLUENCE_BASE_URL));
}
