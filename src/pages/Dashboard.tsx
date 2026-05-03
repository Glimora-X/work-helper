import { Rocket, Zap, Trash2, FileText, CheckSquare, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const actions = [
  {
    title: '工程部署',
    subtitle: 'Deployment',
    description: '自动化打包并发布工程至测试或线上环境。',
    icon: Rocket,
    path: '/deploy',
  },
  {
    title: '工程启动',
    subtitle: 'Startup',
    description: '一键启动本地服务、数据库及开发依赖项。',
    icon: Zap,
    path: '/startup',
  },
  {
    title: '工作台清理',
    subtitle: 'Cleanup',
    description: '清理多余分支、构建产物以及无用缓存。',
    icon: Trash2,
    path: '/cleanup',
  },
  {
    title: '每日总结',
    subtitle: 'Summary',
    description: '生成今日代码提交记录与工作完成情况报告。',
    icon: FileText,
    path: '/summary',
  },
  {
    title: '待办任务',
    subtitle: 'Tasks',
    description: '管理并跟踪开发周期中的下一步核心工作。',
    icon: CheckSquare,
    path: '/tasks',
  }
];

export default function Dashboard() {
  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto">
      <header className="mb-10">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: '"Noto Serif SC", serif', color: 'var(--text-primary)' }}
        >
          控制台
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          管理开发流水线与日常任务。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {actions.map((action) => (
          <Link
            key={action.title}
            to={action.path}
            className="group relative flex flex-col p-5 rounded-xl transition-all duration-200 no-underline"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-card)',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow = 'var(--shadow-hover)';
              el.style.transform = 'translateY(-3px)';
              el.style.borderColor = 'var(--border-medium)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow = 'var(--shadow-card)';
              el.style.transform = 'translateY(0)';
              el.style.borderColor = 'var(--border-light)';
            }}
          >
            <div className="flex justify-between items-start mb-5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--accent-light)', border: '1px solid rgba(74,144,217,0.2)' }}
              >
                <action.icon className="w-4 h-4 stroke-[2px]" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <ArrowRight
                className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                style={{ color: 'var(--border-medium)' }}
              />
            </div>

            <div>
              <h2
                className="text-sm font-semibold flex items-baseline gap-2"
                style={{ color: 'var(--text-primary)', fontFamily: '"Noto Sans SC", sans-serif' }}
              >
                {action.title}
                <span
                  className="text-[10px] uppercase font-mono tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {action.subtitle}
                </span>
              </h2>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {action.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
