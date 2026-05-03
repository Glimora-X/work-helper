import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeployParameters,
  getJenkinsConfigFromEnv,
  getJenkinsCredentialsFromEnv,
  parseJobPathGroups,
} from '../../server/deploy-contract';

test('getJenkinsConfigFromEnv blocks deployment when Jenkins credentials are incomplete', () => {
  const result = getJenkinsConfigFromEnv({
    JENKINS_URL: 'https://jenkins.example.test',
    JENKINS_USER: 'alice',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /JENKINS_TOKEN/);
});

test('getJenkinsCredentialsFromEnv only requires user and token for JSON project mapping', () => {
  const result = getJenkinsCredentialsFromEnv({
    JENKINS_USER: 'alice',
    JENKINS_TOKEN: 'secret-token',
  });

  assert.deepEqual(result, {
    ok: true,
    credentials: {
      user: 'alice',
      token: 'secret-token',
    },
  });
});

test('buildDeployParameters defaults branch parameter to BRANCH_NAME', () => {
  const params = buildDeployParameters(
    { jiraId: 'abc-123', branch: 'feature/demo' },
    {}
  );

  assert.deepEqual(params, {
    JIRA_ID: 'ABC-123',
    BRANCH_NAME: 'feature/demo',
  });
});

test('parseJobPathGroups accepts ordered path groups and rejects unsafe segments', () => {
  assert.deepEqual(parseJobPathGroups({ jobPath: 'folder/deploy-app' }), [
    ['folder', 'deploy-app'],
  ]);
  assert.deepEqual(parseJobPathGroups({ jobPaths: ['a/b', ['c', 'd']] }), [
    ['a', 'b'],
    ['c', 'd'],
  ]);

  assert.throws(
    () => parseJobPathGroups({ jobPath: '../deploy' }),
    /unsafe Jenkins job path/i
  );
  assert.throws(
    () => parseJobPathGroups({ jobPath: 'https://jenkins.example.test/job/deploy' }),
    /job path segments/i
  );
});
