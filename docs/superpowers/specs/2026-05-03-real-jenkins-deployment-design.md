# Real Jenkins Deployment Design

## Goal

Make the deployment module production usable by triggering real Jenkins jobs and reporting status from Jenkins queue/build data instead of local simulated progress.

## Scope

The deployment surface remains the existing React page plus Express BFF. The browser never receives Jenkins credentials. Missing Jenkins configuration is a blocking server error, not a client-side simulation path. Jira resolution may still fall back to configured fallback nodes because it is an input helper, not the deployment authority.

## Backend Contract

`POST /api/deploy/jenkins/trigger` accepts one deploy project id or an ordered list of project ids. `config/deploy-projects.json` maps those ids to Jenkins base URLs, job paths, default branches, and parameter names. The server builds Jenkins parameters from configured names: Jira defaults to `JIRA_ID`; branch defaults to `BRANCH_NAME` to match the Jenkins trigger skill contract.

The endpoint requires `JENKINS_URL`, `JENKINS_USER`, and `JENKINS_TOKEN`. If any are missing, it returns `503` with a setup-oriented message. It does not return `simulated: true`.

Jenkins triggering uses Basic auth, optional crumb discovery, and `buildWithParameters` when parameters exist. HTTP 200, 201, and 201/202 queue responses are accepted. A successful trigger should include the Jenkins queue URL when Jenkins returns `Location`. If queue polling is requested, the BFF polls the queue API until Jenkins exposes `executable.number` and `executable.url`, or until timeout. Timeout returns a queued result, not a completed build result.

Branch resolution priority is: explicit user branch, Jira rule for the project, Jira generic rule, project default branch, then global default `pretest`.

## Error Handling

Credentials are never logged or returned. HTML login, permission, or proxy pages are collapsed into an authentication/permission message. Raw response bodies are trimmed and sanitized. A failed node stops later nodes and returns the node path that failed.

## Frontend Behavior

The deployment page reads `/api/deploy/health` and surfaces Jenkins/Jira readiness. The deploy button is disabled when Jenkins is not configured. During execution each node shows the queue URL and, when available, build number and build URL. A node is not marked successful because of local timers. If Jenkins accepted the queue item but no build URL is available before timeout, the node is marked as queued/unknown instead of deployed.

## Testing

Use Node's built-in test runner with `tsx` for TypeScript tests. Add tests around the Jenkins client and BFF request parsing/response behavior, then run `npm test`, `npm run lint`, and `npm run build`.
