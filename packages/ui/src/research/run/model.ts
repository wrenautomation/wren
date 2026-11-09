/**
 * One weaver run as its graph reads it (designs/2026-11-05-research-web.md, round 13): sources
 * with their pages and kept findings, the run's claims, its searches and its dropped hits. The
 * portal maps `weaver serve`'s view into this; the graph computes nothing from the ledger.
 * Short keys are the artifact's (`LdYvUurK`), kept so the port reads line for line against it.
 */

/** Who speaks: one closed set across runs (research-engine.md, 11-06, option C). */
export type Speaker =
  | "research"
  | "person"
  | "forum"
  | "press"
  | "company"
  | "public_body"
  | "other";
/** The type of evidence a finding is. */
export type Evidence = "data" | "study" | "account" | "analysis" | "report" | "promo" | "other";

export const SPEAKERS: Record<Speaker, { many: string; one: string }> = {
  research: { many: "Research", one: "Research" },
  person: { many: "People", one: "Person" },
  forum: { many: "Forums", one: "Forum" },
  press: { many: "Press", one: "Press" },
  company: { many: "Companies", one: "Company" },
  public_body: { many: "Public bodies", one: "Public body" },
  other: { many: "Other", one: "Other" },
};
export const SPEAKER_ORDER = Object.keys(SPEAKERS) as Speaker[];
export const EVIDENCE: Record<Evidence, string> = {
  data: "Data",
  study: "Study",
  account: "Account",
  analysis: "Analysis",
  report: "Report",
  promo: "Promo",
  other: "Other",
};
/** Strong to weak; one ink at falling opacity, so it never fights the speaker hues. */
export const EV_ORDER: Evidence[] = [
  "data",
  "study",
  "analysis",
  "report",
  "account",
  "other",
  "promo",
];
export const EV_ALPHA = [1, 0.82, 0.66, 0.52, 0.4, 0.28, 0.18];

export interface GraphPage {
  /** title */
  t: string;
  /** url */
  u: string;
  /** published date */
  d: string | null;
  /** length in seconds (video) */
  len: number;
  /** findings kept from it */
  kept: number;
  /** video thumbnail */
  th: string | null;
  /** page image */
  og?: string | null;
  /** round read */
  r: number;
  /** format: video, article, paper, thread ... */
  f: string;
  e: Evidence;
}

export interface GraphFinding {
  t: string;
  q: string;
  e: Evidence;
  /** claim index, -1 for none */
  c: number;
  /** page index in its source */
  p: number;
  /** last check: 1 passed, 0 failed, -1 none */
  ok: -1 | 0 | 1;
  why: string;
}

export interface GraphSource {
  id: number;
  name: string;
  site: "web" | "youtube" | "reddit";
  kind: Speaker;
  fmt: string;
  icon: string | null;
  thumb: string | null;
  og: string | null;
  home: string | null;
  /** first round it showed */
  r: number;
  pages: GraphPage[];
  /** kept hits never read */
  unread: { t: string; u: string; r: number }[];
  kept: number;
  /** findings in claims */
  used: number;
  fs: GraphFinding[];
  /** claim index → findings for it */
  claims: Record<number, number>;
}

export interface GraphClaim {
  i: number;
  n: number;
  head: string;
  rest: string;
  findings: number;
  sources: number;
  /** its run's place, when the graph holds several */
  run?: number;
}

export interface GraphSearch {
  i: number;
  r: number;
  t: string;
  why: string;
  /** facet */
  f: string;
  hits: number;
  kept: number;
  read: number;
  fnd: number;
  /** source ids it reached */
  ss: number[];
}

export interface GraphDrop {
  id: string;
  t: string;
  u: string;
  /** host */
  h: string;
  why: string;
  r: number;
  /** search indexes */
  q: number[];
  /** snippet */
  sn: string;
  /** the judge's subject score, 0 to 100 */
  s: number | null;
  /** the judge's format and its share */
  f: [string, number] | null;
  k: Speaker;
}

export interface RunGraphData {
  /** the run id, for `weaver open` */
  rid: string;
  /** the ask, whole */
  t: string;
  /** the agent's note, when it stopped */
  note: string;
  meta: string;
  rounds: number;
  funnel: {
    hits: number;
    kept: number;
    read: number;
    withF: number;
    findings: number;
    used: number;
    claims: number;
  };
  claims: GraphClaim[];
  sources: GraphSource[];
  searches: GraphSearch[];
  dropped: GraphDrop[];
  /** several runs on one graph: then every `r` is a run's place here (1-based), not a round */
  runs?: { rid: string; t: string }[];
}

/** What `r` counts: rounds of one run, or the runs of a merged graph. */
export const stepOf = (run: RunGraphData) => (run.runs ? "run" : "round");
/** "round 3", or "Run 3" with `cap` */
export const stepAt = (run: RunGraphData, r: number, cap = false) =>
  `${cap ? (run.runs ? "Run" : "Round") : stepOf(run)} ${r}`;

export interface GNode {
  s: GraphSource;
  id: number;
  k: Speaker;
  imp: number;
  /** claims it backs */
  nc: number;
  rank: number;
  /** rank among the sources with findings */
  lr: number;
}

