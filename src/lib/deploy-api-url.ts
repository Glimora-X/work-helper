/**
 * 与 Deployment / Automations 一致：默认同源 `/api/deploy`（走 Vite 代理，端口随 `.deploy-api-port`）。
 * 若设置绝对 URL（如 `http://127.0.0.1:8787/api/deploy`），则 Jira 等请求走 `${origin}/api/jira/...`，
 * 该端口必须与正在运行的 deploy-api 一致，否则会拿到 HTML 错误页而非 JSON。
 */
export function getDeployApiBase(): string {
  const raw = import.meta.env.VITE_DEPLOY_API_BASE ?? '/api/deploy';
  return raw.replace(/\/$/, '') || '/api/deploy';
}

/** 请求 deploy-api 上挂载的各路由前缀（与 vite 代理路径一致） */
export function deployApiUrl(
  prefix: 'deploy' | 'jira' | 'startup' | 'local-skills',
  path: string
): string {
  const deployBase = getDeployApiBase();
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (deployBase.startsWith('http://') || deployBase.startsWith('https://')) {
    try {
      const u = new URL(deployBase);
      return `${u.origin}/api/${prefix}${suffix}`;
    } catch {
      return `/api/${prefix}${suffix}`;
    }
  }
  return `/api/${prefix}${suffix}`;
}
