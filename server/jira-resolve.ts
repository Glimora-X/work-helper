/**
 * Resolve Jira issue -> suggested Jenkins job path segments (via component mapping).
 * 凭据与 `jira-rest.resolveJiraAuth` 一致：仅 JIRA_SERVER_URL + JIRA_USERNAME + 密码或 Token。
 */

import { resolveJiraAuth } from './jira-rest';

export interface JiraResolution {
  nodes: string[];
  source: 'jira' | 'fallback';
  components?: string[];
  message?: string;
}

function parseComponentMap(raw: string | undefined): Record<string, string[][]> {
  if (!raw?.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, string | string[]>;
    const out: Record<string, string[][]> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        out[k.toLowerCase()] = [v.split('/').filter(Boolean)];
      } else if (Array.isArray(v)) {
        out[k.toLowerCase()] = v.map((item) =>
          typeof item === 'string' ? item.split('/').filter(Boolean) : []
        );
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseFallbackNodes(raw: string | undefined): string[] {
  if (!raw?.trim()) return ['biz-core', 'cc-web'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function userSetJiraRestPathPrefix(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.JIRA_REST_PATH_PREFIX?.trim());
}

export async function resolveIssueToJobPaths(options: {
  issueKey: string;
  componentMapJson?: string;
  fallbackNodesCsv?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<JiraResolution> {
  const env = options.env ?? process.env;
  const { issueKey, componentMapJson, fallbackNodesCsv } = options;
  const fallback = parseFallbackNodes(fallbackNodesCsv);
  const map = parseComponentMap(componentMapJson);

  const cfg = resolveJiraAuth(env);
  if (cfg.ok === false) {
    return {
      nodes: fallback,
      source: 'fallback',
      message: `${cfg.reason}; using JIRA_RESOLUTION_FALLBACK_NODES.`,
    };
  }

  let prefix = cfg.apiPrefix;
  let url = `${cfg.baseUrl}/${prefix}/issue/${encodeURIComponent(issueKey)}?fields=components`;

  const headers = {
    Authorization: cfg.authHeader,
    Accept: 'application/json',
  };

  let resp = await fetch(url, { headers });

  if (
    !resp.ok &&
    (resp.status === 404 || resp.status === 410) &&
    !userSetJiraRestPathPrefix(env) &&
    prefix === 'rest/api/3'
  ) {
    prefix = 'rest/api/2';
    url = `${cfg.baseUrl}/${prefix}/issue/${encodeURIComponent(issueKey)}?fields=components`;
    resp = await fetch(url, { headers });
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return {
      nodes: fallback,
      source: 'fallback',
      message: `Jira HTTP ${resp.status}; using fallback. ${errText.slice(0, 120)}`,
    };
  }

  const data = (await resp.json()) as {
    fields?: { components?: { name?: string }[] };
  };
  const components = (data.fields?.components || [])
    .map((c) => c.name)
    .filter((n): n is string => !!n);

  const jobPaths = new Set<string>();
  for (const c of components) {
    const paths = map[c.toLowerCase()] || map[c] || [];
    for (const segments of paths) {
      if (segments.length) jobPaths.add(segments.join('/'));
    }
  }

  if (jobPaths.size === 0) {
    return {
      nodes: fallback,
      source: 'fallback',
      components,
      message:
        components.length > 0
          ? `No JIRA_COMPONENT_JOB_MAP entries for components: ${components.join(', ')}. Using fallback.`
          : 'Issue has no components; using fallback.',
    };
  }

  return {
    nodes: [...jobPaths],
    source: 'jira',
    components,
  };
}
