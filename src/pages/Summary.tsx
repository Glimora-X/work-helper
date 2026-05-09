export default function Summary() {
  return (
    <div className="p-8 md:p-12 max-w-6xl mx-auto">
      <header className="mb-12">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">每日总结</h1>
        <p className="text-sm text-gray-500 mt-1">Daily development insights and logs</p>
      </header>
      
      <div className="artistic-card p-12 h-80 flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl mb-6 flex items-center justify-center" 
             style={{ backgroundColor: 'var(--secondary)15', border: '2px solid var(--secondary)30' }}>
          <span className="text-2xl" style={{ color: 'var(--secondary)' }}>📊</span>
        </div>
        <p className="text-sm font-mono text-gray-400 mb-2">
          SUMMARY MODULE
        </p>
        <p className="text-xs text-gray-500">
          功能开发中，敬请期待
        </p>
      </div>
    </div>
  );
}
