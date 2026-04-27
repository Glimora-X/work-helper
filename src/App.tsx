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
    <aside className="w-16 bg-[#FDFDFD] border-r border-gray-200 flex flex-col h-full items-center shrink-0">
      <div className="h-16 flex items-center justify-center w-full border-b border-gray-100">
        <Command className="w-5 h-5 text-gray-900 stroke-[2px]" />
      </div>
      <nav className="flex-1 w-full flex flex-col items-center py-6 space-y-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.name}
              className={`flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
                isActive 
                  ? 'bg-gray-100 text-gray-900 shadow-sm' 
                  : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <item.icon className="w-[18px] h-[18px] stroke-[2px]" />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export default function App() {
  return (
    <Router>
      <div className="flex h-screen bg-[#FAFAFA] font-sans antialiased text-gray-900">
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
