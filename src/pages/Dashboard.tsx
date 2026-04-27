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
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">控制台</h1>
        <p className="text-sm text-gray-500 mt-1">管理开发流水线与日常任务。</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {actions.map((action) => (
          <Link 
            key={action.title}
            to={action.path}
            className="group relative flex flex-col p-5 bg-white border border-gray-200 rounded-xl hover:border-gray-400 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="w-8 h-8 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-center">
                <action.icon className="w-4 h-4 text-gray-700 stroke-[2px]" />
              </div>
              <ArrowRight className="w-4 h-4 text-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-gray-900" />
            </div>
            
            <div>
              <h2 className="text-sm font-medium text-gray-900 flex items-baseline gap-2">
                {action.title}
                <span className="text-[10px] uppercase text-gray-400 font-mono tracking-wider">{action.subtitle}</span>
              </h2>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                {action.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
