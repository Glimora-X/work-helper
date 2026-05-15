const FLOAT_STARTUP_RECENT_KEY = 'float_command_recent_startup_v1';
const FLOAT_DEPLOY_RECENT_KEY = 'float_command_recent_deploy_v1';

type RecentList = { id: string; at: number }[];

function readList(key: string): RecentList {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .filter((x): x is { id: string; at: number } => {
        return x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' && typeof (x as { at?: unknown }).at === 'number';
      })
      .slice(0, 40);
  } catch {
    return [];
  }
}

function writeList(key: string, list: RecentList): void {
  localStorage.setItem(key, JSON.stringify(list.slice(0, 40)));
}

/** 最近用过的 profile id，新在前 */
export function readStartupRecentIds(): string[] {
  return readList(FLOAT_STARTUP_RECENT_KEY)
    .sort((a, b) => b.at - a.at)
    .map((x) => x.id);
}

export function recordStartupProfileUsed(profileId: string): void {
  const id = profileId.trim();
  if (!id) return;
  const list = readList(FLOAT_STARTUP_RECENT_KEY).filter((x) => x.id !== id);
  list.unshift({ id, at: Date.now() });
  writeList(FLOAT_STARTUP_RECENT_KEY, list);
}

export function readDeployTemplateRecentIds(): string[] {
  return readList(FLOAT_DEPLOY_RECENT_KEY)
    .sort((a, b) => b.at - a.at)
    .map((x) => x.id);
}

export function recordDeployTemplateUsed(templateId: string): void {
  const id = templateId.trim();
  if (!id) return;
  const list = readList(FLOAT_DEPLOY_RECENT_KEY).filter((x) => x.id !== id);
  list.unshift({ id, at: Date.now() });
  writeList(FLOAT_DEPLOY_RECENT_KEY, list);
}

/** 将 ids 按 recentIds 顺序前置，其余保持原相对顺序 */
export function prioritizeByRecentOrder<T extends { id: string }>(items: T[], recentIds: string[]): T[] {
  const rank = new Map<string, number>();
  recentIds.forEach((id, i) => rank.set(id, i));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : 999;
    const rb = rank.has(b.id) ? rank.get(b.id)! : 999;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

/** 合并浮标与部署页「最近执行模板」id，用于模板排序 */
export function readDeployRecentIdsForResolve(): string[] {
  const fromFloat = readDeployTemplateRecentIds();
  let fromPage: string[] = [];
  try {
    const raw = localStorage.getItem('deploy_recent_v1');
    if (raw) {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) {
        fromPage = p.filter((x): x is string => typeof x === 'string');
      }
    }
  } catch {
    /* ignore */
  }
  return [...new Set([...fromFloat, ...fromPage])];
}
