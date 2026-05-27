import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const saved = { ...process.env };

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in saved)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('assistant-workspace-config dotenv paths', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('prefers ASSISTANT_DOTENV_PATH over bundle-style .env when both exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-env-'));
    const assistantEnv = path.join(dir, 'userData.env');
    const bundleEnv = path.join(dir, 'bundle.env');
    fs.writeFileSync(assistantEnv, 'MAIL_IMAP_PASSWORD="from-assistant"\n');
    fs.writeFileSync(bundleEnv, 'MAIL_IMAP_PASSWORD="from-bundle"\n');

    process.env.ASSISTANT_DOTENV_PATH = assistantEnv;
    process.env.DEPLOY_API_DOTENV = bundleEnv;

    const mod = await import('../../server/assistant-workspace-config.ts');
    assert.equal(mod.resolveDeployApiDotenvPath(), path.resolve(assistantEnv));
    assert.equal(mod.resolveWritableDotenvPath(), path.resolve(assistantEnv));
  });

  it('resolveWritableDotenvPath targets ASSISTANT_DOTENV_PATH when that file does not exist yet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-env-'));
    const assistantEnv = path.join(dir, 'new-user.env');
    process.env.ASSISTANT_DOTENV_PATH = assistantEnv;
    delete process.env.DEPLOY_API_DOTENV;

    const mod = await import('../../server/assistant-workspace-config.ts');
    assert.equal(mod.resolveWritableDotenvPath(), path.resolve(assistantEnv));
  });

  it('reloadDeployApiDotenv loads variables with override', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-env-'));
    const envFile = path.join(dir, 'reload.env');
    fs.writeFileSync(envFile, 'MAIL_IMAP_PASSWORD="secret123"\n');
    process.env.ASSISTANT_DOTENV_PATH = envFile;
    delete process.env.MAIL_IMAP_PASSWORD;

    const mod = await import('../../server/assistant-workspace-config.ts');
    mod.reloadDeployApiDotenv({ override: true });
    assert.equal(process.env.MAIL_IMAP_PASSWORD, 'secret123');
  });
});
