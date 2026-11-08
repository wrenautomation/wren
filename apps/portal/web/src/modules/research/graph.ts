/**
 * A birdwatch run view as the run graph's data (`@wren/ui/research/run`). Ported from the
 * artifact's builder (round 11 prep), so the page draws what the artifact drew. Mapped on read,
 * until the engine sends this shape itself (WA-1157).
 */
import type {
  Evidence,
  GraphDrop,
  GraphPage,
  GraphSource,
  RunGraphData,
  Speaker,
} from "@wren/ui/research/run";
import type { RunRow, RunView } from "./serve.js";

type Votes = Record<string, number> | undefined;

// who speaks: a paper is research whoever posts it; a video with no class is a person
const ACAD =
  /(\.edu|\.ac\.[a-z]+|arxiv\.org|acm\.org|springer|ieee|hal\.science|researchgate|sciencedirect|wiley|sagepub|oup\.com|frontiersin|ncbi|doi\.org|ceur-ws|d-nb\.info|academia\.edu|computer\.org|repositum|kops\.|libres\.|mspace\.lib|monash\.edu|tuwien|ucalgary|usask|cs\.au\.dk|aviz\.fr|inria|imld\.de|cvast)/;
const GOV =
  /(\.gov(\.[a-z]+)?$|\.gc\.ca$|europa\.eu$|who\.int$|oecd\.org$|un\.org$|\.mil$|census\.|bls\.gov|ons\.gov)/;
export const kindOf = (c: string | null, f: string | null, h: string): Speaker =>
  GOV.test(h)
    ? "public_body"
    : f === "paper" || (ACAD.test(h) && c !== "forum")
      ? "research"
      : c === "primary_data" || c === "survey" || c === "vendor"
        ? "company"
        : c === "practitioner"
          ? "person"
          : c === "forum"
            ? "forum"
            : c === "news"
              ? "press"
              : f === "video"
                ? "person"
                : "other";
export const evOf = (c: string | null, f: string | null): Evidence =>
  c === "primary_data"
    ? "data"
    : c === "survey" || f === "paper"
      ? "study"
      : c === "vendor"
        ? f === "docs"
          ? "analysis"
          : "promo"
        : c === "news"
          ? "report"
          : c === "practitioner" || c === "forum" || f === "video" || f === "thread" || f === "post"
            ? "account"
            : f === "docs" || f === "article"
              ? "analysis"
              : f === "sales_page"
                ? "promo"
                : "other";

const FMT: Record<string, string> = { sales_page: "sales page" };
const cap = (s: string) => (s ? (s[0]?.toUpperCase() ?? "") + s.slice(1) : s);
/** A claim's head and the rest: the first clause of 20 or more characters. */
export const split = (t: string): [string, string] => {
  const m = t.match(/^(.{20,}?)[:.;]\s+(.+)$/s);
  return m ? [m[1] ?? t, cap(m[2] ?? "")] : [t.replace(/\.$/, ""), ""];
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^(www|m|old)\./, "");
  } catch {
    return "?";
  }
};
const top = (o: Votes) => {
  const e = Object.entries(o ?? {}).sort((a, b) => b[1] - a[1])[0];
  return e && e[1] > 0 ? e : null;
};
const topK = (o: Votes) => top(o)?.[0] ?? null;
const ytOf = (u: string) => (/youtu/.test(u) ? (u.match(/[?&]v=([\w-]{11})/)?.[1] ?? null) : null);
const day = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One source per channel, subreddit or site. */
function skey(url: string, channel?: string): [string, string, GraphSource["site"]] {
  const h = host(url);
  if (channel && /youtu/.test(h)) return [`yt:${channel}`, channel, "youtube"];
  if (h.endsWith("reddit.com")) {
    const m = url.match(/\/r\/([^/]+)/);
    return m?.[1]
      ? [`rd:${m[1].toLowerCase()}`, `r/${m[1]}`, "reddit"]
      : ["site:reddit.com", "reddit.com", "reddit"];
  }
  return [`site:${h}`, h, "web"];
}
const icon = (h: string) => `https://icons.duckduckgo.com/ip3/${h}.ico`;
const thumb = (yt: string) => `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`;

interface Pattern {
  text?: string;
  t?: string;
  findings?: string[];
}
interface Brief {
  ask?: { text?: string };
  patterns?: Pattern[];
  cost?: { total?: { usd?: number } };
}

