import {
  Bot,
  CheckSquare,
  FileText,
  Library,
  Rocket,
  Sparkles,
  Trash2,
  Zap,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import FloatDock from './pages/FloatDock';
import Automations from './pages/Automations';
import Cleanup from './pages/Cleanup';
import Dashboard from './pages/Dashboard';
import Deployment from './pages/Deployment';
import Startup from './pages/Startup';
import SkillsLibrary from './pages/SkillsLibrary';

const ArtisticAssistant = lazy(() => import('./pages/ArtisticAssistant'));
import Summary from './pages/Summary';
import Tasks from './pages/Tasks';

type NavItem = {
  name: string;
  path: string;
  icon: LucideIcon;
};

export const defaultRoutePath = '/tasks';

export const navItems: NavItem[] = [
  // { name: '控制台', path: '/dashboard', icon: LayoutDashboard },
  { name: '任务', path: '/tasks', icon: CheckSquare },
  { name: '技能', path: '/skills', icon: Library },
  { name: '助手', path: '/artistic', icon: Sparkles },
  { name: '部署', path: '/deploy', icon: Rocket },
  { name: '启动', path: '/startup', icon: Zap },
  { name: '自动化', path: '/automations', icon: Bot },
  { name: '总结', path: '/summary', icon: FileText },
];

export function TopNav() {
  const location = useLocation();

  return (
    <footer className="top-nav-shell">
      <nav aria-label="主导航" data-nav-position="bottom" className="top-nav-glass top-nav-scroll">
        <div className="top-nav-track">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;

            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                className="top-nav-link"
              >
                {isActive ? <span aria-hidden="true" className="top-nav-current-dot" /> : null}
                <Icon className="top-nav-icon h-4 w-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </footer>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultRoutePath} replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/deploy" element={<Deployment />} />
      <Route path="/startup" element={<Startup />} />
      <Route path="/automations" element={<Automations />} />
      <Route path="/cleanup" element={<Cleanup />} />
      <Route path="/summary" element={<Summary />} />
      <Route path="/tasks" element={<Tasks />} />
      <Route path="/skills" element={<SkillsLibrary />} />
      <Route
        path="/artistic"
        element={
          <Suspense
            fallback={
              <div className="flex flex-1 min-h-[40vh] items-center justify-center text-sm" style={{color: 'var(--text-muted)'}}>
                加载助手…
              </div>
            }
          >
            <ArtisticAssistant />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to={defaultRoutePath} replace />} />
    </Routes>
  );
}

function AppShell() {
  return (
    <div className="app-shell font-sans antialiased">
      <main className="app-main">
        <AppRoutes />
      </main>
      <TopNav />
    </div>
  );
}

function AppRoot() {
  const location = useLocation();
  if (location.pathname === '/electron-float') {
    return <FloatDock />;
  }
  return <AppShell />;
}

export default function App() {
  return (
    <Router>
      <AppRoot />
    </Router>
  );
}
