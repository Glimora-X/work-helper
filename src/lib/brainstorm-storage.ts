/**
 * 头脑风暴 / 灵光记录（Tasks 页「头脑风暴」标签），本机 localStorage。
 */

export const BRAINSTORM_STORAGE_KEY = 'assistant-brainstorm-v1';

export type BrainstormItem = {
  id: string;
  text: string;
  createdAt: number;
};

export function loadBrainstormItems(): BrainstormItem[] {
  try {
    const raw = localStorage.getItem(BRAINSTORM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is BrainstormItem =>
          row != null &&
          typeof row === 'object' &&
          typeof (row as BrainstormItem).id === 'string' &&
          typeof (row as BrainstormItem).text === 'string' &&
          typeof (row as BrainstormItem).createdAt === 'number',
      )
      .map((row) => ({...row, text: row.text.trim()}))
      .filter((row) => row.text.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persistBrainstormItems(items: BrainstormItem[]): void {
  localStorage.setItem(BRAINSTORM_STORAGE_KEY, JSON.stringify(items));
}

/** 新增一条；全文 trim 后相同视为重复 */
export function addBrainstormItem(text: string): {added: boolean; reason?: 'empty' | 'duplicate'} {
  const t = text.trim();
  if (!t) return {added: false, reason: 'empty'};
  const items = loadBrainstormItems();
  if (items.some((row) => row.text === t)) {
    return {added: false, reason: 'duplicate'};
  }
  const item: BrainstormItem = {
    id: crypto.randomUUID(),
    text: t,
    createdAt: Date.now(),
  };
  persistBrainstormItems([item, ...items]);
  return {added: true};
}

export function updateBrainstormItem(id: string, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const items = loadBrainstormItems();
  const idx = items.findIndex((row) => row.id === id);
  if (idx < 0) return false;
  if (items.some((row, i) => i !== idx && row.text === t)) return false;
  const next = [...items];
  next[idx] = {...next[idx], text: t};
  persistBrainstormItems(next);
  return true;
}

export function removeBrainstormItem(id: string): void {
  persistBrainstormItems(loadBrainstormItems().filter((row) => row.id !== id));
}

export function formatBrainstormTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}
