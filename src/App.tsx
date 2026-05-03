import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Rocket, Zap, Trash2, FileText, CheckSquare, Command, Bot } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Deployment from './pages/Deployment';
import Startup from './pages/Startup';
import Cleanup from './pages/Cleanup';
import Summary from './pages/Summary';
import Tasks from './pages/Tasks';
import Automations from './pages/Automations';

function Sidebar() {
  const location = useLocation();
  const navItems = [
    { name: '首页', path: '/', icon: LayoutDashboard },
    { name: '部署', path: '/deploy', icon: Rocket },
    { name: '启动', path: '/startup', icon: Zap },
    { name: '自动化', path: '/automations', icon: Bot },
    { name: '清理', path: '/cleanup', icon: Trash2 },
    { name: '总结', path: '/summary', icon: FileText },
    { name: '任务', path: '/tasks', icon: CheckSquare },
  ];

  return (
    <aside
      className="shrink-0 flex flex-col h-full"
      style={{ width: 220, background: 'var(--bg-sidebar)' }}
    >
      {/* Logo Header */}
      <div
        className="h-16 flex items-center px-5 gap-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-gradient)' }}
        >
          <Command className="w-4 h-4 text-white stroke-[2px]" />
        </div>
        <span
          className="text-[15px] font-semibold tracking-wide"
          style={{ fontFamily: '"Noto Serif SC", serif', color: 'var(--text-sidebar)' }}
        >
          助手
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-1 overflow-y-auto">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest px-3 pt-1 pb-2"
          style={{ color: '#5a6480', letterSpacing: '0.08em' }}
        >
          导航
        </span>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13.5px] transition-all duration-200 no-underline"
              style={{
                color: isActive ? '#a8d4f8' : 'var(--text-sidebar)',
                background: isActive ? 'rgba(74,144,217,0.18)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent',
                paddingLeft: isActive ? '9px' : '12px',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(74,144,217,0.10)';
                  (e.currentTarget as HTMLElement).style.color = '#a8d4f8';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-sidebar)';
                }
              }}
            >
              <item.icon className="w-[15px] h-[15px] shrink-0 stroke-[2px]" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="px-5 py-4 text-[11px] shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)', color: '#4a5270' }}
      >
        助手 · Dev Console
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <Router>
      <div className="flex h-screen font-sans antialiased" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/deploy" element={<Deployment />} />
            <Route path="/startup" element={<Startup />} />
            <Route path="/automations" element={<Automations />} />
            <Route path="/cleanup" element={<Cleanup />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/tasks" element={<Tasks />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
