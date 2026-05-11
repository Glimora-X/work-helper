import PageHeader from '../components/PageHeader';

export default function Cleanup() {
  return (
    <div className="p-8 md:p-12 max-w-6xl mx-auto">
      <PageHeader title="工作台清理" subtitle="清理仓库分支、构建产物与本地缓存" />

      <div className="artistic-card p-12 h-80 flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl mb-6 flex items-center justify-center"
             style={{ backgroundColor: 'var(--danger)15', border: '2px solid var(--danger)30' }}>
          <span className="text-2xl" style={{ color: 'var(--danger)' }}>🗑️</span>
        </div>
        <p className="text-sm font-mono text-gray-400 mb-2">
          CLEANUP MODULE
        </p>
        <p className="text-xs text-gray-500">
          功能开发中，敬请期待
        </p>
      </div>
    </div>
  );
}
