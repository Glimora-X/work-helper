import {normalizeCommandText, stripDeployVerbs} from './text-normalize';
import {prioritizeByRecentOrder} from './recent';

export interface DeployTemplateLike {
  id: string;
  name: string;
  nodes: string[];
  links?: Array<{ source: string; target: string }>;
  keywords?: string[];
}

export type DeployTemplateConfidence = 'high' | 'medium' | 'low';

export type DeployTemplateResolveResult =
  | { type: 'exact'; template: DeployTemplateLike; confidence: DeployTemplateConfidence }
  | { type: 'multiple'; candidates: DeployTemplateLike[] }
  | { type: 'none'; suggestions: DeployTemplateLike[] };

function scoreTemplate(q: string, t: DeployTemplateLike): number {
  const nameN = normalizeCommandText(t.name);
  const qn = q;
  if (!qn) return 0;
  let s = 0;
  if (nameN === qn) s += 100;
  else if (nameN.includes(qn) || qn.includes(nameN)) s += 40;
  for (const kw of t.keywords || []) {
    const k = normalizeCommandText(kw);
    if (!k) continue;
    if (k === qn) s += 80;
    else if (k.includes(qn) || qn.includes(k)) s += 35;
  }
  for (const node of t.nodes) {
    const n = normalizeCommandText(node);
    if (!n) continue;
    if (n === qn) s += 50;
    else if (n.includes(qn) || qn.includes(n)) s += 20;
  }
  return s;
}

function confidenceFromScore(top: number, second: number): DeployTemplateConfidence {
  if (top >= 100) return 'high';
  if (top >= 40 && top - second >= 15) return 'medium';
  return 'low';
}

/**
 * 同步、可离线：按模板名 / keywords / 节点名与查询匹配。
 * `deployRecentFromPage` 为 Deployment 页内 `deploy_recent_v1` 的 id 列表（可选），与浮标 recent 合并排序在调用方完成。
 */
export function resolveDeployTemplates(
  rawQuery: string,
  templates: DeployTemplateLike[],
  floatTemplateRecentIds: string[]
): DeployTemplateResolveResult {
  const q = normalizeCommandText(stripDeployVerbs(rawQuery));
  if (!templates.length) {
    return {type: 'none', suggestions: []};
  }

  const scored = templates.map((t) => ({t, score: scoreTemplate(q, t)}));
  scored.sort((a, b) => b.score - a.score);
  const positive = scored.filter((x) => x.score > 0).map((x) => x.t);

  if (positive.length === 0) {
    const suggestions = prioritizeByRecentOrder([...templates], floatTemplateRecentIds).slice(0, 5);
    return {type: 'none', suggestions};
  }

  const ordered = prioritizeByRecentOrder(positive, floatTemplateRecentIds);
  const topScore = scored[0]?.score ?? 0;
  const secondScore = scored[1]?.score ?? 0;

  if (ordered.length === 1) {
    return {
      type: 'exact',
      template: ordered[0],
      confidence: confidenceFromScore(topScore, secondScore),
    };
  }

  const best = ordered[0];
  const rest1 = ordered[1];
  const s0 = scoreTemplate(q, best);
  const s1 = scoreTemplate(q, rest1);
  if (s0 > s1 && s0 - s1 >= 12) {
    return {type: 'exact', template: best, confidence: confidenceFromScore(s0, s1)};
  }

  return {type: 'multiple', candidates: ordered.slice(0, 8)};
}
