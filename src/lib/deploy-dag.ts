export type DeployGraphLink = { source: string; target: string };

export interface DeployDagSpec {
  nodes: string[];
  links?: DeployGraphLink[];
}

export function serialLinks(nodeNames: string[]): DeployGraphLink[] {
  return nodeNames.slice(1).map((target, index) => ({
    source: nodeNames[index],
    target,
  }));
}

export function resolveDeployLinks(nodeNames: string[], links?: DeployGraphLink[]): DeployGraphLink[] {
  if (links?.length) return links;
  return serialLinks(nodeNames);
}

export function validateDeployGraph(
  nodeNames: string[],
  links: DeployGraphLink[]
): { valid: boolean; error?: string } {
  const names = [...new Set(nodeNames.map((n) => n.trim()).filter(Boolean))];
  if (!names.length) return { valid: false, error: '至少需要一个节点' };

  const adjList = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const { source, target } of links) {
    if (!names.includes(source) || !names.includes(target)) {
      return { valid: false, error: `依赖边引用了未知节点: ${source} → ${target}` };
    }
    adjList.get(source)?.push(target);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjList.get(nodeId) || []) {
      if (hasCycle(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  };

  for (const name of names) {
    if (hasCycle(name)) {
      return { valid: false, error: '检测到循环依赖，DAG 必须为有向无环图' };
    }
  }

  return { valid: true };
}

/** 按拓扑层级分批：同一 stage 内节点可并行执行 */
export function computeExecutionStages(nodeNames: string[], links: DeployGraphLink[]): string[][] {
  const names = [...new Set(nodeNames.map((n) => n.trim()).filter(Boolean))];
  const graphLinks = resolveDeployLinks(names, links);
  const validation = validateDeployGraph(names, graphLinks);
  if (!validation.valid) {
    throw new Error(validation.error || 'invalid dag');
  }

  const inDegree = new Map(names.map((n) => [n, 0]));
  const adj = new Map(names.map((n) => [n, [] as string[]]));
  for (const { source, target } of graphLinks) {
    adj.get(source)!.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const stages: string[][] = [];
  let ready = names.filter((n) => inDegree.get(n) === 0);

  while (ready.length) {
    stages.push([...ready]);
    const nextReady: string[] = [];
    for (const cur of ready) {
      for (const next of adj.get(cur) ?? []) {
        inDegree.set(next, inDegree.get(next)! - 1);
        if (inDegree.get(next) === 0) nextReady.push(next);
      }
    }
    ready = nextReady;
  }

  if (stages.flat().length !== names.length) {
    throw new Error('检测到循环依赖，DAG 必须为有向无环图');
  }

  return stages;
}

export function layoutDeployDagPositions(
  nodeNames: string[],
  links: DeployGraphLink[],
  opts?: { colWidth?: number; rowHeight?: number; centerX?: number }
): Map<string, { x: number; y: number }> {
  const names = [...new Set(nodeNames.map((n) => n.trim()).filter(Boolean))];
  const graphLinks = resolveDeployLinks(names, links);
  const colWidth = opts?.colWidth ?? 220;
  const rowHeight = opts?.rowHeight ?? 150;
  const centerX = opts?.centerX ?? 300;

  const inDegree = new Map(names.map((n) => [n, 0]));
  const adj = new Map(names.map((n) => [n, [] as string[]]));
  for (const { source, target } of graphLinks) {
    adj.get(source)!.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const level = new Map<string, number>();
  const queue = names.filter((n) => inDegree.get(n) === 0);
  queue.forEach((n) => level.set(n, 0));

  while (queue.length) {
    const cur = queue.shift()!;
    const curLevel = level.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, curLevel + 1));
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  const byLevel = new Map<number, string[]>();
  for (const name of names) {
    const lv = level.get(name) ?? 0;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(name);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [lv, rowNames] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const totalWidth = (rowNames.length - 1) * colWidth;
    const startX = centerX - totalWidth / 2;
    rowNames.forEach((name, idx) => {
      positions.set(name, { x: startX + idx * colWidth, y: lv * rowHeight });
    });
  }

  return positions;
}

export function flattenExecutionStages(stages: string[][]): string[] {
  return stages.flat();
}

export function buildTaskKeyFromStages(stages: string[][]): string {
  return flattenExecutionStages(stages).join(',');
}

export function linksMatchTemplate(
  nodeNames: string[],
  templateNodes: string[],
  templateLinks?: DeployGraphLink[],
  currentLinks?: DeployGraphLink[]
): boolean {
  const a = new Set(nodeNames);
  const b = new Set(templateNodes);
  if (a.size !== b.size) return false;
  for (const n of a) {
    if (!b.has(n)) return false;
  }

  const normalize = (links: DeployGraphLink[]) =>
    links
      .map(({ source, target }) => `${source}->${target}`)
      .sort()
      .join('|');

  const left = normalize(resolveDeployLinks(nodeNames, currentLinks));
  const right = normalize(resolveDeployLinks(templateNodes, templateLinks));
  return left === right;
}
