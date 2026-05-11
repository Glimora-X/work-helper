/**
 * 开发时把 /api/deploy、/api/jira 等转发到 deploy-api。
 * 每次请求重新读取 `.deploy-api-port`，避免 Vite 启动早于 API 写端口文件时代理死锁在错误端口。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

const API_PREFIXES = ['/api/deploy', '/api/startup', '/api/local-skills', '/api/jira'] as const;

const HOP_BY_HOP_REQ = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHopReqHeaders(
  headers: http.IncomingHttpHeaders
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!k || HOP_BY_HOP_REQ.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function readDeployApiPort(projectRoot: string, envPortHint: string): string {
  const hint = envPortHint?.trim();
  if (hint && /^\d+$/.test(hint)) return hint;
  const fromProc = process.env.DEPLOY_API_PORT?.trim();
  if (fromProc && /^\d+$/.test(fromProc)) return fromProc;
  try {
    const p = fs.readFileSync(path.join(projectRoot, '.deploy-api-port'), 'utf8').trim();
    if (/^\d+$/.test(p)) return p;
  } catch {
    /* 文件尚未创建 */
  }
  return '8787';
}

/** 与 Express 一致的路径（含 query 前的 pathname），避免 req.url 无前导 / 或带绝对 URL 时匹配失败 */
function requestPathname(req: http.IncomingMessage): string {
  const raw = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '/';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return new URL(raw).pathname || '/';
    } catch {
      return '/';
    }
  }
  const pathOnly = raw.split('?')[0] || '/';
  if (!pathOnly.startsWith('/')) return `/${pathOnly}`;
  return pathOnly.replace(/\/{2,}/g, '/');
}

function createProxyMiddleware(projectRoot: string, envPortHint: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = requestPathname(req);
    const search = (() => {
      const raw = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';
      const i = raw.indexOf('?');
      return i >= 0 ? raw.slice(i) : '';
    })();
    const pathForProxy = pathname + search;

    if (
      !API_PREFIXES.some(
        (p) =>
          pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)
      )
    ) {
      next();
      return;
    }

    const port = Number(readDeployApiPort(projectRoot, envPortHint));
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: '无效的 deploy-api 端口' }));
      return;
    }

    const headers = stripHopByHopReqHeaders(req.headers);
    headers.host = `127.0.0.1:${port}`;

    const proxyReq = http.request(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port,
        path: pathForProxy,
        method: req.method,
        headers,
        timeout: 120_000,
      },
      (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        const ct = String(proxyRes.headers['content-type'] || '');
        /**
         * 默认端口 8787 常被其它进程占用，会返回 Express/HTML「Cannot GET」。
         * 原样转发会让前端把 HTML 当 JSON 解析失败，误以为是凭据或 VITE_DEPLOY_API_BASE 问题。
         */
        if (status === 404 && ct.includes('text/html')) {
          proxyRes.resume();
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: `127.0.0.1:${port} 对 ${pathForProxy} 返回了 HTML 404。请确认本项目的 deploy-api 已监听该端口（npm run dev:api 或 npm run dev）；若端口被其它服务占用，请改 DEPLOY_API_PORT / 结束冲突进程，并查看项目根 .deploy-api-port。`,
            })
          );
          return;
        }
        res.writeHead(status, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      if (res.writableEnded) return;
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: `无法连接 deploy-api（127.0.0.1:${port}）：${err.message}`,
        })
      );
    });

    req.pipe(proxyReq);
  };
}

export function deployApiDynamicProxyPlugin(options: {
  /** 来自 loadEnv 的 DEPLOY_API_PORT（.env） */
  envDeployApiPort: string;
  /** 仓库根（含 .deploy-api-port） */
  projectRoot: string;
}): Plugin {
  const { envDeployApiPort, projectRoot } = options;
  return {
    name: 'deploy-api-dynamic-proxy',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(createProxyMiddleware(projectRoot, envDeployApiPort));
    },
  };
}
