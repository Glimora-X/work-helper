import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveJiraAuth } from '../../server/jira-rest';

test('resolveJiraAuth normalizes stray quotes on username and password', () => {
  const r = resolveJiraAuth({
    JIRA_SERVER_URL: 'https://jira.example.com',
    JIRA_USERNAME: '"alice",',
    JIRA_PASSWORD: 'p@ss",',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  if (r.ok) {
    const decoded = Buffer.from(r.authHeader.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
    assert.equal(decoded, 'alice:p@ss');
  }
});

test('resolveJiraAuth accepts JIRA_USERNAME + JIRA_API_TOKEN without password', () => {
  const r = resolveJiraAuth({
    JIRA_SERVER_URL: 'https://jira.example.com',
    JIRA_USERNAME: 'bob',
    JIRA_API_TOKEN: 'tok123',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  if (r.ok) {
    const decoded = Buffer.from(r.authHeader.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
    assert.equal(decoded, 'bob:tok123');
  }
});
