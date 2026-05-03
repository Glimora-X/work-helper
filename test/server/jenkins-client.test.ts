import test from 'node:test';
import assert from 'node:assert/strict';
import { triggerJenkinsJob } from '../../server/jenkins-client';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain', ...(init.headers || {}) },
    ...init,
  });
}

function withMockedFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

test('triggerJenkinsJob sends crumb, branch and jira parameters to buildWithParameters', async () => {
  const calls = withMockedFetch((url) => {
    if (url.endsWith('/crumbIssuer/api/json')) {
      return jsonResponse({ crumbRequestField: 'Jenkins-Crumb', crumb: 'abc123' });
    }
    return textResponse('', {
      status: 201,
      headers: { location: 'https://jenkins.example.test/queue/item/7/' },
    });
  });

  const result = await triggerJenkinsJob({
    jenkinsBaseUrl: 'https://jenkins.example.test/',
    user: 'alice',
    token: 'secret-token',
    jobSegments: ['folder name', 'deploy app'],
    parameters: { BRANCH_NAME: 'feature/a b', JIRA_ID: 'ABC-123' },
    pollQueue: false,
    pollTimeoutMs: 1000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.queueUrl, 'https://jenkins.example.test/queue/item/7/');
  assert.equal(calls[1].url, 'https://jenkins.example.test/job/folder%20name/job/deploy%20app/buildWithParameters?BRANCH_NAME=feature%2Fa+b&JIRA_ID=ABC-123');
  assert.equal(calls[1].init?.method, 'POST');
  assert.equal((calls[1].init?.headers as Record<string, string>)['Jenkins-Crumb'], 'abc123');
  assert.match((calls[1].init?.headers as Record<string, string>).Authorization, /^Basic /);
});

test('triggerJenkinsJob polls queue location until Jenkins exposes a build URL', async () => {
  const calls = withMockedFetch((url) => {
    if (url.endsWith('/crumbIssuer/api/json')) {
      return textResponse('', { status: 404 });
    }
    if (url.endsWith('/buildWithParameters?BRANCH_NAME=main')) {
      return textResponse('', {
        status: 201,
        headers: { location: '/queue/item/9/' },
      });
    }
    if (url.endsWith('/queue/item/9/api/json')) {
      return jsonResponse({
        executable: {
          number: 42,
          url: 'https://jenkins.example.test/job/deploy/42/',
        },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });

  const result = await triggerJenkinsJob({
    jenkinsBaseUrl: 'https://jenkins.example.test',
    user: 'alice',
    token: 'secret-token',
    jobSegments: ['deploy'],
    parameters: { BRANCH_NAME: 'main' },
    pollQueue: true,
    pollTimeoutMs: 1000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.queueUrl, '/queue/item/9/');
  assert.equal(result.buildNumber, 42);
  assert.equal(result.buildUrl, 'https://jenkins.example.test/job/deploy/42/');
  assert.equal(calls.length, 3);
});

test('triggerJenkinsJob reports queued timeout without claiming a build started', async () => {
  withMockedFetch((url) => {
    if (url.endsWith('/crumbIssuer/api/json')) {
      return textResponse('', { status: 404 });
    }
    if (url.endsWith('/buildWithParameters?BRANCH_NAME=main')) {
      return textResponse('', {
        status: 201,
        headers: { location: '/queue/item/10/' },
      });
    }
    return jsonResponse({});
  });

  const result = await triggerJenkinsJob({
    jenkinsBaseUrl: 'https://jenkins.example.test',
    user: 'alice',
    token: 'secret-token',
    jobSegments: ['deploy'],
    parameters: { BRANCH_NAME: 'main' },
    pollQueue: true,
    pollTimeoutMs: 1,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.queueUrl, '/queue/item/10/');
  assert.equal(result.buildUrl, undefined);
  assert.equal(result.buildNumber, undefined);
  assert.match(result.message || '', /queued/i);
  assert.doesNotMatch(result.message || '', /started/i);
});

test('triggerJenkinsJob sanitizes Jenkins HTML login and permission errors', async () => {
  withMockedFetch((url) => {
    if (url.endsWith('/crumbIssuer/api/json')) {
      return textResponse('', { status: 403 });
    }
    return textResponse('<html><body><form>login</form><script>secret</script></body></html>', {
      status: 403,
      headers: { 'content-type': 'text/html' },
    });
  });

  const result = await triggerJenkinsJob({
    jenkinsBaseUrl: 'https://jenkins.example.test',
    user: 'alice',
    token: 'secret-token',
    jobSegments: ['deploy'],
    parameters: { BRANCH_NAME: 'main' },
    pollQueue: false,
    pollTimeoutMs: 1000,
  });

  assert.match(result.error || '', /authentication|permission|Jenkins HTTP 403/i);
  assert.doesNotMatch(result.error || '', /<html|<script|secret-token/i);
});
