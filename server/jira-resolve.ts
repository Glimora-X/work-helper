/**
 * Resolve Jira issue -> suggested Jenkins job path segments (via component mapping).
 */

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

export async function resolveIssueToJobPaths(options: {
  issueKey: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  componentMapJson?: string;
  fallbackNodesCsv?: string;
}): Promise<JiraResolution> {
  const { issueKey, jiraBaseUrl, jiraEmail, jiraApiToken, componentMapJson, fallbackNodesCsv } =
    options;
  const fallback = parseFallbackNodes(fallbackNodesCsv);
  const map = parseComponentMap(componentMapJson);

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    return {
      nodes: fallback,
      source: 'fallback',
      message: 'Jira env not set; using JIRA_RESOLUTION_FALLBACK_NODES.',
    };
  }

  const auth =
    'Basic ' + Buffer.from(`${jiraEmail}:${jiraApiToken}`, 'utf8').toString('base64');
  const prefix = (process.env.JIRA_REST_PATH_PREFIX || 'rest/api/3').replace(/^\/+|\/+$/g, '');
  const url = `${jiraBaseUrl.replace(/\/$/, '')}/${prefix}/issue/${encodeURIComponent(issueKey)}?fields=components`;

  const resp = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: 'application/json',
    },
  });

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
