# Real Jenkins Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployment module trigger real Jenkins jobs and report Jenkins queue/build URLs as the source of truth.

**Architecture:** Keep Jenkins HTTP behavior in `server/jenkins-client.ts`, keep Express request/response contract in `server/deploy-api.ts`, and keep UI orchestration in `src/pages/Deployment.tsx`. Tests run through Node's built-in test runner with `tsx` so the project does not need a new test dependency.

**Tech Stack:** React 19, TypeScript, Express, Node `node:test`, `tsx`, Jenkins REST API.

---

## File Structure

- Modify `server/jenkins-client.ts`: normalize Jenkins responses, queue polling, sanitized errors, and accepted status codes.
- Modify `server/deploy-api.ts`: strict config behavior, request validation, production response contract.
- Modify `src/pages/Deployment.tsx`: health check, real Jenkins states, queue/build URL display, no simulation success.
- Modify `.env.example`: default branch parameter to `BRANCH_NAME` and document strict Jenkins requirement.
- Modify `package.json`: add `test` script using `tsx --test`.
- Create `test/server/jenkins-client.test.ts`: Jenkins client behavior tests with mocked fetch.
- Create `test/server/deploy-contract.test.ts`: pure request parsing/contract helper tests if needed.

## Tasks

### Task 1: Jenkins Client Tests

- [ ] Write failing tests in `test/server/jenkins-client.test.ts` for crumb fetch, `buildWithParameters`, queue URL handling, build URL polling, HTML error sanitization, and queue timeout.
- [ ] Run `npm test -- test/server/jenkins-client.test.ts` and confirm the tests fail for missing behavior.
- [ ] Implement the minimal Jenkins client changes in `server/jenkins-client.ts`.
- [ ] Run `npm test -- test/server/jenkins-client.test.ts` and confirm the tests pass.

### Task 2: Deploy API Contract

- [ ] Extract small exported helpers from `server/deploy-api.ts` for job path parsing, Jenkins config detection, and deploy parameter construction.
- [ ] Write failing tests for missing Jenkins config returning a blocking status model and branch parameter defaulting to `BRANCH_NAME`.
- [ ] Implement strict no-simulation behavior in `/api/deploy/jenkins/trigger`.
- [ ] Run focused API/helper tests.

### Task 3: Frontend Deployment Page

- [ ] Update `src/pages/Deployment.tsx` to fetch health, disable execution when Jenkins is unconfigured, remove simulated success logs, and show queue/build URLs from the API response.
- [ ] Keep existing DAG editing behavior intact.
- [ ] Run `npm run lint` to catch TypeScript issues.

### Task 4: Documentation And Verification

- [ ] Update `.env.example` with `JENKINS_PARAM_BRANCH="BRANCH_NAME"` and strict deployment notes.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
