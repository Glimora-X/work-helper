import { Rocket, Zap, Trash2, FileText, CheckSquare, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';

const actions = [
  {
    title: '工程部署',
    subtitle: 'DEPLOYMENT',
    description: '自动化打包并发布工程至测试或线上环境。',
    icon: Rocket,
    path: '/deploy',
    color: 'var(--primary)',
  },
  {
    title: '工程启动',
    subtitle: 'STARTUP',
    description: '一键启动本地服务、数据库及开发依赖项。',
    icon: Zap,
    path: '/startup',
    color: 'var(--warning)',
  },
  {
    title: '工作台清理',
    subtitle: 'CLEANUP',
    description: '清理多余分支、构建产物以及无用缓存。',
    icon: Trash2,
    path: '/cleanup',
    color: 'var(--danger)',
  },
  {
    title: '每日总结',
    subtitle: 'SUMMARY',
    description: '生成今日代码提交记录与工作完成情况报告。',
    icon: FileText,
    path: '/summary',
    color: 'var(--secondary)',
  },
  {
    title: '待办任务',
    subtitle: 'TASKS',
    description: '管理并跟踪开发周期中的下一步核心工作。',
    icon: CheckSquare,
    path: '/tasks',
    color: 'var(--success)',
  }
];

export default function Dashboard() {
  return (
    <div className="pkmer-page">
      <div className="pkmer-page-inner pkmer-page-inner--wide">
        <PageHeader title="控制台" subtitle="管理开发流水线与日常任务" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {actions.map((action) => (
          <Link
            key={action.title}
            to={action.path}
            className="pkmer-card group relative flex flex-col p-6 no-underline overflow-hidden"
          >
            {/* Background gradient effect */}
            <div 
              className="absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity duration-300"
              style={{ 
                background: `linear-gradient(135deg, ${action.color}22 0%, ${action.color}11 100%)` 
              }}
            />
            
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-200 group-hover:scale-110"
                  style={{ 
                    backgroundColor: `${action.color}15`,
                    borderColor: `${action.color}30`,
                  }}
                >
                  <action.icon 
                    className="w-6 h-6 stroke-[2.5px]" 
                    style={{ color: action.color }} 
                  />
                </div>
                <ArrowRight
                  className="w-5 h-5 transition-all duration-200 group-hover:translate-x-1 group-hover:scale-110"
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>

              <div>
                <div className="flex items-baseline gap-3 mb-3">
                  <h2 className="text-sm font-semibold" 
                      style={{ color: 'var(--text-primary)', fontFamily: '"Noto Sans SC", sans-serif' }}>
                    {action.title}
                  </h2>
                  <span
                    className="text-[10px] uppercase font-mono tracking-wider opacity-60"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {action.subtitle}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {action.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
        </div>
      </div>
    </div>
  );
}
