/**
 * Several runs as one run graph's data: pure, no d3, so the portal maps and merges in its main
 * chunk while the graph itself loads late (WA-1187).
 */
import type { GraphClaim, GraphDrop, GraphSearch, GraphSource, RunGraphData } from "./model.js";

const n1 = (s: GraphSource) => `${s.site}:${s.name}`;

/**
 * Several runs on one graph: a source two runs read is one node, so it links their claims. `r`
 * becomes the run's place (1-based) and `runs` names them; a drop's id is `<place>.<hit id>`.
 */
export function mergeGraphs(gs: readonly RunGraphData[], t: string): RunGraphData {
  const src = new Map<string, GraphSource>();
  const claims: GraphClaim[] = [];
  const searches: GraphSearch[] = [];
  const dropped: GraphDrop[] = [];
  gs.forEach((g, at) => {
    const k = at + 1;
    const c0 = claims.length;
    const q0 = searches.length;
    const sid = new Map<number, number>();
    for (const s of g.sources) {
      let m = src.get(n1(s));
      if (!m) {
        m = {
          ...s,
          id: src.size,
          r: k,
          pages: [],
          unread: [],
          kept: 0,
          used: 0,
          fs: [],
          claims: {},
        };
        src.set(n1(s), m);
      } else if (s.pages.length > m.pages.length) m.kind = s.kind;
      m.thumb ??= s.thumb;
      m.og ??= s.og;
      sid.set(s.id, m.id);
      const p0 = m.pages.length;
      m.pages.push(...s.pages.map((p) => ({ ...p, r: k })));
      m.unread.push(...s.unread.map((u) => ({ ...u, r: k })));
      m.fs.push(...s.fs.map((f) => ({ ...f, c: f.c < 0 ? -1 : c0 + f.c, p: p0 + f.p })));
      for (const [c, n] of Object.entries(s.claims)) m.claims[c0 + Number(c)] = n;
      m.kept += s.kept;
      m.used += s.used;
    }
    for (const c of g.claims) claims.push({ ...c, i: c0 + c.i, n: c0 + c.i + 1, run: k });
    for (const q of g.searches)
      searches.push({ ...q, i: q0 + q.i, r: k, ss: q.ss.map((s) => sid.get(s) ?? s) });
    for (const d of g.dropped)
      dropped.push({ ...d, id: `${k}.${d.id}`, r: k, q: d.q.map((x) => q0 + x) });
  });
  const sources = [...src.values()];
  for (const c of claims) c.sources = sources.filter((s) => s.claims[c.i]).length;
  const sum = (f: (g: RunGraphData) => number) => gs.reduce((a, g) => a + f(g), 0);
  return {
    rid: gs.map((g) => g.rid).join(","),
    t,
    note: "",
    meta: `${gs.length} runs · ${sources.length} sources`,
    rounds: gs.length,
    funnel: {
      hits: sum((g) => g.funnel.hits),
      kept: sum((g) => g.funnel.kept),
      read: sum((g) => g.funnel.read),
      withF: sum((g) => g.funnel.withF),
      findings: sum((g) => g.funnel.findings),
      used: sum((g) => g.funnel.used),
      claims: claims.length,
    },
    claims,
    sources,
    searches,
    dropped,
    runs: gs.map((g) => ({ rid: g.rid, t: g.t })),
  };
}
