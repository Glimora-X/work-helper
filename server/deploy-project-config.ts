import fs from 'node:fs';
import path from 'node:path';
import { DeployContractError } from './deploy-contract';

interface RawDeployProject {
  label?: unknown;
  jenkinsBaseUrl?: unknown;
  jobPath?: unknown;
  defaultBranch?: unknown;
}

interface RawJiraBranchRule {
  pattern?: unknown;
  branch?: unknown;
  projectBranches?: unknown;
}

export interface DeployProject {
  id: string;
  label: string;
  jenkinsBaseUrl: string;
  jobPath: string;
  defaultBranch?: string;
}

export interface JiraBranchRule {
  pattern: string;
  branch?: string;
  projectBranches: Record<string, string>;
}

export interface DeployProjectConfig {
  defaults: {
    branch: string;
    jenkinsBaseUrl?: string;
    jiraParamName: string;
    branchParamName: string;
  };
  projects: Record<string, DeployProject>;
  jiraBranchRules: JiraBranchRule[];
}

export interface DeployProjectOption {
  id: string;
  label: string;
  defaultBranch: string;
}

export interface ResolvedDeployTarget {
  projectId: string;
  label: string;
  jenkinsBaseUrl: string;
  jobSegments: string[];
  branch: string;
  jiraParamName: string;
  branchParamName: string;
}

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config/deploy-projects.json');

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateProjectId(id: string): string {
  const value = id.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new DeployContractError(`Invalid deploy project id: ${id}`);
  }
  return value;
}

function validateJobPath(jobPath: string, projectId: string): string {
  const segments = jobPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    throw new DeployContractError(`Project ${projectId} must define jobPath`);
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment)) {
      throw new DeployContractError(`Project ${projectId} has unsafe Jenkins jobPath`);
    }
  }
  return segments.join('/');
}

function validateParamName(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
    throw new DeployContractError(`Invalid ${label} parameter name in deploy project config`, 500);
  }
  return value;
}

export function validateDeployProjectConfig(raw: unknown): DeployProjectConfig {
  if (!raw || typeof raw !== 'object') {
    throw new DeployContractError('Deploy project config must be a JSON object', 500);
  }
  const source = raw as {
    defaults?: Record<string, unknown>;
    projects?: Record<string, RawDeployProject>;
    jiraBranchRules?: RawJiraBranchRule[];
  };

  const defaults = source.defaults || {};
  const defaultBranch = asString(defaults.branch) || 'pretest';
  const defaultJenkinsBaseUrl = asString(defaults.jenkinsBaseUrl)?.replace(/\/$/, '');
  const jiraParamName = validateParamName(asString(defaults.jiraParamName) || 'JIRA_ID', 'Jira');
  const branchParamName = validateParamName(
    asString(defaults.branchParamName) || 'BRANCH_NAME',
    'branch'
  );

  if (!source.projects || typeof source.projects !== 'object') {
    throw new DeployContractError('Deploy project config must define projects', 500);
  }

  const projects: Record<string, DeployProject> = {};
  for (const [rawId, project] of Object.entries(source.projects)) {
    const id = validateProjectId(rawId);
    const jobPath = asString(project.jobPath);
    if (!jobPath) {
      throw new DeployContractError(`Project ${id} must define jobPath`, 500);
    }
    const jenkinsBaseUrl = (asString(project.jenkinsBaseUrl) || defaultJenkinsBaseUrl)?.replace(
      /\/$/,
      ''
    );
    if (!jenkinsBaseUrl) {
      throw new DeployContractError(`Project ${id} must define jenkinsBaseUrl`, 500);
    }
    projects[id] = {
      id,
      label: asString(project.label) || id,
      jenkinsBaseUrl,
      jobPath: validateJobPath(jobPath, id),
      defaultBranch: asString(project.defaultBranch),
    };
  }

  const jiraBranchRules = Array.isArray(source.jiraBranchRules)
    ? source.jiraBranchRules.map((rule) => {
        const pattern = asString(rule.pattern);
        if (!pattern) {
          throw new DeployContractError('Jira branch rule must define pattern', 500);
        }
        new RegExp(pattern);
        const projectBranches: Record<string, string> = {};
        if (rule.projectBranches && typeof rule.projectBranches === 'object') {
          for (const [projectId, branch] of Object.entries(rule.projectBranches)) {
            const value = asString(branch);
            if (value) projectBranches[validateProjectId(projectId)] = value;
          }
        }
        return {
          pattern,
          branch: asString(rule.branch),
          projectBranches,
        };
      })
    : [];

  return {
    defaults: {
      branch: defaultBranch,
      jenkinsBaseUrl: defaultJenkinsBaseUrl,
      jiraParamName,
      branchParamName,
    },
    projects,
    jiraBranchRules,
  };
}

export function loadDeployProjectConfig(configPath = process.env.DEPLOY_PROJECT_CONFIG_PATH): DeployProjectConfig {
  const filePath = path.resolve(configPath || DEFAULT_CONFIG_PATH);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return validateDeployProjectConfig(raw);
}

export function listDeployProjects(config: DeployProjectConfig): DeployProjectOption[] {
  return Object.values(config.projects)
    .map((project) => ({
      id: project.id,
      label: project.label,
      defaultBranch: project.defaultBranch || config.defaults.branch,
    }));
}

function chooseBranch(
  config: DeployProjectConfig,
  project: DeployProject,
  jiraId?: string,
  explicitBranch?: string
): string {
  if (explicitBranch?.trim()) return explicitBranch.trim();

  if (jiraId?.trim()) {
    const normalizedJiraId = jiraId.trim().toUpperCase();
    for (const rule of config.jiraBranchRules) {
      if (!new RegExp(rule.pattern).test(normalizedJiraId)) continue;
      const projectBranch = rule.projectBranches[project.id];
      if (projectBranch) return projectBranch;
      if (rule.branch) return rule.branch;
    }
  }

  return project.defaultBranch || config.defaults.branch || 'pretest';
}

export function resolveDeployTargets(
  config: DeployProjectConfig,
  input: { projectIds: string[]; jiraId?: string; explicitBranch?: string }
): ResolvedDeployTarget[] {
  if (!input.projectIds.length) {
    throw new DeployContractError('projectId or projectIds required');
  }

  return input.projectIds.map((rawProjectId) => {
    const projectId = validateProjectId(rawProjectId);
    const project = config.projects[projectId];
    if (!project) {
      throw new DeployContractError(`Unknown deploy project: ${projectId}`);
    }
    return {
      projectId,
      label: project.label,
      jenkinsBaseUrl: project.jenkinsBaseUrl,
      jobSegments: project.jobPath.split('/').filter(Boolean),
      branch: chooseBranch(config, project, input.jiraId, input.explicitBranch),
      jiraParamName: config.defaults.jiraParamName,
      branchParamName: config.defaults.branchParamName,
    };
  });
}
