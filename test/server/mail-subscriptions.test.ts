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

describe('mail-subscriptions', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('loadMailSubscriptions returns empty when file missing (no false throw on subscriptions in path)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-sub-'));
    const missing = path.join(dir, 'config', 'mail-subscriptions.json');
    process.env.MAIL_SUBSCRIPTIONS_PATH = missing;
    delete process.env.ASSISTANT_DOTENV_PATH;
    delete process.env.DEPLOY_PROJECT_CONFIG_PATH;

    const mod = await import('../../server/mail-subscriptions.ts');
    const data = mod.loadMailSubscriptions();
    assert.equal(data.version, 1);
    assert.deepEqual(data.subscriptions, []);
  });

  it('seeds userData mail-subscriptions from bundled config on first load', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-sub-'));
    const bundledDir = path.join(dir, 'bundle-config');
    const userDir = path.join(dir, 'userData');
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundledDir, 'mail-subscriptions.json'),
      JSON.stringify({
        version: 1,
        subscriptions: [
          {
            id: 'test',
            name: 'Test',
            fromContains: ['a@b.com'],
            subjectContains: [],
            mailbox: 'INBOX',
          },
        ],
      }) + '\n'
    );

    process.env.DEPLOY_PROJECT_CONFIG_PATH = path.join(bundledDir, 'deploy-projects.json');
    process.env.ASSISTANT_DOTENV_PATH = path.join(userDir, '.env');
    process.env.MAIL_SUBSCRIPTIONS_PATH = path.join(userDir, 'config', 'mail-subscriptions.json');

    const mod = await import('../../server/mail-subscriptions.ts');
    const data = mod.loadMailSubscriptions();
    assert.equal(data.subscriptions.length, 1);
    assert.equal(data.subscriptions[0]?.id, 'test');
    assert.equal(fs.existsSync(process.env.MAIL_SUBSCRIPTIONS_PATH!), true);
  });
});
