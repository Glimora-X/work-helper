import {
  Bot,
  CheckSquare,
  FileText,
  Rocket,
  Trash2,
  Zap,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import { BrowserRouter as Router, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Automations from './pages/Automations';
import Cleanup from './pages/Cleanup';
import Dashboard from './pages/Dashboard';
import Deployment from './pages/Deployment';
import Startup from './pages/Startup';
import Summary from './pages/Summary';
import Tasks from './pages/Tasks';

type NavItem = {
  name: string;
  path: string;
  icon: LucideIcon;
};

export const defaultRoutePath = '/dashboard';

export const navItems: NavItem[] = [
  { name: '控制台', path: '/dashboard', icon: LayoutDashboard },
  { name: '部署', path: '/deploy', icon: Rocket },
  { name: '启动', path: '/startup', icon: Zap },
  { name: '自动化', path: '/automations', icon: Bot },
  { name: '清理', path: '/cleanup', icon: Trash2 },
  { name: '总结', path: '/summary', icon: FileText },
  { name: '任务', path: '/tasks', icon: CheckSquare },
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

export default function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}