export interface Indexed {
  run: RunGraphData;
  nodes: GNode[];
  rank: GNode[];
  claims: { c: GraphClaim; i: number; ss: GNode[] }[];
  rounds: number[];
  reach: Map<number, number[]>;
  why: { w: string; ds: (GraphDrop & { i: number })[] }[];
  byId: Map<number, GNode>;
  byQ: Map<number, GraphSearch>;
  drops: Map<number, number[]>;
}

const claimsOf = (s: GraphSource) => Object.keys(s.claims).length;

export function indexRun(run: RunGraphData): Indexed {
  const nodes: GNode[] = run.sources.map((s) => ({
    s,
    id: s.id,
    k: s.kind,
    imp: s.kept + 2 * s.used,
    nc: claimsOf(s),
    rank: 0,
    lr: -1,
  }));
  const rank = nodes.slice().sort((a, b) => b.imp - a.imp || b.s.kept - a.s.kept || a.id - b.id);
  rank.forEach((n, i) => {
    n.rank = i;
  });
  rank
    .filter((n) => n.s.kept)
    .forEach((n, i) => {
      n.lr = i;
    });
  const claims = run.claims.map((c) => ({
    c,
    i: c.i,
    ss: nodes.filter((n) => (n.s.claims[c.i] ?? 0) > 0),
  }));
  const rounds = [
    ...new Set([...run.sources.map((s) => s.r), ...run.searches.map((q) => q.r)]),
  ].sort((a, b) => a - b);
  const reach = new Map(
    nodes.map((n) => [n.id, run.searches.filter((q) => q.ss.includes(n.id)).map((q) => q.i)]),
  );
  const groups = new Map<string, (GraphDrop & { i: number })[]>();
  run.dropped.forEach((d, i) => {
    const g = groups.get(d.why) ?? [];
    g.push({ ...d, i });
    groups.set(d.why, g);
  });
  const why = [...groups]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([w, ds]) => ({ w, ds: ds.sort((a, b) => (b.s ?? -1) - (a.s ?? -1)) }));
  const drops = new Map<number, number[]>();
  run.dropped.forEach((d, i) => {
    for (const q of d.q) drops.set(q, [...(drops.get(q) ?? []), i]);
  });
  return {
    run,
    nodes,
    rank,
    claims,
    rounds,
    reach,
    why,
    byId: new Map(nodes.map((n) => [n.id, n])),
    byQ: new Map(run.searches.map((q) => [q.i, q])),
    drops,
  };
}

export const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : /ch$/.test(w) ? "es" : "s"}`;
export const f1 = (v: number) => Math.round(v * 10) / 10;
export const unit = (s: GraphSource) =>
  s.site === "youtube" ? "video" : s.site === "reddit" ? "thread" : "page";
export const day = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
export const clock = (t: number) => {
  if (!t) return "";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(Math.floor(t % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
/** A text fragment link to the quote; video and Reddit pages can't take one. */
export const atQuote = (u: string, q: string) =>
  /youtu|reddit\.com/.test(u) || !q
    ? null
    : `${u.split("#")[0]}#:~:text=${encodeURIComponent(q.split(/\s+/).slice(0, 9).join(" "))}`;
export const cap = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);
export const evIndex = (e: string) =>
  Math.max(0, EV_ORDER.indexOf((e in EVIDENCE ? e : "other") as Evidence));
/** Evidence counts in EV_ORDER. */
export const evCounts = (fs: GraphFinding[]) => {
  const c = EV_ORDER.map(() => 0);
  for (const f of fs) c[evIndex(f.e)] = (c[evIndex(f.e)] ?? 0) + 1;
  return c;
};
export const pic = (s: GraphSource) => s.thumb || s.og;
export const countOf = (n: GNode) => {
  const s = n.s;
  return !s.pages.length
    ? "Not read yet"
    : !s.kept
      ? "Read, no finding"
      : pl(s.kept, "finding") + (n.nc ? ` · ${pl(n.nc, "claim")}` : "");
};
/** A seeded jitter: the same run lays out the same way every time. */
export const jit = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x) - 0.5;
};
type Answer = { f: GraphFinding; n: GNode; score: number };
const ANSWERS = new WeakMap<Indexed, Map<number, Answer>>();
/**
 * A search's answer: the best finding on the sources it found. Checked first, then in a claim, then
 * strongest evidence. Searches pick in run order; a finding an earlier search took counts only when
 * none is left, so one strong source does not repeat on every card.
 */
export const answerOf = (L: Indexed, qi: number): Answer | null => {
  let all = ANSWERS.get(L);
  if (!all) {
    all = new Map();
    const taken = new Set<GraphFinding>();
    for (const q of [...L.byQ.keys()].sort((a, b) => a - b)) {
      let best: Answer | null = null;
      for (const id of L.byQ.get(q)?.ss ?? []) {
        const n = L.byId.get(id);
        for (const f of n?.s.fs ?? []) {
          const score =
            (taken.has(f) ? 1000 : 0) + (f.ok === 1 ? 0 : 100) + (f.c >= 0 ? 0 : 10) + evIndex(f.e);
          if (n && (!best || score < best.score)) best = { f, n, score };
        }
      }
      if (best) {
        taken.add(best.f);
        all.set(q, best);
      }
    }
    ANSWERS.set(L, all);
  }
  return all.get(qi) ?? null;
};
/** The sources a search found that hold a finding, and their findings. */
export const spokesOf = (L: Indexed, qi: number) =>
  (L.byQ.get(qi)?.ss ?? []).map((id) => L.byId.get(id)).filter((n): n is GNode => !!n?.s.kept);
