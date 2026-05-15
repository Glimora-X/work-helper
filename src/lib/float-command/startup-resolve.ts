import {normalizeCommandText, stripStartupVerbs} from './text-normalize';
import {prioritizeByRecentOrder} from './recent';

export interface StartupProfileLike {
  id: string;
  title: string;
  description?: string;
  aliases?: string[];
  keywords?: string[];
}

export type StartupResolveConfidence = 'high' | 'medium' | 'low';

export type StartupResolveResult =
  | { type: 'exact'; profile: StartupProfileLike; confidence: StartupResolveConfidence }
  | { type: 'multiple'; candidates: StartupProfileLike[] }
  | { type: 'none'; suggestions?: StartupProfileLike[] };

function scoreProfile(q: string, p: StartupProfileLike): number {
  const qn = q;
  if (!qn) return 0;
  let s = 0;
  const idN = normalizeCommandText(p.id);
  const titleN = normalizeCommandText(p.title);
  if (idN === qn) s += 120;
  else if (titleN === qn) s += 110;
  else if (idN.includes(qn) || qn.includes(idN)) s += 45;
  else if (titleN.includes(qn) || qn.includes(titleN)) s += 50;
  for (const a of p.aliases || []) {
    const an = normalizeCommandText(a);
    if (!an) continue;
    if (an === qn) s += 95;
    else if (an.includes(qn) || qn.includes(an)) s += 40;
  }
  for (const k of p.keywords || []) {
    const kn = normalizeCommandText(k);
    if (!kn) continue;
    if (kn === qn) s += 70;
    else if (kn.includes(qn) || qn.includes(kn)) s += 28;
  }
  return s;
}

function confidenceFromScores(top: number, second: number): StartupResolveConfidence {
  if (top >= 110) return 'high';
  if (top >= 50 && top - second >= 18) return 'medium';
  return 'low';
}

export function resolveStartupProfiles(
  rawInput: string,
  profiles: StartupProfileLike[],
  recentProfileIds: string[]
): StartupResolveResult {
  const q = normalizeCommandText(stripStartupVerbs(rawInput));
  if (!profiles.length) {
    return {type: 'none', suggestions: []};
  }
  if (!q) {
    return {type: 'none', suggestions: prioritizeByRecentOrder([...profiles], recentProfileIds).slice(0, 5)};
  }

  const scored = profiles.map((p) => ({p, score: scoreProfile(q, p)}));
  scored.sort((a, b) => b.score - a.score);
  const positive = scored.filter((x) => x.score > 0).map((x) => x.p);

  if (positive.length === 0) {
    return {
      type: 'none',
      suggestions: prioritizeByRecentOrder([...profiles], recentProfileIds).slice(0, 5),
    };
  }

  const ordered = prioritizeByRecentOrder(positive, recentProfileIds);
  const top = scored[0]?.score ?? 0;
  const second = scored[1]?.score ?? 0;

  if (ordered.length === 1) {
    return {type: 'exact', profile: ordered[0], confidence: confidenceFromScores(top, second)};
  }

  const best = ordered[0];
  const s0 = scoreProfile(q, best);
  const s1 = scoreProfile(q, ordered[1]);
  if (s0 > s1 && s0 - s1 >= 15) {
    return {type: 'exact', profile: best, confidence: confidenceFromScores(s0, s1)};
  }

  return {type: 'multiple', candidates: ordered.slice(0, 8)};
}
