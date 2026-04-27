export default function Tasks() {
  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">待办任务</h1>
        <p className="text-sm text-gray-500 mt-1">Task tracking and actionable steps.</p>
      </header>
      <div className="border border-gray-200 bg-white rounded-xl p-8 h-64 flex items-center justify-center shadow-sm">
        <p className="text-sm text-gray-400 font-mono">[ Tasks Module ]</p>
      </div>
    </div>
  );
}
