# Frontend Application Architecture

<cite>
**Referenced Files in This Document**
- [src/main.tsx](file://src/main.tsx)
- [src/App.tsx](file://src/App.tsx)
- [src/index.css](file://src/index.css)
- [src/components/PageHeader.tsx](file://src/components/PageHeader.tsx)
- [src/lib/daily-todos-storage.ts](file://src/lib/daily-todos-storage.ts)
- [src/lib/deploy-api-url.ts](file://src/lib/deploy-api-url.ts)
- [src/pages/Dashboard.tsx](file://src/pages/Dashboard.tsx)
- [src/pages/Tasks.tsx](file://src/pages/Tasks.tsx)
- [src/pages/Deployment.tsx](file://src/pages/Deployment.tsx)
- [src/pages/Settings.tsx](file://src/pages/Settings.tsx)
- [src/pages/deploy.html](file://src/pages/deploy.html)
- [vite.config.ts](file://vite.config.ts)
- [package.json](file://package.json)
- [tsconfig.json](file://tsconfig.json)
- [dev-dist/sw.js](file://dev-dist/sw.js)
- [dev-dist/registerSW.js](file://dev-dist/registerSW.js)
</cite>

## Update Summary
**Changes Made**
- Added new deployment control console with DAG visualization system
- Enhanced CSS framework with new design patterns and responsive layout improvements
- Integrated AI-powered dependency graph generation capabilities
- Added template-based deployment chains functionality
- Updated deployment architecture to support both React-based and static HTML implementations

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [New Deployment Control Console](#new-deployment-control-console)
7. [Enhanced CSS Framework](#enhanced-css-framework)
8. [Dependency Analysis](#dependency-analysis)
9. [Performance Considerations](#performance-considerations)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Conclusion](#conclusion)

## Introduction
This document describes the frontend architecture of a React-based application built with TypeScript, Vite, and TailwindCSS 4.14. It covers the component-based structure, routing with React Router, state management patterns, styling approach, page-based architecture, Progressive Web App (PWA) capabilities, build configuration, and responsive design principles. The application now includes a new deployment control console with DAG visualization, AI-powered dependency graph generation, and template-based deployment chains, alongside the existing React-based deployment system.

## Project Structure
The frontend is organized around a dual-architecture approach with both React-based components and standalone HTML pages. The deployment system now supports two distinct implementations: a React-based deployment editor and a new static HTML deployment control console with advanced DAG visualization capabilities.

```mermaid
graph TB
A["src/main.tsx<br/>Application entry"] --> B["src/App.tsx<br/>Routing and layout"]
B --> C["src/pages/Dashboard.tsx"]
B --> D["src/pages/Tasks.tsx"]
B --> E["src/pages/Deployment.tsx<br/>React-based"]
B --> F["src/pages/Settings.tsx"]
B --> G["src/pages/ArtisticAssistant.tsx<br/>Lazy-loaded"]
B --> H["src/components/PageHeader.tsx<br/>Shared header"]
I["src/pages/deploy.html<br/>New DAG Console"] --> J["Static HTML + JS"]
J --> K["DAG Visualization"]
J --> L["AI Dependency Graph"]
J --> M["Template Chains"]
N["src/index.css<br/>Enhanced Tailwind + theme"] --> B
N --> I
O["vite.config.ts<br/>Build + PWA"] --> A
P["package.json<br/>Dependencies"] --> A
Q["tsconfig.json<br/>TypeScript"] --> A
R["dev-dist/sw.js<br/>Service Worker"] --> O
S["dev-dist/registerSW.js<br/>Register SW"] --> R
```

**Diagram sources**
- [src/main.tsx:1-11](file://src/main.tsx#L1-L11)
- [src/App.tsx:1-136](file://src/App.tsx#L1-L136)
- [src/pages/Deployment.tsx:1-1068](file://src/pages/Deployment.tsx#L1-L1068)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)
- [src/index.css:1-1962](file://src/index.css#L1-L1962)

**Section sources**
- [src/main.tsx:1-11](file://src/main.tsx#L1-L11)
- [src/App.tsx:1-136](file://src/App.tsx#L1-L136)
- [src/pages/Deployment.tsx:1-1068](file://src/pages/Deployment.tsx#L1-L1068)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)
- [src/index.css:1-1962](file://src/index.css#L1-L1962)

## Core Components
- Application entry point initializes React and renders the root App component.
- App composes routing, a top navigation bar, and page shells. It lazily loads the AI Assistant page and defines navigation items.
- Shared PageHeader component standardizes page titles, subtitles, icons, and optional actions.
- Local storage utilities encapsulate daily todo persistence and Jira integration helpers.
- **New**: Static HTML deployment console with advanced DAG visualization and AI integration.

Key implementation references:
- Entry and root render: [src/main.tsx:1-11](file://src/main.tsx#L1-L11)
- App routing and navigation: [src/App.tsx:1-136](file://src/App.tsx#L1-L136)
- PageHeader props and rendering: [src/components/PageHeader.tsx:1-63](file://src/components/PageHeader.tsx#L1-L63)
- Daily todos storage helpers: [src/lib/daily-todos-storage.ts:1-133](file://src/lib/daily-todos-storage.ts#L1-L133)
- New deployment console: [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)

**Section sources**
- [src/main.tsx:1-11](file://src/main.tsx#L1-L11)
- [src/App.tsx:1-136](file://src/App.tsx#L1-L136)
- [src/components/PageHeader.tsx:1-63](file://src/components/PageHeader.tsx#L1-L63)
- [src/lib/daily-todos-storage.ts:1-133](file://src/lib/daily-todos-storage.ts#L1-L133)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)

## Architecture Overview
The application follows a dual-architecture approach with:
- StrictMode root and React 19
- React Router v7 for client-side routing
- Lazy loading for heavy pages (AI Assistant)
- TailwindCSS 4.14 with enhanced custom theme and PKMer color tokens
- Vite build with PWA support and dynamic proxy for deploy API
- **New**: Static HTML deployment console with advanced DAG visualization and AI integration

```mermaid
graph TB
subgraph "Runtime"
R["React 19 Runtime"]
RR["React Router 7"]
SW["Service Worker (Workbox)"]
DH["DAG Console (HTML)"]
end
subgraph "UI Layer"
APP["App.tsx"]
NAV["Top Navigation"]
PAGES["React Pages<br/>Dashboard / Tasks / Deployment / Settings"]
LAZY["ArtisticAssistant (lazy)"]
DC["Deployment Console<br/>(React + HTML)"]
END
subgraph "Styling"
CSS["src/index.css<br/>Enhanced Tailwind + theme"]
THEME["PKMer tokens + variables"]
DAGCSS["DAG Console Styles"]
end
subgraph "Build & PWA"
VITE["vite.config.ts"]
PKG["package.json"]
TS["tsconfig.json"]
end
R --> APP
APP --> RR
APP --> NAV
APP --> PAGES
APP --> LAZY
APP --> DC
CSS --> APP
CSS --> PAGES
CSS --> NAV
CSS --> DC
THEME --> CSS
DAGCSS --> DC
VITE --> R
PKG --> VITE
TS --> R
VITE --> SW
```

**Diagram sources**
- [src/App.tsx:1-136](file://src/App.tsx#L1-L136)
- [src/pages/Deployment.tsx:1-1068](file://src/pages/Deployment.tsx#L1-L1068)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)
- [src/index.css:1-1962](file://src/index.css#L1-L1962)
- [vite.config.ts:1-111](file://vite.config.ts#L1-L111)

## Detailed Component Analysis

### Application Shell and Routing
- App wraps the entire UI in a router and conditionally renders either the main app shell or a floating dock for Electron.
- AppRoutes defines all routes and redirects missing paths to the default route.
- TopNav renders a glass-like bottom navigation with Lucide icons and active state detection.

```mermaid
sequenceDiagram
participant U as "User"
participant R as "BrowserRouter"
participant A as "App"
participant AR as "AppRoutes"
participant P as "Page Component"
U->>R : Navigate to "/tasks"
R->>AR : Match route
AR->>P : Render Tasks page
P-->>U : Display page content
```

**Diagram sources**
- [src/App.tsx:78-108](file://src/App.tsx#L78-L108)
- [src/App.tsx:121-127](file://src/App.tsx#L121-L127)

**Section sources**
- [src/App.tsx:1-136](file://src/App.tsx#L1-L136)

### Page-Based Architecture
- Dashboard: Grid of quick-action cards linking to related pages.
- Tasks: Local-first todo list with date navigation, drag-and-drop reordering, editing, and Jira integration.
- **Updated**: Deployment: Now includes both React-based deployment editor with SSE-driven logs and a new static HTML deployment console with DAG visualization.
- Settings: Environment and project catalog management with .env write-back.

```mermaid
flowchart TD
Start(["User selects a page"]) --> Dash{"Dashboard?"}
Dash --> |Yes| D["src/pages/Dashboard.tsx"]
Dash --> |No| Task{"Tasks?"}
Task --> |Yes| T["src/pages/Tasks.tsx"]
Task --> |No| Deplo{"Deployment?"}
Deplo --> |Yes| DR["src/pages/Deployment.tsx<br/>(React)"]
Deplo --> |Yes| DH["src/pages/deploy.html<br/>(DAG Console)"]
Deplo --> |No| Set{"Settings?"}
Set --> |Yes| S["src/pages/Settings.tsx"]
Set --> |No| Other["Other pages"]
```

**Diagram sources**
- [src/pages/Dashboard.tsx:1-114](file://src/pages/Dashboard.tsx#L1-L114)
- [src/pages/Tasks.tsx:1-542](file://src/pages/Tasks.tsx#L1-L542)
- [src/pages/Deployment.tsx:1-1068](file://src/pages/Deployment.tsx#L1-L1068)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)
- [src/pages/Settings.tsx:1-348](file://src/pages/Settings.tsx#L1-L348)

**Section sources**
- [src/pages/Dashboard.tsx:1-114](file://src/pages/Dashboard.tsx#L1-L114)
- [src/pages/Tasks.tsx:1-542](file://src/pages/Tasks.tsx#L1-L542)
- [src/pages/Deployment.tsx:1-1068](file://src/pages/Deployment.tsx#L1-L1068)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)
- [src/pages/Settings.tsx:1-348](file://src/pages/Settings.tsx#L1-L348)

### State Management Patterns
- Local state with React hooks inside pages (useState, useEffect, useMemo, useCallback).
- Browser storage for persistence (localStorage for tasks and deployment templates).
- URL search params and session storage for transient state (e.g., deployment run snapshot).
- **New**: Static HTML deployment console uses DOM manipulation and JavaScript for real-time updates.
- No external state library is used; patterns rely on component-local and persisted state.

Representative references:
- Tasks page state and effects: [src/pages/Tasks.tsx:136-210](file://src/pages/Tasks.tsx#L136-L210)
- Deployment state and SSE: [src/pages/Deployment.tsx:88-267](file://src/pages/Deployment.tsx#L88-L267)
- Storage helpers: [src/lib/daily-todos-storage.ts:44-56](file://src/lib/daily-todos-storage.ts#L44-L56)
- DAG console JavaScript: [src/pages/deploy.html:164-233](file://src/pages/deploy.html#L164-L233)

**Section sources**
- [src/pages/Tasks.tsx:136-210](file://src/pages/Tasks.tsx#L136-L210)
- [src/pages/Deployment.tsx:88-267](file://src/pages/Deployment.tsx#L88-L267)
- [src/lib/daily-todos-storage.ts:44-56](file://src/lib/daily-todos-storage.ts#L44-L56)
- [src/pages/deploy.html:164-233](file://src/pages/deploy.html#L164-L233)

### Styling Approach with TailwindCSS 4.14
- Global CSS imports Tailwind directives and PKMer theme variables.
- Semantic tokens map to PKMer color variables for consistent theming.
- Utilities are applied via className attributes across components and pages.
- **Enhanced**: New deployment console includes custom DAG visualization styles with拟物连线 (materialized connection lines).
- Responsive breakpoints and spacing tokens are used throughout.

References:
- Tailwind and theme imports: [src/index.css:1-22](file://src/index.css#L1-L22)
- Semantic tokens and color mappings: [src/index.css:25-91](file://src/index.css#L25-L91)
- Bottom navigation styles: [src/index.css:186-304](file://src/index.css#L186-L304)
- Page utilities and components: [src/index.css:306-800](file://src/index.css#L306-L800)
- DAG console styles: [src/pages/deploy.html:9-24](file://src/pages/deploy.html#L9-L24)

**Section sources**
- [src/index.css:1-22](file://src/index.css#L1-L22)
- [src/index.css:25-91](file://src/index.css#L25-L91)
- [src/index.css:186-304](file://src/index.css#L186-L304)
- [src/index.css:306-800](file://src/index.css#L306-L800)
- [src/pages/deploy.html:9-24](file://src/pages/deploy.html#L9-L24)

### PWA Capabilities and Offline Functionality
- Vite PWA plugin configures manifest, assets, and Workbox strategies.
- Runtime caching excludes /api in development to avoid caching HTML errors; in production, API traffic uses NetworkFirst with a named cache.
- Maximum file size cache is increased to accommodate large fonts and deployment console assets.
- Service worker registration is included in development via a dedicated script.

References:
- PWA plugin and Workbox config: [vite.config.ts:21-78](file://vite.config.ts#L21-L78)
- Dev SW registration: [dev-dist/registerSW.js:1-1](file://dev-dist/registerSW.js#L1-L1)
- SW behavior and routes: [dev-dist/sw.js:70-92](file://dev-dist/sw.js#L70-L92)

**Section sources**
- [vite.config.ts:21-78](file://vite.config.ts#L21-L78)
- [dev-dist/registerSW.js:1-1](file://dev-dist/registerSW.js#L1-L1)
- [dev-dist/sw.js:70-92](file://dev-dist/sw.js#L70-L92)

### Build Configuration with Vite
- Plugins: React, TailwindCSS, PWA (excluded for Electron builds), and a dynamic deploy API proxy.
- Define constants for API keys and environment variables.
- Aliases (e.g., @/*) simplify imports.
- HMR controlled by environment variable to reduce flicker during agent edits.
- Base path differs for Electron vs web builds.

References:
- Plugin stack and aliases: [vite.config.ts:80-102](file://vite.config.ts#L80-L102)
- Dev server and HMR: [vite.config.ts:103-109](file://vite.config.ts#L103-L109)
- Electron client exclusion: [vite.config.ts:18-19](file://vite.config.ts#L18-L19)

**Section sources**
- [vite.config.ts:80-109](file://vite.config.ts#L80-L109)

### Component Composition and Prop Drilling
- App composes routes and navigation; pages receive minimal props via routing.
- PageHeader accepts icon, title, subtitle, and actions, reducing duplication across pages.
- **New**: Static HTML deployment console uses direct DOM manipulation for real-time updates.
- No context providers are present; props are passed down explicitly to avoid deep drilling.

References:
- App composition: [src/App.tsx:110-127](file://src/App.tsx#L110-L127)
- PageHeader interface and usage: [src/components/PageHeader.tsx:4-10](file://src/components/PageHeader.tsx#L4-L10)
- DAG console DOM manipulation: [src/pages/deploy.html:164-233](file://src/pages/deploy.html#L164-L233)

**Section sources**
- [src/App.tsx:110-127](file://src/App.tsx#L110-L127)
- [src/components/PageHeader.tsx:4-10](file://src/components/PageHeader.tsx#L4-L10)
- [src/pages/deploy.html:164-233](file://src/pages/deploy.html#L164-L233)

## New Deployment Control Console

### DAG Visualization System
The new deployment control console provides a sophisticated DAG (Directed Acyclic Graph) visualization system with the following features:

- **Real-time Visualization**: Interactive DAG nodes with status indicators and connection lines
- **Materialized Connection Lines**: Custom CSS for 3D-like connector lines between nodes
- **Template-Based Chains**: Predefined deployment chain templates with step counts
- **Filtering Capabilities**: Asset shape filtering for different deployment scenarios
- **Persistent State**: Background monitoring maintains deployment status even when leaving the page

### AI-Powered Dependency Graph Generation
The console includes AI integration for intelligent dependency graph generation:

- **Natural Language Processing**: Users can describe deployment requirements in natural language
- **Copilot Integration**: AI-powered dependency graph parsing and recommendation
- **Smart Suggestions**: Automatic inclusion of core microservices based on requirements
- **Visual Feedback**: Real-time status updates and progress indicators

### Template-Based Deployment Chains
The system supports template-based deployment chains with:

- **Predefined Templates**: Common deployment patterns like "MDF 核心链路" and "UI-WEB 完整发布"
- **Step Counting**: Visual indication of deployment steps in each template
- **Favorite Management**: User-defined template favorites for quick access
- **Recent Usage Tracking**: History of recently used deployment chains

### Advanced Visual Design
The deployment console features:

- **Modern Terminal Interface**: Dark theme terminal with system log output
- **Status Indicators**: Color-coded status badges for different deployment states
- **Responsive Layout**: Three-panel design (templates, DAG canvas, terminal)
- **Interactive Elements**: Hover states, animations, and visual feedback for user actions

**Section sources**
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)

## Enhanced CSS Framework

### New Design Patterns
The CSS framework has been enhanced with several new design patterns:

- **DAG Visualization Styles**: Custom CSS for materialized connection lines and node styling
- **Terminal-Themed Components**: Dark theme terminal interface with monospace fonts
- **Status Badge Systems**: Comprehensive status indicator system with animations
- **Responsive Layout Improvements**: Enhanced mobile and tablet support
- **Visual Feedback Systems**: Hover states, transitions, and interactive elements

### Enhanced Visual Feedback
The framework now includes:

- **Animation Systems**: Pulse effects, spin loaders, and status animations
- **Gradient Effects**: Enhanced gradient backgrounds and button styling
- **Glass Morphism**: Improved glass-like UI elements with backdrop filters
- **Typography Enhancements**: Better font handling and monospace support for technical content

### Integration with Deployment Features
The enhanced CSS framework supports:

- **DAG Node Styling**: Custom styling for deployment nodes with status indicators
- **Terminal Theming**: Consistent dark theme for deployment console
- **Responsive Design**: Mobile-first approach for deployment interface
- **Accessibility Improvements**: Better contrast ratios and focus states

**Section sources**
- [src/index.css:1-1962](file://src/index.css#L1-L1962)
- [src/pages/deploy.html:9-24](file://src/pages/deploy.html#L9-L24)

## Dependency Analysis
The frontend depends on React 19, React Router 7, TailwindCSS 4.14, and Lucide icons. Build-time dependencies include Vite, PWA plugin, and the deploy API proxy plugin. TypeScript configuration targets ES2022 with bundler module resolution.

```mermaid
graph LR
P["package.json"] --> R["react"]
P --> RR["react-router-dom"]
P --> TC["tailwindcss"]
P --> L["lucide-react"]
P --> VP["vite-plugin-pwa"]
P --> VR["@vitejs/plugin-react"]
P --> TV["@tailwindcss/vite"]
T["tsconfig.json"] --> ES["ES2022"]
T --> MOD["bundler moduleResolution"]
```

**Diagram sources**
- [package.json:31-60](file://package.json#L31-L60)
- [tsconfig.json:3-26](file://tsconfig.json#L3-L26)

**Section sources**
- [package.json:31-60](file://package.json#L31-L60)
- [tsconfig.json:3-26](file://tsconfig.json#L3-L26)

## Performance Considerations
- Lazy loading reduces initial bundle size for heavy pages.
- Workbox runtime caching avoids caching API responses in development to prevent stale HTML errors; production uses NetworkFirst with a dedicated cache name.
- HMR can be disabled via environment variable to reduce flicker during agent edits.
- **New**: Static HTML deployment console provides lightweight alternative for deployment-heavy operations.
- Large font files and deployment console assets are allowed by increasing maximum cache size to accommodate assets.

## Troubleshooting Guide
Common issues and checks:
- API connectivity: Verify deploy API base URL and port; ensure Vite proxy is enabled in development.
- PWA installation: Confirm service worker registration and manifest configuration.
- Local storage persistence: Validate keys and cleanup logic for empty dates.
- Navigation: Ensure route paths match nav items and default route redirection.
- **New**: Deployment console: Verify static HTML file accessibility and JavaScript functionality.

References:
- Deploy API URL helper: [src/lib/deploy-api-url.ts:6-27](file://src/lib/deploy-api-url.ts#L6-L27)
- PWA config and runtime caching: [vite.config.ts:55-77](file://vite.config.ts#L55-L77)
- Daily todos cleanup: [src/lib/daily-todos-storage.ts:27-33](file://src/lib/daily-todos-storage.ts#L27-L33)
- Default route and redirects: [src/App.tsx:81-105](file://src/App.tsx#L81-L105)
- Deployment console: [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)

**Section sources**
- [src/lib/deploy-api-url.ts:6-27](file://src/lib/deploy-api-url.ts#L6-L27)
- [vite.config.ts:55-77](file://vite.config.ts#L55-L77)
- [src/lib/daily-todos-storage.ts:27-33](file://src/lib/daily-todos-storage.ts#L27-L33)
- [src/App.tsx:81-105](file://src/App.tsx#L81-L105)
- [src/pages/deploy.html:1-235](file://src/pages/deploy.html#L1-L235)

## Conclusion
The frontend employs a clean, component-based architecture with React 19 and React Router 7, styled with TailwindCSS 4.14 and a custom theme. The addition of a new deployment control console with DAG visualization, AI-powered dependency graph generation, and template-based deployment chains significantly enhances the deployment experience. Routing is centralized, pages are modular, and state is managed locally with persistence where appropriate. The build system integrates Vite, PWA, and a dynamic deploy API proxy, enabling both web and desktop deployments. The enhanced CSS framework provides improved visual feedback and responsive design capabilities. The dual-architecture approach ensures flexibility while maintaining performance and user experience standards.