type Acc = Omit<GraphSource, "id" | "kind" | "fmt" | "icon" | "thumb" | "og" | "home"> & {
  key: string;
  cls: Record<string, number>;
  fmts: Record<string, number>;
  yts: (string | null)[];
};

export function runGraphOf(view: RunView, row?: RunRow | null): RunGraphData {
  const b = view.brief as Brief;
  const hitBy = new Map(view.hits.map((h) => [h.id, h]));
  const docOfHit = new Map(view.documents.map((d) => [d.hit, d]));
  const src = new Map<string, Acc>();
  const S = (key: string, name: string, site: GraphSource["site"]) => {
    let s = src.get(key);
    if (!s) {
      s = {
        key,
        name,
        site,
        cls: {},
        fmts: {},
        yts: [],
        pages: [],
        unread: [],
        kept: 0,
        used: 0,
        fs: [],
        claims: {},
        r: 99,
      };
      src.set(key, s);
    }
    return s;
  };
  const pageOf = new Map<string, [Acc, number]>();
  for (const d of view.documents) {
    const h = hitBy.get(d.hit);
    const [k, l, site] = skey(d.url, d.channel ?? h?.channel);
    const s = S(k, l, site);
    const pc = d.class ?? topK(d.judge?.class);
    const pf =
      topK(d.judge?.format) ??
      (ytOf(d.url) ? "video" : /reddit\.com/.test(d.url) ? "thread" : null);
    const c = kindOf(pc, topK(d.judge?.format), host(d.url));
    s.cls[c] = (s.cls[c] ?? 0) + 1;
    if (pf) s.fmts[pf] = (s.fmts[pf] ?? 0) + 1;
    const r = h?.round ?? 1;
    s.r = Math.min(s.r, r);
    pageOf.set(d.id, [s, s.pages.length]);
    const page: GraphPage = {
      t: d.title ?? d.url,
      u: d.url,
      d: d.date ?? null,
      len: d.length ?? 0,
      kept: 0,
      th: null,
      r,
      f: pf ?? "other",
      e: evOf(pc, pf),
    };
    s.pages.push(page);
    s.yts.push(ytOf(d.url));
  }
  // kept hits never read: the run's coverage gap
  for (const h of view.hits) {
    if (h.call?.verdict !== "keep" || docOfHit.has(h.id)) continue;
    const [k, l, site] = skey(h.url, h.channel);
    const s = S(k, l, site);
    const c = kindOf(topK(h.judge?.class), topK(h.judge?.format), host(h.url));
    if (!s.pages.length) s.cls[c] = (s.cls[c] ?? 0) + 0.5;
    s.r = Math.min(s.r, h.round ?? 1);
    s.unread.push({ t: h.title ?? h.url, u: h.url, r: h.round ?? 1 });
  }
  const pats = b.patterns ?? [];
  const pat = new Map<string, number>();
  pats.forEach((p, i) => {
    for (const f of p.findings ?? []) if (!pat.has(f)) pat.set(f, i);
  });
  let kept = 0;
  for (const f of view.findings) {
    if (!f.kept) continue;
    const w = pageOf.get(f.document);
    if (!w) continue;
    const [s, p] = w;
    const pg = s.pages[p];
    if (!pg) continue;
    const c = pat.get(f.id) ?? -1;
    const ck = f.checks.at(-1);
    s.fs.push({
      t: f.text,
      q: f.quote ?? "",
      e: pg.e,
      c,
      p,
      ok: ck ? (ck.ok ? 1 : 0) : -1,
      why: ck?.why ?? "",
    });
    s.kept++;
    pg.kept++;
    kept++;
    if (c >= 0) {
      s.used++;
      s.claims[c] = (s.claims[c] ?? 0) + 1;
    }
  }
  const sources: GraphSource[] = [...src.values()].map((s, id) => {
    s.pages.forEach((p, i) => {
      const yt = s.yts[i];
      if (yt && p.kept) p.th = thumb(yt);
    });
    const order = s.pages.map((p, i) => [p, i] as const).sort((a, b) => b[0].kept - a[0].kept);
    const best = order[0];
    if (best && !best[0].th && s.yts[best[1]]) best[0].th = thumb(s.yts[best[1]] as string);
    const fmt =
      topK(s.fmts) ?? (s.site === "youtube" ? "video" : s.site === "reddit" ? "thread" : "article");
    return {
      id,
      name: s.name,
      site: s.site,
      kind: (topK(s.cls) ?? "other") as Speaker,
      fmt,
      icon: icon(s.site === "web" ? s.name : s.site === "youtube" ? "youtube.com" : "reddit.com"),
      thumb: best?.[0].th ?? null,
      og: null,
      home:
        s.site === "web"
          ? `https://${s.name}`
          : s.site === "reddit"
            ? `https://www.reddit.com/${s.name}`
            : null,
      r: s.r === 99 ? 1 : s.r,
      pages: s.pages,
      unread: s.unread,
      kept: s.kept,
      used: s.used,
      fs: s.fs,
      claims: s.claims,
    };
  });
  const sid = new Map([...src.values()].map((s, i) => [s.key, i]));
  // each search: what it returned, what was kept and read, which sources it reached
  const qs = view.queries.filter((q) => q.hits.length);
  const searches = qs.map((q, i) => {
    const hs = q.hits.map((id) => hitBy.get(id)).filter((h) => !!h);
    const keptH = hs.filter((h) => h.call?.verdict === "keep");
    const readD = hs.map((h) => docOfHit.get(h.id)).filter((d) => !!d);
    const readIds = new Set(readD.map((d) => d.id));
    const reach = new Set<number>();
    for (const h of keptH) {
      const d = docOfHit.get(h.id);
      const n = sid.get(skey(d ? d.url : h.url, d?.channel ?? h.channel)[0]);
      if (n != null) reach.add(n);
    }
    return {
      i,
      r: q.round || 1,
      t: q.terms,
      why: q.why || "",
      f: q.facet ?? "",
      hits: hs.length,
      kept: keptH.length,
      read: readD.length,
      fnd: view.findings.filter((f) => f.kept && readIds.has(f.document)).length,
      ss: [...reach],
    };
  });
  const qi = new Map(qs.map((q, i) => [q.id, i]));
  const dropped: GraphDrop[] = view.hits
    .filter((h) => h.call?.verdict === "drop")
    .map((h) => {
      const f = top(h.judge?.format);
      const c = topK(h.judge?.class);
      const subject = h.judge?.side?.subject;
      return {
        id: h.id,
        t: h.title ?? h.url,
        u: h.url,
        h: host(h.url),
        why: h.call?.why ?? "no reason given",
        r: h.round || 1,
        q: h.queries.map((x) => qi.get(x)).filter((x): x is number => x != null),
        sn: h.snippet ?? "",
        s: subject != null ? Math.round(subject * 100) : null,
        f: f ? [FMT[f[0]] ?? f[0].replace(/_/g, " "), Math.round(f[1] * 100)] : null,
        k: kindOf(c, f?.[0] ?? null, host(h.url)),
      };
    });
  const claims = pats.map((p, i) => {
    const [head, rest] = split(p.text ?? p.t ?? "");
    const back = sources.filter((s) => s.claims[i]);
    return {
      i,
      n: i + 1,
      head,
      rest,
      findings: back.reduce((a, s) => a + (s.claims[i] ?? 0), 0),
      sources: back.length,
    };
  });
  const withF = new Set(view.findings.filter((f) => f.kept).map((f) => f.document));
  const usd = b.cost?.total?.usd ?? view.spend.reduce((a, s) => a + s.usd, 0);
  const started = view.timeline[0]?.at ?? view.queries[0]?.at ?? row?.started;
  return {
    rid: view.run,
    t: b.ask?.text ?? row?.ask ?? view.run,
    note: row?.note ?? "",
    meta: [started ? day(started) : "", `$${usd.toFixed(2)}`].filter(Boolean).join(" · "),
    rounds: Math.max(1, ...view.queries.map((q) => q.round || 1)),
    funnel: {
      hits: view.hits.length,
      kept: view.hits.filter((h) => h.call?.verdict === "keep").length,
      read: view.documents.length,
      withF: view.documents.filter((d) => withF.has(d.id)).length,
      findings: kept,
      used: sources.reduce((a, s) => a + s.used, 0),
      claims: claims.length,
    },
    claims,
    sources,
    searches,
    dropped,
  };
}
