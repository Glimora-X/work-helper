# Development Environment Management

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [vite.config.ts](file://vite.config.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [scripts/build-electron.mjs](file://scripts/build-electron.mjs)
- [electron/main.ts](file://electron/main.ts)
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [config/deploy-projects.json](file://config/deploy-projects.json)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the development environment management services of the project, focusing on:
- Startup orchestration: IDE launching, Git synchronization, dependency management, and development server launching
- Smart installation logic that optimizes dependency resolution based on file changes
- Development server launching with both terminal-based and streaming output modes
- Process management including child process spawning, signal handling, and graceful shutdown
- Examples of project configuration, automation task scheduling, and error recovery mechanisms
- Integration with development workflows and IDE integration patterns

## Project Structure
The development environment spans three layers:
- Frontend (React SPA) for user-driven orchestration and real-time logs
- Backend (Express) for startup orchestration, automation scheduling, and Jenkins integration
- Desktop (Electron) for packaging and launching the development stack

```mermaid
graph TB
subgraph "Frontend"
UI_Startup["Startup Page<br/>src/pages/Startup.tsx"]
UI_Automation["Automations Page<br/>src/pages/Automations.tsx"]
end
subgraph "Backend"
API_Startup["Startup Orchestration<br/>server/deploy-api.ts"]
API_Pipeline["Deploy Pipeline Orchestrator<br/>server/deploy-pipeline.ts"]
API_Config["Project Config Loader<br/>server/deploy-project-config.ts"]
API_Contract["Deployment Contract Helpers<br/>server/deploy-contract.ts"]
API_Jenkins["Jenkins Client<br/>server/jenkins-client.ts"]
Proxy_Plugin["Vite Dynamic Proxy Plugin<br/>vite.deploy-api-proxy-plugin.ts"]
end
subgraph "Desktop"
Electron_Main["Electron Main Process<br/>electron/main.ts"]
Build_Electron["Electron Build Script<br/>scripts/build-electron.mjs"]
end
UI_Startup --> API_Startup
UI_Automation --> API_Startup
API_Startup --> API_Pipeline
API_Startup --> API_Config
API_Pipeline --> API_Jenkins
API_Config --> API_Contract
Proxy_Plugin --> API_Startup
Electron_Main --> API_Startup
Build_Electron --> Electron_Main
```

**Diagram sources**
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [electron/main.ts](file://electron/main.ts)
- [scripts/build-electron.mjs](file://scripts/build-electron.mjs)

**Section sources**
- [package.json](file://package.json)
- [vite.config.ts](file://vite.config.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [scripts/build-electron.mjs](file://scripts/build-electron.mjs)
- [electron/main.ts](file://electron/main.ts)
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [config/deploy-projects.json](file://config/deploy-projects.json)

## Core Components
- Startup orchestration service: coordinates IDE launching, Git synchronization, dependency installation, and development server launching with optional terminal mode
- Automation scheduler: manages scheduled runs, streaming logs, and manual intervention
- Jenkins integration: triggers jobs and polls builds with robust error handling
- Project configuration: validates and resolves deployment targets from a JSON configuration
- Electron packaging: bundles backend and frontend assets into a desktop app with child process lifecycle management
- Vite dynamic proxy: routes API requests to the backend with runtime port discovery

**Section sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [electron/main.ts](file://electron/main.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)

## Architecture Overview
The system orchestrates a development session in four stages:
1. IDE launching: spawns IDE processes per project
2. Git synchronization: fetches, checks out, and fast-forwards branches
3. Dependency management: resolves whether to install based on dependency file fingerprints and presence of node_modules
4. Development server launching: runs commands either in a real TTY (Terminal.app) or streams output via SSE

```mermaid
sequenceDiagram
participant UI as "Startup UI<br/>Startup.tsx"
participant API as "Startup API<br/>deploy-api.ts"
participant FS as "Filesystem"
participant GIT as "Git"
participant PROC as "Child Processes"
UI->>API : POST /api/startup/launch (ide, projects, options)
API->>FS : Expand paths (~ → home)
API->>PROC : Spawn IDE processes (shell=true, detached)
API->>GIT : Fetch/Checkout/Merge per project
API->>FS : Compute dependency fingerprint (HEAD : package*.lock)
API->>API : Decide install vs skip (smartInstall)
API->>PROC : Run install commands (login shell wrapper)
API->>PROC : Run dev commands (TTY or SSE)
API-->>UI : SSE bootstrap_ready
API-->>UI : Stream logs (filtered)
API-->>UI : Completed/Stopped/Failure events
```

**Diagram sources**
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [server/deploy-api.ts](file://server/deploy-api.ts)

**Section sources**
- [src/pages/Startup.tsx](file://src/pages/Startup.tsx)
- [server/deploy-api.ts](file://server/deploy-api.ts)

## Detailed Component Analysis

### Startup Orchestration Service
Responsibilities:
- IDE launching: opens IDEs for each project path
- Git synchronization: fetches remote branches, checks out, and attempts fast-forward merges
- Dependency management: computes fingerprints of dependency-related files and decides whether to install
- Development server launching: supports both Terminal.app TTY mode and streaming output mode
- Streaming logs: filters noisy progress dashboards and highlights meaningful messages

Key logic:
- IDE launching: spawns processes with shell and detached flags
- Git sync: runs fetch, checkout, and merge steps per project
- Smart install: compares fingerprints before/after sync; skips if node_modules exists and no changes
- Dev launching: chooses Terminal mode on macOS or attaches streams otherwise
- Log filtering: strips ANSI, collapses carriage-return progress, and highlights failures

```mermaid
flowchart TD
Start([Startup Launch]) --> OpenIDE["Spawn IDE processes"]
OpenIDE --> GitSync["Fetch/Checkout/Merge per project"]
GitSync --> Fingerprint["Compute dependency fingerprints"]
Fingerprint --> DecideInstall{"Smart install?"}
DecideInstall --> |Skip| SkipInstall["Skip install"]
DecideInstall --> |Install| RunInstall["Run install command (login shell)"]
SkipInstall --> DevMode{"Terminal mode?"}
RunInstall --> DevMode
DevMode --> |Yes| LaunchTTY["Launch in Terminal.app (TTY)"]
DevMode --> |No| AttachSSE["Attach dev streams (SSE)"]
LaunchTTY --> Done([Completed])
AttachSSE --> Done
```

**Diagram sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)

**Section sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)

### Automation Scheduler and Terminal UI
Responsibilities:
- Schedules automated tasks (e.g., nightly upgrades) based on configured schedules
- Streams logs via Server-Sent Events (SSE)
- Supports manual intervention when a run waits for input
- Provides a terminal overlay for live execution feedback

```mermaid
sequenceDiagram
participant UI as "Automations UI<br/>Automations.tsx"
participant API as "Automation API<br/>deploy-api.ts"
participant RUN as "Run Manager"
participant PROC as "Child Processes"
UI->>API : POST /api/automation/runs/start (taskId)
API->>RUN : Create run, set status=running
RUN->>PROC : Execute task steps (spawns commands)
PROC-->>RUN : Emit logs/status/waiting/completed
RUN-->>UI : SSE events (log/waiting/completed/failed)
UI->>API : POST /api/automation/runs/{id}/continue (solution)
API->>RUN : Resume waiting run
RUN-->>UI : SSE completed
```

**Diagram sources**
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [server/deploy-api.ts](file://server/deploy-api.ts)

**Section sources**
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)
- [server/deploy-api.ts](file://server/deploy-api.ts)

### Jenkins Integration and Pipeline Orchestrator
Responsibilities:
- Validates Jenkins credentials and parameters
- Triggers jobs and polls queue/build completion
- Orchestrates multi-project pipeline runs with DAG-like sequencing
- Persists run snapshots and statistics

```mermaid
sequenceDiagram
participant API as "Deploy Pipeline API<br/>deploy-pipeline.ts"
participant CFG as "Project Config<br/>deploy-project-config.ts"
participant CRED as "Contract Helpers<br/>deploy-contract.ts"
participant JEN as "Jenkins Client<br/>jenkins-client.ts"
API->>CFG : Load and validate config
API->>CRED : Get Jenkins credentials
API->>JEN : triggerJenkinsJob(jobSegments, params)
JEN-->>API : Queue URL or Build URL
API->>JEN : pollBuildUntilComplete(buildUrl)
JEN-->>API : Final result (SUCCESS/FAILED...)
API-->>Caller : Run snapshot/events
```

**Diagram sources**
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)

**Section sources**
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)

### Electron Packaging and Desktop Lifecycle
Responsibilities:
- Builds main, preload, and bundled API into dist-electron
- Starts bundled API as a child process with proper environment
- Waits for health endpoints and loads SPA in BrowserWindow
- Graceful shutdown by terminating child processes

```mermaid
sequenceDiagram
participant App as "Electron App<br/>electron/main.ts"
participant Build as "Build Script<br/>scripts/build-electron.mjs"
participant API as "Bundled API (UtilityProcess)"
participant UI as "BrowserWindow"
Build-->>App : dist-electron artifacts
App->>API : fork api.cjs with env (SERVE_SPA_ROOT, DEPLOY_PROJECT_CONFIG_PATH)
App->>App : ensurePortFree(DEPLOY_API_PORT)
App->>API : waitForHttpOk('/api/deploy/health')
API-->>App : OK
App->>UI : loadSPA (Vite dev or bundled SPA)
App->>UI : createFloatWindow (always-on-top)
App->>App : on before-quit -> kill API child
```

**Diagram sources**
- [electron/main.ts](file://electron/main.ts)
- [scripts/build-electron.mjs](file://scripts/build-electron.mjs)

**Section sources**
- [electron/main.ts](file://electron/main.ts)
- [scripts/build-electron.mjs](file://scripts/build-electron.mjs)

### Vite Dynamic Proxy and Development Workflow Integration
Responsibilities:
- Proxies /api/* routes to the backend with runtime port discovery
- Prevents stale proxy configurations by reading .deploy-api-port per request
- Sanitizes HTML responses from misrouted ports

```mermaid
flowchart TD
Vite["Vite Dev Server"] --> Proxy["Dynamic Proxy Plugin"]
Proxy --> ReadPort["Read .deploy-api-port or env"]
Proxy --> ValidatePort{"Valid port?"}
ValidatePort --> |No| Error["Return 502 with guidance"]
ValidatePort --> |Yes| Forward["Forward request to 127.0.0.1:<port>"]
Forward --> Backend["Backend API"]
```

**Diagram sources**
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [vite.config.ts](file://vite.config.ts)

**Section sources**
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [vite.config.ts](file://vite.config.ts)

## Dependency Analysis
- Startup orchestration depends on:
  - Project catalog and configuration for IDE/commands
  - Child process APIs for spawning and managing dev servers
  - Git commands for synchronization
- Automation scheduler depends on:
  - Scheduled timers and run state management
  - SSE transport for live logs
- Jenkins integration depends on:
  - Configuration validation and credential retrieval
  - HTTP polling and error sanitization
- Electron packaging depends on:
  - esbuild outputs and resource paths
  - UtilityProcess for backend child lifecycle

```mermaid
graph LR
Startup["Startup API<br/>deploy-api.ts"] --> Config["Project Config<br/>deploy-project-config.ts"]
Startup --> Jenkins["Jenkins Client<br/>jenkins-client.ts"]
Pipeline["Deploy Pipeline<br/>deploy-pipeline.ts"] --> Jenkins
Pipeline --> Config
Electron["Electron Main<br/>electron/main.ts"] --> Startup
Vite["Vite Config<br/>vite.config.ts"] --> Proxy["Proxy Plugin<br/>vite.deploy-api-proxy-plugin.ts"]
Proxy --> Startup
```

**Diagram sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [electron/main.ts](file://electron/main.ts)
- [vite.config.ts](file://vite.config.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)

**Section sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [server/deploy-pipeline.ts](file://server/deploy-pipeline.ts)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [electron/main.ts](file://electron/main.ts)
- [vite.config.ts](file://vite.config.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)

## Performance Considerations
- Streaming log filtering reduces noise and improves readability for long-running builds
- Smart install avoids redundant dependency resolution when no relevant files changed
- Terminal mode on macOS provides true TTY for interactive tools; streaming mode reduces overhead for non-interactive tasks
- Electron packaging excludes large bundled fonts to speed up asar/zip creation

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and recovery mechanisms:
- Port conflicts: The Electron main process checks and kills conflicting listeners before starting the backend
- Backend health: The Electron main process waits for a health endpoint; failures surface via dialogs and app quit
- Proxy misconfiguration: The Vite plugin reads .deploy-api-port dynamically; invalid ports return structured 502 errors
- Jenkins connectivity: Authentication and permission failures are sanitized into actionable messages
- Automation waits: Manual intervention endpoints allow resuming runs that require user input

**Section sources**
- [electron/main.ts](file://electron/main.ts)
- [vite.deploy-api-proxy-plugin.ts](file://vite.deploy-api-proxy-plugin.ts)
- [server/jenkins-client.ts](file://server/jenkins-client.ts)
- [src/pages/Automations.tsx](file://src/pages/Automations.tsx)

## Conclusion
The development environment management system integrates IDE launching, Git synchronization, intelligent dependency resolution, and flexible development server modes. It provides robust automation scheduling, Jenkins orchestration, and seamless desktop packaging with strong error handling and recovery mechanisms.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Example Project Configuration
- Project catalog and deployment targets are defined in a JSON configuration file
- Defaults include branch, Jenkins base URL, and parameter names
- Projects specify job paths and default branches
- Optional Jira branch rules map Jira IDs to specific branches

**Section sources**
- [config/deploy-projects.json](file://config/deploy-projects.json)
- [server/deploy-project-config.ts](file://server/deploy-project-config.ts)
- [server/deploy-contract.ts](file://server/deploy-contract.ts)

### Development Server Launch Modes
- Terminal mode (macOS): launches commands in a new Terminal window with true TTY
- Streaming mode: attaches child process stdout/stderr to SSE for real-time UI updates

**Section sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)

### Process Management and Graceful Shutdown
- Child processes are tracked and terminated gracefully on stop or shutdown
- Electron main process ensures backend child is killed on app quit

**Section sources**
- [server/deploy-api.ts](file://server/deploy-api.ts)
- [electron/main.ts](file://electron/main.ts)