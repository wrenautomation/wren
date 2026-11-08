/**
 * Synthetic weaver runs for `RunGraph`: seeded, so a story, a test and a shot see the same
 * graph. Made-up shops, sites and quotes; no real name, page or number.
 */
import type {
  Evidence,
  GraphDrop,
  GraphFinding,
  GraphPage,
  GraphSearch,
  GraphSource,
  RunGraphData,
  Speaker,
} from "../research/run/model.js";
import { WORST } from "./worst.js";

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

const CLAIMS = [
  "Most shops price custom cakes per serving: the base rate rises with tiers and sugar work.",
  "Deposits cut no-shows: shops that take half up front report far fewer missed pickups.",
  "Photos sell custom work: an order form with past cakes gets more requests than text alone.",
  "Rush orders carry a fee; most shops add a fixed charge under 72 hours.",
  "Owners underprice labor; decoration hours are the cost they most often leave out.",
  "Tasting boxes convert well; shops that sell them book more wedding cakes.",
  "Delivery is priced by distance; a flat local fee then a rate per mile.",
];
const QUOTES = [
  "We charge per slice now, and the tiers set the rate.",
  "Since we asked for half up front, almost nobody skips pickup.",
  "The gallery page brings in more custom requests than anything else.",
  "Anything inside three days gets a rush fee, no exceptions.",
  "I never counted the piping hours until a friend made me.",
  "Most couples who buy the tasting box come back for the cake.",
  "Local is flat, past ten miles we charge by the mile.",
  "Our menu lists six cakes and the rest is by request.",
  "We stopped holiday orders after one bad weekend.",
  "Thursday is when the custom orders pile up.",
];
const WORDS = [
  "Crumb",
  "Oven",
  "Layer",
  "Proof",
  "Flour",
  "Sugar",
  "Batch",
  "Rise",
  "Tier",
  "Glaze",
];
const ENDS = ["Journal", "Notes", "Weekly", "Guild", "Kitchen", "Review", "Board", "Lab"];
const KINDS: Speaker[] = [
  "person",
  "person",
  "forum",
  "company",
  "press",
  "research",
  "public_body",
  "other",
];
const FMT: Record<Speaker, string> = {
  person: "article",
  forum: "thread",
  company: "docs",
  press: "news",
  research: "paper",
  public_body: "docs",
  other: "article",
};
const EV: Record<Speaker, Evidence[]> = {
  person: ["account", "account", "analysis"],
  forum: ["account"],
  company: ["promo", "analysis", "data"],
  press: ["report"],
  research: ["study", "data"],
  public_body: ["data", "report"],
  other: ["other", "analysis"],
};
const WHY = [
  "off topic",
  "a page we already kept",
  "behind a paywall",
  "older than the window",
  "a sales page",
];
const FACETS = ["pricing", "deposits", "photos", "rush", "labor", "tasting", "delivery"];

