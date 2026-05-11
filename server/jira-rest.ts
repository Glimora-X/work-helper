/**
 * Jira REST 统一环境变量（总结页、部署 Jira 解析、与 MCP 对齐）：
 * JIRA_SERVER_URL + JIRA_USERNAME +（JIRA_PASSWORD 或 JIRA_API_TOKEN 二选一）。
 * 未设 JIRA_USERNAME 时可用 JENKINS_USER 作登录名（密钥仍须 JIRA_PASSWORD 或 JIRA_API_TOKEN）。
 */

export type JiraAuthConfig =
  | { ok: true; baseUrl: string; apiPrefix: string; authHeader: string }
  | { ok: false; reason: string };

/** 去掉 .env 里误带的 JSON 行尾逗号、成对/不成对引号等，避免 fetch 报 Failed to parse URL */
function normalizeJiraSiteUrl(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^["']+|["']+$/g, '');
  s = s.replace(/\/+$/, '');
  s = s.replace(/["',;\s]+$/g, '');
  return s.replace(/\/+$/, '');
}

function normalizeApiPrefix(raw: string | undefined): string {
  const s = (raw || 'rest/api/3').trim().replace(/^["']+|["']+$/g, '').replace(/["',;\s]+$/g, '');
  return s.replace(/^\/+|\/+$/g, '');
}

/** 去掉 .env 里误包的一层引号或行尾逗号，避免 Basic 永远 401 */
function normalizeCredential(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^["']+|["']+$/g, '');
  s = s.replace(/["',;\s]+$/g, '');
  return s;
}

export function resolveJiraAuth(env: NodeJS.ProcessEnv = process.env): JiraAuthConfig {
  const rawBase = (env.JIRA_SERVER_URL || '').trim();
  const baseUrl = normalizeJiraSiteUrl(rawBase);
  const apiPrefix = normalizeApiPrefix(env.JIRA_REST_PATH_PREFIX);

  const jiraUser = normalizeCredential(env.JIRA_USERNAME);
  const jenkinsUser = normalizeCredential(env.JENKINS_USER);
  const pass = normalizeCredential(env.JIRA_PASSWORD);
  const token = normalizeCredential(env.JIRA_API_TOKEN);

  /** 有 Jira 专用用户名则用之；否则在提供了密钥时允许用 JENKINS_USER 作登录名 */
  const user = jiraUser || (pass || token ? jenkinsUser : undefined);

  if (!baseUrl) {
    return { ok: false, reason: '缺少 JIRA_SERVER_URL' };
  }

  if (!user) {
    return {
      ok: false,
      reason: '缺少 JIRA_USERNAME（未设时须存在 JENKINS_USER 且配置 JIRA_PASSWORD 或 JIRA_API_TOKEN）',
    };
  }

  if (pass) {
    const authHeader =
      'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    return { ok: true, baseUrl, apiPrefix, authHeader };
  }

  if (token) {
    const authHeader =
      'Basic ' + Buffer.from(`${user}:${token}`, 'utf8').toString('base64');
    return { ok: true, baseUrl, apiPrefix, authHeader };
  }

  return {
    ok: false,
    reason: '缺少密钥：请设置 JIRA_PASSWORD 或 JIRA_API_TOKEN（与 JIRA_USERNAME 组成 Basic 认证）',
  };
}

export interface JiraSearchIssue {
  key: string;
  fields: {
    summary?: string;
    updated?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    project?: { key?: string; name?: string };
    resolution?: { name?: string } | null;
  };
}

export interface JiraSearchResult {
  issues: JiraSearchIssue[];
  total: number;
  error?: string;
}

function jiraSearchErrorDetail(status: number, text: string): string {
  const head = text.trim().slice(0, 2500);
  const looksLikeHtml =
    head.startsWith('<') ||
    /<html[\s>]|<!DOCTYPE|<title>\s*Unauthorized/i.test(head) ||
    /Unauthorized \(401\)/i.test(head);

  if (looksLikeHtml) {
    if (status === 401) {
      return (
        'Jira 返回了 HTML 鉴权页（非 JSON），说明 Basic 认证未通过。' +
        '请逐项核对：① JIRA_USERNAME 为 Jira 登录名；② JIRA_PASSWORD 或 JIRA_API_TOKEN 正确、无多余空格/引号；' +
        '③ 与 MCP 对比 .env 是否一致；④ SSO 场景请用 Jira 生成的 REST API Token 填入 JIRA_API_TOKEN。'
      );
    }
    if (status === 403) {
      return 'Jira 返回了 HTML 禁止访问页；请确认该账号有浏览项目及使用 REST 的权限。';
    }
    return `Jira 返回了 HTML 错误页（HTTP ${status}），无法解析为 JSON。`;
  }

  const slice = text.slice(0, 600);
  try {
    const j = JSON.parse(text) as {
      errorMessages?: string[];
      message?: string;
      errors?: Record<string, string>;
    };
    if (Array.isArray(j.errorMessages) && j.errorMessages.length) {
      return j.errorMessages.join(' ');
    }
    if (typeof j.message === 'string' && j.message.trim()) {
      return j.message.trim();
    }
    if (j.errors && typeof j.errors === 'object') {
      const parts = Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`);
      if (parts.length) return parts.join('; ');
    }
  } catch {
    /* 非 JSON，用 slice */
  }
  return slice;
}

function userSetJiraRestPathPrefix(env: NodeJS.ProcessEnv | undefined): boolean {
  return Boolean((env ?? process.env).JIRA_REST_PATH_PREFIX?.trim());
}

const JIRA_SEARCH_LOG_PREVIEW = 800;

function previewForLog(text: string, max = JIRA_SEARCH_LOG_PREVIEW): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…(truncated)`;
}

async function postJiraSearch(
  baseUrl: string,
  apiPrefix: string,
  authHeader: string,
  body: { jql: string; maxResults: number; fields: string[] }
): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${baseUrl}/${apiPrefix}/search`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function jiraSearch(options: {
  jql: string;
  maxResults?: number;
  fields?: string[];
  env?: NodeJS.ProcessEnv;
  /** 若设置（通常为 HTTP 路由 + query），会打印本次调用的参数与失败详情（不含 Authorization） */
  logContext?: string;
}): Promise<JiraSearchResult & { authError?: string }> {
  const logCtx = options.logContext?.trim();
  const cfg = resolveJiraAuth(options.env);
  if (cfg.ok === false) {
    if (logCtx) {
      console.error('[jiraSearch]', logCtx, '跳过请求：Jira 凭据未就绪', {
        reason: cfg.reason,
        jql: options.jql,
        maxResultsRequested: options.maxResults,
      });
    }
    return { issues: [], total: 0, authError: cfg.reason };
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? 50, 1), 100);
  const fields = options.fields?.length
    ? options.fields
    : ['summary', 'status', 'updated', 'issuetype', 'priority', 'project', 'resolution'];

  const body = { jql: options.jql, maxResults, fields };
  const searchUrlPrimary = `${cfg.baseUrl}/${cfg.apiPrefix}/search`;

  if (logCtx) {
    console.warn('[jiraSearch]', logCtx, '请求 Jira', {
      method: 'POST',
      url: searchUrlPrimary,
      jql: body.jql,
      maxResults: body.maxResults,
      fields: body.fields,
      apiPrefix: cfg.apiPrefix,
    });
  }

  let res = await postJiraSearch(cfg.baseUrl, cfg.apiPrefix, cfg.authHeader, body);

  if (
    !res.ok &&
    (res.status === 404 || res.status === 410) &&
    !userSetJiraRestPathPrefix(options.env) &&
    cfg.apiPrefix === 'rest/api/3'
  ) {
    if (logCtx) {
      console.warn('[jiraSearch]', logCtx, '首次 search 失败，改用 rest/api/2 重试', {
        httpStatus: res.status,
        responsePreview: previewForLog(res.text),
      });
    }
    res = await postJiraSearch(cfg.baseUrl, 'rest/api/2', cfg.authHeader, body);
  }

  if (!res.ok) {
    let detail = jiraSearchErrorDetail(res.status, res.text);
    if ((res.status === 404 || res.status === 410) && cfg.apiPrefix === 'rest/api/3') {
      detail += '（Jira Server 常见路径为 rest/api/2，可在 .env 设置 JIRA_REST_PATH_PREFIX=rest/api/2）';
    }
    if (logCtx) {
      console.error('[jiraSearch]', logCtx, 'Jira search 失败', {
        httpStatus: res.status,
        errorMessage: detail,
        responsePreview: previewForLog(res.text),
      });
    }
    return {
      issues: [],
      total: 0,
      error: `Jira HTTP ${res.status}: ${detail}`,
    };
  }

  try {
    const data = JSON.parse(res.text) as {
      issues?: JiraSearchIssue[];
      total?: number;
    };
    const issues = Array.isArray(data.issues) ? data.issues : [];
    const total = typeof data.total === 'number' ? data.total : 0;
    if (logCtx) {
      console.warn('[jiraSearch]', logCtx, '成功', { total, issueCount: issues.length });
    }
    return { issues, total };
  } catch (e) {
    const parseErr = e instanceof Error ? e.message : String(e);
    if (logCtx) {
      console.error('[jiraSearch]', logCtx, '响应非合法 JSON', {
        parseError: parseErr,
        responsePreview: previewForLog(res.text),
      });
    }
    return { issues: [], total: 0, error: '无法解析 Jira 响应 JSON' };
  }
}

// —— Issue 工作流过渡（提测等）——

export type JiraTransitionOption = { id: string; name: string };

export type JiraSubmitTestResult =
  | { ok: true; transitionId: string; transitionName?: string }
  | {
      ok: false;
      error: string;
      availableTransitions?: JiraTransitionOption[];
    };

async function jiraIssueTransitionsRequest(
  baseUrl: string,
  apiPrefix: string,
  authHeader: string,
  issueKey: string,
  method: 'GET' | 'POST',
  postBody?: unknown
): Promise<{ ok: boolean; status: number; text: string }> {
  const path = `issue/${encodeURIComponent(issueKey)}/transitions`;
  const url = `${baseUrl}/${apiPrefix}/${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(method === 'POST' ? {'Content-Type': 'application/json'} : {}),
    },
    ...(method === 'POST' && postBody !== undefined ? {body: JSON.stringify(postBody)} : {}),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

function userSetJiraRestPathPrefixLocal(env: NodeJS.ProcessEnv | undefined): boolean {
  return Boolean((env ?? process.env).JIRA_REST_PATH_PREFIX?.trim());
}

function defaultSubmitTestTransitionNames(): string[] {
  return ['提测', '提交测试', '待测试', 'Ready for QA', 'Submit for QA'];
}

function parseTransitionNamesFromEnv(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return defaultSubmitTestTransitionNames();
  return s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function pickSubmitTestTransition(
  transitions: JiraTransitionOption[],
  names: string[]
): JiraTransitionOption | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  const nameSet = new Set(names.map(norm));
  for (const t of transitions) {
    const n = norm(t.name);
    if (nameSet.has(n)) return t;
  }
  for (const want of names) {
    const w = want.trim().toLowerCase();
    if (w.length < 2) continue;
    for (const t of transitions) {
      if (norm(t.name).includes(w)) return t;
    }
  }
  return undefined;
}

/**
 * 对工单执行「提测」类工作流过渡。
 * - 若设置 `JIRA_SUBMIT_TEST_TRANSITION_ID`，直接使用该过渡 id；
 * - 否则 GET 可用过渡，按 `JIRA_SUBMIT_TEST_TRANSITION_NAMES`（逗号分隔，默认含「提测」等）匹配名称。
 */
export async function jiraSubmitTestTransition(options: {
  issueKey: string;
  env?: NodeJS.ProcessEnv;
  logContext?: string;
}): Promise<JiraSubmitTestResult & { authError?: string }> {
  const logCtx = options.logContext?.trim();
  const issueKey = options.issueKey.trim().toUpperCase();
  if (!issueKey) {
    return { ok: false, error: '缺少工单号' };
  }

  const cfg = resolveJiraAuth(options.env);
  if (cfg.ok === false) {
    return { ok: false, error: cfg.reason, authError: cfg.reason };
  }

  const env = options.env ?? process.env;
  const explicitId = (env.JIRA_SUBMIT_TEST_TRANSITION_ID ?? '').trim();
  const candidateNames = parseTransitionNamesFromEnv(env.JIRA_SUBMIT_TEST_TRANSITION_NAMES);

  const runWithPrefix = async (apiPrefix: string) => {
    let res = await jiraIssueTransitionsRequest(
      cfg.baseUrl,
      apiPrefix,
      cfg.authHeader,
      issueKey,
      'GET'
    );
    return { res, apiPrefix };
  };

  let { res, apiPrefix } = await runWithPrefix(cfg.apiPrefix);
  if (
    !res.ok &&
    (res.status === 404 || res.status === 410) &&
    !userSetJiraRestPathPrefixLocal(env) &&
    cfg.apiPrefix === 'rest/api/3'
  ) {
    if (logCtx) {
      console.warn('[jiraSubmitTestTransition]', logCtx, 'GET transitions 失败，改用 rest/api/2', {
        httpStatus: res.status,
      });
    }
    const retry = await runWithPrefix('rest/api/2');
    res = retry.res;
    apiPrefix = retry.apiPrefix;
  }

  let transitions: JiraTransitionOption[] = [];
  if (res.ok) {
    try {
      const data = JSON.parse(res.text) as {transitions?: {id?: string; name?: string}[]};
      const rawList = Array.isArray(data.transitions) ? data.transitions : [];
      transitions = rawList
        .map((t) => ({
          id: String(t.id ?? '').trim(),
          name: String(t.name ?? '').trim(),
        }))
        .filter((t) => t.id);
    } catch {
      return {ok: false, error: '无法解析 Jira transitions 响应'};
    }
  } else {
    const detail = jiraSearchErrorDetail(res.status, res.text);
    return {ok: false, error: `无法读取可用过渡（HTTP ${res.status}）：${detail}`};
  }

  let chosen: JiraTransitionOption | undefined;
  if (explicitId) {
    chosen = transitions.find((t) => t.id === explicitId);
    if (!chosen) {
      return {
        ok: false,
        error: `环境变量 JIRA_SUBMIT_TEST_TRANSITION_ID=${explicitId} 不在当前工单的可用过渡列表中`,
        availableTransitions: transitions,
      };
    }
  } else {
    chosen = pickSubmitTestTransition(transitions, candidateNames);
    if (!chosen) {
      return {
        ok: false,
        error: `未找到与「${candidateNames.join(' / ')}」匹配的过渡，请设置 JIRA_SUBMIT_TEST_TRANSITION_ID 或调整 JIRA_SUBMIT_TEST_TRANSITION_NAMES`,
        availableTransitions: transitions,
      };
    }
  }

  const postBody = {transition: {id: chosen.id}};
  let postRes = await jiraIssueTransitionsRequest(
    cfg.baseUrl,
    apiPrefix,
    cfg.authHeader,
    issueKey,
    'POST',
    postBody
  );

  if (
    !postRes.ok &&
    (postRes.status === 404 || postRes.status === 410) &&
    !userSetJiraRestPathPrefixLocal(env) &&
    apiPrefix === 'rest/api/3'
  ) {
    postRes = await jiraIssueTransitionsRequest(
      cfg.baseUrl,
      'rest/api/2',
      cfg.authHeader,
      issueKey,
      'POST',
      postBody
    );
    apiPrefix = 'rest/api/2';
  }

  if (!postRes.ok) {
    const detail = jiraSearchErrorDetail(postRes.status, postRes.text);
    return {
      ok: false,
      error: `执行过渡失败（HTTP ${postRes.status}）：${detail}`,
      availableTransitions: transitions,
    };
  }

  return {ok: true, transitionId: chosen.id, transitionName: chosen.name};
}
