import fs from 'node:fs';
import path from 'node:path';
import { moduleDirname } from './module-dirname';

function repoRoot(): string {
  return path.resolve(moduleDirname(), '..');
}

/** 桌面包：extraResources 下的 config 目录（与 DEPLOY_PROJECT_CONFIG_PATH 同目录） */
export function resolveBundledConfigDir(): string | null {
  const deployConfig = process.env.DEPLOY_PROJECT_CONFIG_PATH?.trim();
  if (deployConfig) return path.dirname(path.resolve(deployConfig));
  return null;
}

/** 桌面包：与 ASSISTANT_DOTENV_PATH 同级的用户数据根目录 */
export function resolveAssistantUserDataDir(): string | null {
  const dotenv = process.env.ASSISTANT_DOTENV_PATH?.trim();
  if (!dotenv) return null;
  return path.dirname(path.resolve(dotenv));
}

export function resolveUserDataConfigPath(filename: string): string | null {
  const userDir = resolveAssistantUserDataDir();
  if (!userDir) return null;
  return path.join(userDir, 'config', filename);
}

export function resolveUserDataDataPath(...segments: string[]): string | null {
  const userDir = resolveAssistantUserDataDir();
  if (!userDir) return null;
  return path.join(userDir, 'data', ...segments);
}

export function resolveRepoConfigPath(filename: string): string {
  return path.join(repoRoot(), 'config', filename);
}

/** 从打包资源复制默认 config 到用户可写路径（首次运行） */
export function seedUserConfigFromBundle(filename: string, targetPath: string): void {
  if (fs.existsSync(targetPath)) return;
  const bundledDir = resolveBundledConfigDir();
  if (!bundledDir) return;
  const bundledFile = path.join(bundledDir, filename);
  if (!fs.existsSync(bundledFile)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(bundledFile, targetPath);
}
