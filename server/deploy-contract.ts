export class DeployContractError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export interface JenkinsRuntimeConfig {
  jenkinsUrl: string;
  user: string;
  token: string;
}

export interface JenkinsCredentials {
  user: string;
  token: string;
}

export type JenkinsConfigResult =
  | { ok: true; config: JenkinsRuntimeConfig }
  | { ok: false; status: 503; error: string; missing: string[] };

export type JenkinsCredentialsResult =
  | { ok: true; credentials: JenkinsCredentials }
  | { ok: false; status: 503; error: string; missing: string[] };

function envValue(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): string {
  return (env[key] || '').trim();
}

export function getJenkinsConfigFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): JenkinsConfigResult {
  const jenkinsUrl = envValue(env, 'JENKINS_URL').replace(/\/$/, '');
  const user = envValue(env, 'JENKINS_USER') || envValue(env, 'JENKINS_USERNAME');
  const token = envValue(env, 'JENKINS_TOKEN');
  const missing = [
    ['JENKINS_URL', jenkinsUrl],
    ['JENKINS_USER', user],
    ['JENKINS_TOKEN', token],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    return {
      ok: false,
      status: 503,
      missing,
      error: `Jenkins deployment is not configured. Missing: ${missing.join(', ')}.`,
    };
  }

  return { ok: true, config: { jenkinsUrl, user, token } };
}

export function getJenkinsCredentialsFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): JenkinsCredentialsResult {
  const user = envValue(env, 'JENKINS_USER') || envValue(env, 'JENKINS_USERNAME');
  const token = envValue(env, 'JENKINS_TOKEN');
  const missing = [
    ['JENKINS_USER', user],
    ['JENKINS_TOKEN', token],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    return {
      ok: false,
      status: 503,
      missing,
      error: `Jenkins deployment credentials are not configured. Missing: ${missing.join(', ')}.`,
    };
  }

  return { ok: true, credentials: { user, token } };
}

function validateParamName(name: string, label: string): string {
  const value = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
    throw new DeployContractError(`Invalid Jenkins ${label} parameter name`, 500);
  }
  return value;
}

export function buildDeployParameters(
  input: { jiraId?: unknown; branch?: unknown },
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Record<string, string> {
  const paramJira = validateParamName(envValue(env, 'JENKINS_PARAM_JIRA') || 'JIRA_ID', 'Jira');
  const paramBranch = validateParamName(
    envValue(env, 'JENKINS_PARAM_BRANCH') || 'BRANCH_NAME',
    'branch'
  );

  const parameters: Record<string, string> = {};

  if (typeof input.jiraId === 'string' && input.jiraId.trim()) {
    const jiraId = input.jiraId.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(jiraId)) {
      throw new DeployContractError('Invalid Jira issue key');
    }
    parameters[paramJira] = jiraId;
  }

  if (typeof input.branch === 'string' && input.branch.trim()) {
    const branch = input.branch.trim();
    if (/[\u0000-\u001f\u007f]/.test(branch)) {
      throw new DeployContractError('Invalid branch name');
    }
    parameters[paramBranch] = branch;
  }

  return parameters;
}

function parseOneJobPath(value: string | string[]): string[] {
  const segments = Array.isArray(value)
    ? value.map((s) => String(s).trim()).filter(Boolean)
    : value
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);

  if (segments.length === 0) return [];

  if (
    segments.some((segment) => /^https?:$/i.test(segment)) ||
    (typeof value === 'string' && /^https?:\/\//i.test(value))
  ) {
    throw new DeployContractError('Provide Jenkins job path segments, not a full Jenkins URL');
  }

  for (const segment of segments) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0') ||
      /[\u0000-\u001f\u007f]/.test(segment)
    ) {
      throw new DeployContractError(`Unsafe Jenkins job path segment: ${segment}`);
    }
  }

  return segments;
}

export function parseJobPathGroups(body: {
  jobPath?: string | string[];
  jobPaths?: (string | string[])[];
}): string[][] {
  if (Array.isArray(body.jobPaths)) {
    const groups = body.jobPaths.map(parseOneJobPath).filter((segments) => segments.length > 0);
    if (groups.length > 0) return groups;
  }

  if (body.jobPath != null) {
    const segments = parseOneJobPath(body.jobPath);
    if (segments.length > 0) return [segments];
  }

  return [];
}
