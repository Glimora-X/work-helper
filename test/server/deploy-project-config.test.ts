import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDeployProjects,
  resolveDeployTargets,
  validateDeployProjectConfig,
} from '../../server/deploy-project-config';

const config = validateDeployProjectConfig({
  defaults: {
    branch: 'pretest',
    jenkinsBaseUrl: 'https://jenkins-default.example.test',
    jiraParamName: 'JIRA_ID',
    branchParamName: 'BRANCH_NAME',
  },
  projects: {
    'cc-web': {
      label: '前端主站',
      jobPath: 'frontend/cc-web',
    },
    'biz-core': {
      label: '业务核心',
      jenkinsBaseUrl: 'https://jenkins-backend.example.test',
      jobPath: 'backend/biz-core',
      defaultBranch: 'pretest-core',
    },
  },
  jiraBranchRules: [
    {
      pattern: '^PAY-\\d+$',
      projectBranches: {
        'cc-web': 'feature/pay-web',
        'biz-core': 'feature/pay-core',
      },
    },
    {
      pattern: '^OPS-\\d+$',
      branch: 'release/ops-pretest',
    },
  ],
});

test('listDeployProjects returns browser-safe project metadata only', () => {
  assert.deepEqual(listDeployProjects(config), [
    { id: 'cc-web', label: '前端主站', defaultBranch: 'pretest' },
    { id: 'biz-core', label: '业务核心', defaultBranch: 'pretest-core' },
  ]);
});

test('resolveDeployTargets uses explicit branch for every project when provided', () => {
  const targets = resolveDeployTargets(config, {
    projectIds: ['cc-web', 'biz-core'],
    jiraId: 'PAY-123',
    explicitBranch: 'hotfix/manual',
  });

  assert.deepEqual(
    targets.map((target) => ({
      projectId: target.projectId,
      branch: target.branch,
      jenkinsBaseUrl: target.jenkinsBaseUrl,
      jobSegments: target.jobSegments,
    })),
    [
      {
        projectId: 'cc-web',
        branch: 'hotfix/manual',
        jenkinsBaseUrl: 'https://jenkins-default.example.test',
        jobSegments: ['frontend', 'cc-web'],
      },
      {
        projectId: 'biz-core',
        branch: 'hotfix/manual',
        jenkinsBaseUrl: 'https://jenkins-backend.example.test',
        jobSegments: ['backend', 'biz-core'],
      },
    ]
  );
});

test('resolveDeployTargets can choose different branches for each project from one Jira key', () => {
  const targets = resolveDeployTargets(config, {
    projectIds: ['cc-web', 'biz-core'],
    jiraId: 'PAY-123',
  });

  assert.deepEqual(
    targets.map((target) => [target.projectId, target.branch]),
    [
      ['cc-web', 'feature/pay-web'],
      ['biz-core', 'feature/pay-core'],
    ]
  );
});

test('resolveDeployTargets falls back to generic Jira branch, project default, then pretest', () => {
  assert.equal(
    resolveDeployTargets(config, { projectIds: ['cc-web'], jiraId: 'OPS-7' })[0].branch,
    'release/ops-pretest'
  );
  assert.equal(resolveDeployTargets(config, { projectIds: ['biz-core'] })[0].branch, 'pretest-core');
  assert.equal(resolveDeployTargets(config, { projectIds: ['cc-web'] })[0].branch, 'pretest');
});

test('validateDeployProjectConfig rejects projects without a Jenkins base URL', () => {
  assert.throws(
    () =>
      validateDeployProjectConfig({
        defaults: { branch: 'pretest' },
        projects: {
          missing: { jobPath: 'missing' },
        },
      }),
    /jenkinsBaseUrl/i
  );
});