/** A video still as a data URI: a tinted field, a play mark. */
const thumb = (h: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="hsl(${h} 32% 62%)"/><path d="M70 32v26l22-13z" fill="#fff"/></svg>`,
  )}`;

export interface RunGraphShape {
  seed?: number;
  sources?: number;
  claims?: number;
  rounds?: number;
  searches?: number;
  drops?: number;
  /** long names, quotes and asks from WORST */
  worst?: boolean;
}

/** One run, the shape the portal maps from a weaver view. */
export function fakeRunGraph(o: RunGraphShape = {}): RunGraphData {
  const r = seeded(o.seed ?? 7);
  const pickOf = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const nS = o.sources ?? 42;
  const nC = Math.min(o.claims ?? 6, CLAIMS.length);
  const nR = o.rounds ?? 3;
  const nQ = o.searches === 0 ? 0 : Math.max(nR, o.searches ?? 14);
  const long = (s: string) => (o.worst ? `${s} ${WORST.longLabel}` : s);

  const sources: GraphSource[] = [];
  for (let id = 0; id < nS; id++) {
    const kind = pickOf(KINDS);
    const site = kind === "forum" && r() < 0.6 ? "reddit" : r() < 0.15 ? "youtube" : "web";
    const name =
      site === "youtube"
        ? `${pickOf(WORDS)} ${pickOf(["Bakes", "Studio", "at Home"])}`
        : site === "reddit"
          ? `r/${pickOf(WORDS).toLowerCase()}${pickOf(["baking", "shops", "pros"])}`
          : `${pickOf(WORDS)} ${pickOf(ENDS)}`;
    const host = `${name.toLowerCase().replace(/[^a-z]+/g, "")}${id}.example`;
    const round = r() < 0.5 ? 1 : 1 + Math.floor(r() * nR);
    const nP = r() < 0.18 ? 0 : 1 + Math.floor(r() * 3);
    const pages: GraphPage[] = [];
    const fs: GraphFinding[] = [];
    for (let p = 0; p < nP; p++) {
      const nf = r() < 0.3 ? 0 : 1 + Math.floor(r() * 3);
      for (let f = 0; f < nf; f++) {
        const c = r() < 0.55 ? Math.floor(r() * nC) : -1;
        const q = long(pickOf(QUOTES));
        fs.push({
          t: c >= 0 ? ((CLAIMS[c] ?? "").split(":")[0] ?? "") : q,
          q,
          e: pickOf(EV[kind]),
          c,
          p,
          ok: r() < 0.9 ? 1 : 0,
          why: "The quote says it in the shop's own words.",
        });
      }
      pages.push({
        t: long(`${pickOf(FACETS)} for custom cakes, part ${p + 1}`),
        u: `https://${host}/p/${p}`,
        d: `2026-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
        len: site === "youtube" ? 120 + Math.floor(r() * 900) : 0,
        kept: nf,
        th: site === "youtube" ? thumb(Math.floor(r() * 360)) : null,
        r: Math.min(nR, round + Math.floor(r() * 2)),
        f: site === "youtube" ? "video" : site === "reddit" ? "thread" : FMT[kind],
        e: pickOf(EV[kind]),
      });
    }
    const unread = Array.from(
      { length: nP ? Math.floor(r() * 2) : 1 + Math.floor(r() * 2) },
      (_, i) => ({
        t: long(`${pickOf(FACETS)} notes ${i + 1}`),
        u: `https://${host}/u/${i}`,
        r: round,
      }),
    );
    const claims: Record<number, number> = {};
    for (const f of fs) if (f.c >= 0 && f.ok === 1) claims[f.c] = (claims[f.c] ?? 0) + 1;
    sources.push({
      id,
      name: long(name),
      site,
      kind,
      fmt: site === "youtube" ? "video" : FMT[kind],
      icon: null,
      thumb: pages[0]?.th ?? null,
      og: null,
      home: `https://${host}/`,
      r: round,
      pages,
      unread,
      kept: fs.length,
      used: Object.values(claims).reduce((a, b) => a + b, 0),
      fs,
      claims,
    });
  }

  const searches: GraphSearch[] = [];
  for (let i = 0; i < nQ; i++) {
    const round = 1 + Math.floor((i * nR) / nQ);
    const f = FACETS[i % FACETS.length] ?? "pricing";
    searches.push({
      i,
      r: round,
      t: long(`custom cake ${f} small bakery`),
      why: `Covers ${f}.`,
      f,
      hits: 0,
      kept: 0,
      read: 0,
      fnd: 0,
      ss: [],
    });
  }
  // each source found by one search of its round, sometimes again later
  for (const s of sources) {
    const own = searches.filter((q) => q.r === s.r);
    pickOf(own.length ? own : searches).ss.push(s.id);
    if (r() < 0.25) pickOf(searches.filter((q) => q.r >= s.r)).ss.push(s.id);
  }
  for (const q of searches) {
    q.ss = [...new Set(q.ss)];
    const ss = q.ss.map((id) => sources[id]).filter((s): s is GraphSource => !!s);
    q.kept = ss.reduce((a, s) => a + s.pages.length + s.unread.length, 0);
    q.hits = q.kept * 2 + Math.floor(r() * 8);
    q.read = ss.reduce((a, s) => a + s.pages.length, 0);
    q.fnd = ss.reduce((a, s) => a + s.kept, 0);
  }

  const dropped: GraphDrop[] = Array.from({ length: o.drops ?? 36 }, (_, i) => {
    const q = pickOf(searches);
    const h = `${pickOf(WORDS).toLowerCase()}${pickOf(ENDS).toLowerCase()}${i}.example`;
    return {
      id: `h${i}`,
      t: long(`${pickOf(WORDS)} ${pickOf(FACETS)} guide ${i + 1}`),
      u: `https://${h}/`,
      h,
      why: pickOf(WHY),
      r: q.r,
      q: [q.i],
      sn: long("A short snippet the search returned for this page."),
      s: r() < 0.2 ? null : Math.floor(r() * 100),
      f: r() < 0.3 ? null : [pickOf(["article", "video", "sales_page"]), Math.round(r() * 100)],
      k: pickOf(KINDS),
    };
  });

  const all = sources.flatMap((s) => s.fs);
  const claims = CLAIMS.slice(0, nC).map((t, i) => {
    const [head = t, rest = ""] = t.split(/:\s|;\s/);
    const ss = sources.filter((s) => (s.claims[i] ?? 0) > 0);
    return {
      i,
      n: i + 1,
      head: long(head),
      rest,
      findings: ss.reduce((a, s) => a + (s.claims[i] ?? 0), 0),
      sources: ss.length,
    };
  });
  const pages = sources.flatMap((s) => s.pages);
  return {
    rid: `run-${(o.seed ?? 7).toString(36)}cake`,
    t: long(
      "How do small bakeries price custom cakes, and what do they charge for deposits, rush and delivery?",
    ),
    note: "Stopped after three rounds: the last round found no new claim.",
    meta: "Nov 6 · 12 min · $0.41",
    rounds: nR,
    funnel: {
      hits: searches.reduce((a, q) => a + q.hits, 0),
      kept: sources.reduce((a, s) => a + s.pages.length + s.unread.length, 0),
      read: pages.length,
      withF: pages.filter((p) => p.kept).length,
      findings: all.length,
      used: sources.reduce((a, s) => a + s.used, 0),
      claims: nC,
    },
    claims,
    sources,
    searches,
    dropped,
  };
}

export const RUN_GRAPH = fakeRunGraph();
export const RUN_GRAPH_ONE_ROUND = fakeRunGraph({
  seed: 3,
  sources: 14,
  claims: 3,
  rounds: 1,
  searches: 4,
  drops: 6,
});
export const RUN_GRAPH_EMPTY = fakeRunGraph({
  seed: 1,
  sources: 0,
  claims: 0,
  rounds: 1,
  searches: 0,
  drops: 0,
});
export const RUN_GRAPH_WORST = fakeRunGraph({
  seed: 11,
  sources: 140,
  claims: 7,
  rounds: 5,
  searches: 40,
  drops: 400,
  worst: true,
});
