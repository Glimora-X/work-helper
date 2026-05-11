import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {deployApiDynamicProxyPlugin} from './vite.deploy-api-proxy-plugin';

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  /**
   * `vite` 与 `vite preview` 均为 command=serve。
   * 勿用 `ELECTRON` 关闭代理：许多环境会长期 export ELECTRON=1，导致 /api/jira 等落到 Vite 404（HTML「Cannot GET」）。
   * 桌面包用 `command===build` 根本不会走此分支；若需显式关闭开发代理可设 `VITE_DISABLE_DEPLOY_PROXY=1`。
   */
  const enableDeployApiProxy =
    command === 'serve' && process.env.VITE_DISABLE_DEPLOY_PROXY !== '1';
  const isWebDev = mode === 'development' && process.env.ELECTRON !== '1';
  /** 桌面包不走 Service Worker / Workbox，显著减小 dist、加快 asar 与 zip */
  const isElectronClient = process.env.ELECTRON === '1';

  const pwaPlugin = VitePWA({
    registerType: 'autoUpdate',
    // 开发时注册 SW，否则 Chrome 不会出现 PWA 安装入口。
    devOptions: {
      enabled: true,
    },
    includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
    manifest: {
      name: 'Dottie-Assistant',
      short_name: 'Dottie-Assistant',
      description: '工作助手应用',
      theme_color: '#1e1e2e',
      background_color: '#1e1e2e',
      display: 'standalone',
      start_url: '/',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: 'app-logo.png',
          sizes: '512x512',
          type: 'image/png',
        },
        {
          src: 'app-logo.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    workbox: {
      // LXGWWenKaiScreen.ttf ≈26MB；默认 2MiB 预缓存上限会排除该文件
      maximumFileSizeToCacheInBytes: 35 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,ico,png,svg,ttf}'],
      // 开发时禁用对 /api 的离线缓存，避免把代理错误页 HTML 缓进 SW 后长期污染 /api/jira 等请求
      runtimeCaching: isWebDev
        ? [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
          ]
        : [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 10,
              },
            },
          ],
    },
  });

  return {
    base: isElectronClient ? './' : '/',
    plugins: [
      ...(enableDeployApiProxy
        ? [
            deployApiDynamicProxyPlugin({
              envDeployApiPort: env.DEPLOY_API_PORT || '',
              projectRoot: __dirname,
            }),
          ]
        : []),
      react(),
      tailwindcss(),
      ...(isElectronClient ? [] : [pwaPlugin]),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // /api/* → deploy-api 由 deployApiDynamicProxyPlugin 按请求动态读端口（见 vite.deploy-api-proxy-plugin.ts）
    },
  };
});
