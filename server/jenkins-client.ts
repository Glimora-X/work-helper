/**
 * Server-side Jenkins REST helpers (avoids browser CORS; keeps credentials off the client).
 */

export interface JenkinsTriggerResult {
  simulated: boolean;
  message?: string;
  queueUrl?: string;
  buildUrl?: string;
  buildNumber?: number;
  error?: string;
}

function buildJobBaseUrl(jenkinsBase: string, jobSegments: string[]): string {
  const base = jenkinsBase.replace(/\/$/, '');
  const encoded = jobSegments.map((s) => encodeURIComponent(s)).join('/job/');
  return `${base}/job/${encoded}`;
}

function basicAuthHeader(user: string, token: string): string {
  return 'Basic ' + Buffer.from(`${user}:${token}`, 'utf8').toString('base64');
}

async function fetchJenkinsCrumb(
  jenkinsBase: string,
  authHeader: string
): Promise<{ field: string; crumb: string } | null> {
  const url = `${jenkinsBase.replace(/\/$/, '')}/crumbIssuer/api/json`;
  const resp = await fetch(url, { headers: { Authorization: authHeader } });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { crumb?: string; crumbRequestField?: string };
  if (!data.crumb) return null;
  return { field: data.crumbRequestField || 'Jenkins-Crumb', crumb: data.crumb };
}

async function pollQueueUntilBuild(
  queueUrl: string,
  authHeader: string,
  timeoutMs: number
): Promise<{ buildNumber: number; buildUrl: string } | null> {
  const start = Date.now();
  const api = queueUrl.endsWith('/') ? `${queueUrl}api/json` : `${queueUrl}/api/json`;
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(api, { headers: { Authorization: authHeader } });
    if (!resp.ok) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    const json = (await resp.json()) as {
      executable?: { number?: number; url?: string };
      cancelled?: boolean;
    };
    if (json.cancelled) return null;
    if (json.executable?.number != null && json.executable.url) {
      return { buildNumber: json.executable.number, buildUrl: json.executable.url };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export async function triggerJenkinsJob(options: {
  jenkinsBaseUrl: string;
  user: string;
  token: string;
  jobSegments: string[];
  parameters: Record<string, string>;
  pollQueue: boolean;
  pollTimeoutMs: number;
}): Promise<JenkinsTriggerResult> {
  const { jenkinsBaseUrl, user, token, jobSegments, parameters, pollQueue, pollTimeoutMs } = options;
  const auth = basicAuthHeader(user, token);
  const jobBase = buildJobBaseUrl(jenkinsBaseUrl, jobSegments);
  const hasParams = Object.keys(parameters).length > 0;
  const endpoint = hasParams ? 'buildWithParameters' : 'build';
  const qs = hasParams ? '?' + new URLSearchParams(parameters).toString() : '';
  const url = `${jobBase}/${endpoint}${qs}`;

  const crumb = await fetchJenkinsCrumb(jenkinsBaseUrl, auth);
  const headers: Record<string, string> = {
    Authorization: auth,
    ...(crumb ? { [crumb.field]: crumb.crumb } : {}),
  };

  const resp = await fetch(url, { method: 'POST', headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      simulated: false,
      error: `Jenkins HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
    };
  }

  const location = resp.headers.get('location');
  let buildUrl: string | undefined;
  let buildNumber: number | undefined;

  if (pollQueue && location) {
    const base = jenkinsBaseUrl.endsWith('/') ? jenkinsBaseUrl : `${jenkinsBaseUrl}/`;
    const absolute = new URL(location, base).href;
    const built = await pollQueueUntilBuild(absolute, auth, pollTimeoutMs);
    if (built) {
      buildUrl = built.buildUrl;
      buildNumber = built.buildNumber;
    }
  }

  return {
    simulated: false,
    queueUrl: location || undefined,
    buildUrl,
    buildNumber,
    message: buildNumber != null ? `Build #${buildNumber} started.` : 'Job queued.',
  };
}
