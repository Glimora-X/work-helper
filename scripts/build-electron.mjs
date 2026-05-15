/**
 * 构建 Electron 主进程、preload、打包后的 deploy-api，并把 Vite dist 拷入 dist-electron/dist。
 * 参考 AssetFlow：esbuild → dist-electron/，供 electron-builder 与 loadURL/loadFile 使用。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist-electron');

/** 勿整目录 rm：否则 dev 时每次编译会删掉已拷入的 dist-electron/dist；只保证目录存在 */
fs.mkdirSync(outDir, {recursive: true});

const esbuildNode = {
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
};

await esbuild.build({
  ...esbuildNode,
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(outDir, 'main.cjs'),
  minify: true,
  external: ['electron'],
});

await esbuild.build({
  ...esbuildNode,
  entryPoints: [path.join(root, 'electron/preload.ts')],
  outfile: path.join(outDir, 'preload.cjs'),
  minify: false,
  external: ['electron'],
});

await esbuild.build({
  ...esbuildNode,
  entryPoints: [path.join(root, 'server/deploy-api.ts')],
  outfile: path.join(outDir, 'api.cjs'),
  minify: true,
});

const viteDist = path.join(root, 'dist');
const nestedDist = path.join(outDir, 'dist');
if (fs.existsSync(viteDist)) {
  fs.cpSync(viteDist, nestedDist, {recursive: true});
} else {
  console.warn('[build-electron] dist/ 不存在，请先执行 ELECTRON=1 vite build（或 npm run build:client）');
}

/** 约 26MB TTF 会显著拖慢 asar/zip；桌面包默认剔除，正文回退到 Noto。保留请设 ELECTRON_KEEP_BUNDLED_FONT=1 */
const keepFont = process.env.ELECTRON_KEEP_BUNDLED_FONT === '1';
const bundledFont = path.join(nestedDist, 'fonts', 'LXGWWenKaiScreen.ttf');
if (!keepFont && fs.existsSync(bundledFont)) {
  fs.rmSync(bundledFont);
  try {
    const fontsDir = path.join(nestedDist, 'fonts');
    if (fs.existsSync(fontsDir) && fs.readdirSync(fontsDir).length === 0) {
      fs.rmdirSync(fontsDir);
    }
  } catch {
    /* ignore */
  }
  console.warn(
    '[build-electron] 已从 dist-electron 移除 LXGWWenKaiScreen.ttf（加快打包）。本机可安装该字体以恢复显示；或 ELECTRON_KEEP_BUNDLED_FONT=1 保留进包。',
  );
}

console.log('[build-electron] done →', outDir);
