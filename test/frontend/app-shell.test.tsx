import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes, TopNav, defaultRoutePath } from '../../src/App';

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  },
});

test('top navigation omits the home entry and marks the current page', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/deploy']}>
      <TopNav />
    </MemoryRouter>,
  );

  assert.equal(html.includes('首页'), false);
  assert.equal(html.includes('Dev Console'), false);
  assert.equal(html.includes('助手'), false);
  assert.match(html, /data-nav-position="bottom"/);
  assert.match(html, /部署/);
  assert.match(html, /aria-current="page"/);
});

test('default route points to deploy', () => {
  assert.equal(defaultRoutePath, '/deploy');
});

test('route shell renders the deploy page for deploy path', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/deploy']}>
      <AppRoutes />
    </MemoryRouter>,
  );

  assert.match(html, /工程部署/);
});
