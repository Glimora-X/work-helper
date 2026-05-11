import path from 'node:path';

const ENTRY_BASENAMES = new Set(['api.cjs', 'deploy-api.ts', 'deploy-api.js', 'deploy-api.mjs']);

/**
 * 当前入口文件所在目录（用于定位仓库根 `.env` 等）。
 * - 单文件 CJS 打包（`api.cjs`）无可靠 `__filename` / `import.meta`，从 `process.argv` 解析脚本路径
 * - `tsx server/deploy-api.ts`：argv 中含 `deploy-api.ts`
 */
export function moduleDirname(): string {
  if (typeof __filename === 'string') {
    return path.dirname(__filename);
  }
  for (let i = process.argv.length - 1; i >= 1; i--) {
    const a = process.argv[i];
    if (!a || a.startsWith('-')) continue;
    if (ENTRY_BASENAMES.has(path.basename(a))) {
      return path.dirname(path.resolve(a));
    }
  }
  return process.cwd();
}
