/**
 * Weaver as a tree (designs/2026-11-12-explorer.md D4): `weaver/<run>/pages/<doc>/<finding>`,
 * `weaver/<run>/queries/<query>` (the pages it hit, as aliases). A page's `hit-by` holds its
 * queries; a run's `grew-from` / `grew-into` its rounds. Map edges: `grew-into` (run → run) and
 * `hits` (query → page, open runs only: each costs the run's view). Reads only through a `WeaverSource`:
 * `weaver serve` on the Mac (the browser, the CLI) or fixtures in a story. Browser-safe: core only.
 * One adapter per request: runs and views load once.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PAGE_SIZE,
  type Page,
  type PathEdge,
  PathError,
  pageOf,
  relationRow,
  segments,
  type Whole,
} from "@wren/core/paths";

const ROOT = "weaver";

/** One run as `weaver serve` lists it (`/runs`): the fields the tree reads. */
export interface WeaverRun {
  run: string;
  ask: string;
  parent: string | null;
  updated: string;
  documents: number;
  kept: number;
}
export interface WeaverQuery {
  id: string;
  round: number;
  terms: string;
  why: string;
  site?: string;
  hits: string[];
}
export interface WeaverHit {
  id: string;
  document?: string;
}
export interface WeaverDocument {
  id: string;
  hit: string;
  url: string;
  title?: string;
  channel?: string;
  media: string;
  image?: string;
  date?: string;
}
export interface WeaverFinding {
  id: string;
  document: string;
  text: string;
  quote?: string;
  kept: boolean;
}
/** One run's records (`/runs/<run>`, view v1). */
export interface WeaverView {
  run: string;
  queries: WeaverQuery[];
  hits: WeaverHit[];
  documents: WeaverDocument[];
  findings: WeaverFinding[];
}
/** A stored page's text (`/runs/<run>/documents/<doc>`). */
export interface WeaverPage {
  id: string;
  url: string;
  title: string | null;
  media: string;
  text: string;
}

/**
 * What the tree reads. A read that cannot reach `weaver serve` rejects with PathError `offline`;
 * a run or page it does not hold, `unknown-path`.
 */
export interface WeaverSource {
  runs(): Promise<WeaverRun[]>;
  view(run: string): Promise<WeaverView>;
  page(run: string, doc: string): Promise<WeaverPage>;
}

/** `weaver serve`'s default address on the Mac (engine `packages/weaver/src/app/serve.ts`). */
const WEAVER_SERVE = "http://127.0.0.1:4747";

/**
 * A WeaverSource over `weaver serve`, for the browser and the CLI. No answer: `offline`; a 404:
 * `unknown-path`.
 */
export function weaverServe(base = WEAVER_SERVE, get: typeof fetch = fetch): WeaverSource {
  const read = async <T>(path: string): Promise<T> => {
    let r: Response;
    try {
      r = await get(`${base}${path}`);
    } catch {
      throw new PathError("offline", `weaver serve does not answer at ${base}`);
    }
    const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (r.status === 404)
      throw new PathError("unknown-path", body?.error ?? `weaver has no ${path}`);
    if (!r.ok || !body) throw new Error(body?.error ?? `weaver serve answered ${r.status}`);
    return body;
  };
  const at = (...parts: string[]) => parts.map(encodeURIComponent).join("/");
  return {
    runs: () => read<{ runs: WeaverRun[] }>("/runs").then((a) => a.runs),
    view: (run) => read<WeaverView>(`/runs/${at(run)}`),
    page: (run, doc) => read<WeaverPage>(`/runs/${at(run)}/documents/${at(doc)}`),
  };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const memo = <V>(load: (k: string) => Promise<V>) => {
  const m = new Map<string, Promise<V>>();
  return (k: string) => {
    let p = m.get(k);
    if (!p) {
      p = load(k);
      m.set(k, p);
    }
    return p;
  };
};

/** One run's records, indexed for the tree. */
interface Indexed {
  v: WeaverView;
  doc: Map<string, WeaverDocument>;
  /** a page's findings, in the view's order */
  found: Map<string, WeaverFinding[]>;
  /** a page's queries: those whose hits hold its hit */
  hitBy: Map<string, WeaverQuery[]>;
  /** a query's pages: its hits that were read */
  pagesOf: Map<string, WeaverDocument[]>;
}

function indexOf(v: WeaverView): Indexed {
  const doc = new Map(v.documents.map((d) => [d.id, d]));
  const docOfHit = new Map(v.hits.flatMap((h) => (h.document ? [[h.id, h.document]] : [])));
  for (const d of v.documents) docOfHit.set(d.hit, d.id);
  const found = new Map<string, WeaverFinding[]>();
  for (const f of v.findings) found.set(f.document, [...(found.get(f.document) ?? []), f]);
  const hitBy = new Map<string, WeaverQuery[]>();
  const pagesOf = new Map<string, WeaverDocument[]>();
  for (const q of v.queries) {
    const docs = [...new Set(q.hits.flatMap((h) => docOfHit.get(h) ?? []))].flatMap(
      (id) => doc.get(id) ?? [],
    );
    pagesOf.set(q.id, docs);
    for (const d of docs) hitBy.set(d.id, [...(hitBy.get(d.id) ?? []), q]);
  }
  return { v, doc, found, hitBy, pagesOf };
}

/** the row a run shows as, here and in a folder */
export const runRow = (r: WeaverRun): Item => ({
  path: join(ROOT, r.run),
  name: r.ask,
  sub: `${r.run} · ${r.documents} pages, ${r.kept} kept`,
  kind: "run",
});

export function weaverTree(src: WeaverSource): Adapter {
  let runsP: Promise<Map<string, WeaverRun>> | undefined;
  const runs = () => {
    runsP ??= src.runs().then((rs) => new Map(rs.map((r) => [r.run, r])));
    return runsP;
  };
  const runOf = async (id: string) => {
    const r = (await runs()).get(id);
    if (!r) throw new PathError("unknown-path", `Weaver has no run ${id}`);
    return r;
  };
  const view = memo(async (id: string) => {
    await runOf(id);
    return indexOf(await src.view(id));
  });

  const pageRow = (run: string, x: Indexed, d: WeaverDocument): Item => {
    const n = x.found.get(d.id)?.length ?? 0;
    return {
      path: join(ROOT, run, "pages", d.id),
      name: d.title ?? d.url,
      sub: d.channel ? `${d.channel} · ${hostOf(d.url)}` : hostOf(d.url),
      kind: "page",
      ...(n ? { count: n } : {}),
      ...(d.image ? { poster: d.image } : {}),
    };
  };
  const queryRow = (run: string, x: Indexed, q: WeaverQuery): Item => ({
    path: join(ROOT, run, "queries", q.id),
    name: q.terms,
    sub: [q.site ? `site ${q.site}` : null, `round ${q.round}`, `${q.hits.length} hits`]
      .filter(Boolean)
      .join(" · "),
    kind: "query",
    count: x.pagesOf.get(q.id)?.length ?? 0,
  });
  const findingRow = (run: string, f: WeaverFinding): Item => ({
    path: join(ROOT, run, "pages", f.document, f.id),
    name: f.text,
    sub: f.id,
    kind: "finding",
    ...(f.kept ? {} : { mark: "dropped" }),
    leaf: true,
  });
  const docOf = (x: Indexed, id: string) => {
    const d = x.doc.get(id);
    if (!d) throw new PathError("unknown-path", `${x.v.run} read no page ${id}`);
    return d;
  };
  const queryOf = (x: Indexed, id: string) => {
    const q = x.v.queries.find((y) => y.id === id);
    if (!q) throw new PathError("unknown-path", `${x.v.run} ran no query ${id}`);
    return q;
  };
  /** runs one round on (grew-into) or the run it came from (grew-from) */
  const rounds = async (r: WeaverRun) => {
    const all = [...(await runs()).values()];
    const from = r.parent ? all.filter((x) => x.run === r.parent) : [];
    return { from: from.map(runRow), into: all.filter((x) => x.parent === r.run).map(runRow) };
  };

  const children = async (path: string, after?: string): Promise<Page> => {
    const [root, run, area, a, b] = segments(path);
    if (root !== ROOT) throw new PathError("unknown-path", `not a Weaver path: ${path}`);
    if (!run) {
      const all = [...(await runs()).values()].sort((x, y) => y.updated.localeCompare(x.updated));
      return pageOf(all.map(runRow), after);
    }
    const r = await runOf(run);
    const base = join(ROOT, run);
    if (!area) {
      const x = await view(run);
      const g = await rounds(r);
      return {
        items: [
          { path: join(base, "pages"), name: "Pages", kind: "layer", count: x.v.documents.length },
          {
            path: join(base, "queries"),
            name: "Queries",
            kind: "layer",
            count: x.v.queries.length,
          },
          ...relationRow(base, "grew-from", g.from),
          ...relationRow(base, "grew-into", g.into),
        ],
      };
    }
    if (area === "grew-from" || area === "grew-into") {
      if (a) throw new PathError("unknown-path", `${path} is an alias: read it at its home`);
      const g = await rounds(r);
      return { items: (area === "grew-from" ? g.from : g.into).map((t) => aliasOf(path, t)) };
    }
    const x = await view(run);
    if (area === "pages") {
      if (!a)
        return pageOf(
          x.v.documents.map((d) => pageRow(run, x, d)),
          after,
        );
      const d = docOf(x, a);
      const at = join(base, "pages", d.id);
      const queries = (x.hitBy.get(d.id) ?? []).map((q) => queryRow(run, x, q));
      // one page: a page's findings are few, and linksOf reads the first page only
      if (!b)
        return {
          items: [
            ...(x.found.get(d.id) ?? []).map((f) => findingRow(run, f)),
            ...relationRow(at, "hit-by", queries),
          ],
        };
      if (b === "hit-by" && segments(path).length === 5)
        return { items: queries.map((q) => aliasOf(join(at, "hit-by"), q)) };
      throw new PathError("unknown-path", `${path} holds nothing`);
    }
    if (area === "queries") {
      if (!a)
        return pageOf(
          x.v.queries.map((q) => queryRow(run, x, q)),
          after,
        );
      const q = queryOf(x, a);
      if (b) throw new PathError("unknown-path", `${path} is an alias: read it at its home`);
      const at = join(base, "queries", q.id);
      return pageOf(
        (x.pagesOf.get(q.id) ?? []).map((d) => aliasOf(at, pageRow(run, x, d))),
        after,
      );
    }
    throw new PathError("unknown-path", `a run holds no ${area}`);
  };

  const adapter: Adapter = {
    root: ROOT,
    children,
    edges: async (at, open) => {
      const inside = (p: string) => p === at || p.startsWith(`${at}/`);
      const all = await runs();
      const out: PathEdge[] = [];
      for (const r of all.values())
        if (r.parent && all.has(r.parent)) {
          const from = join(ROOT, r.parent);
          const to = join(ROOT, r.run);
          out.push({ id: `grew-into:${from}>${to}`, from, to, rel: "grew-into" });
        }
      // a view is up to ~10 MB: a closed run's hits would only count as inside it
      const want = [...all.keys()].filter((run) => {
        const p = join(ROOT, run);
        return (!open || open.has(p)) && (inside(p) || at.startsWith(`${p}/`));
      });
      const views = await Promise.all(want.map(async (run) => ({ run, x: await view(run) })));
      for (const { run, x } of views)
        for (const q of x.v.queries) {
          const from = join(ROOT, run, "queries", q.id);
          for (const d of x.pagesOf.get(q.id) ?? []) {
            const to = join(ROOT, run, "pages", d.id);
            out.push({ id: `hits:${from}>${to}`, from, to, rel: "hits" });
          }
        }
      return out.filter((e) => inside(e.from) || inside(e.to));
    },
    item: async (path) => {
      const segs = segments(path);
      const [root, run, area, a, b] = segs;
      if (root !== ROOT) throw new PathError("unknown-path", `not a Weaver path: ${path}`);
      if (!run) return { path: ROOT, name: "Weaver", kind: "root" };
      const r = await runOf(run);
      if (!area) return runRow(r);
      const x = await view(run);
      if ((area === "pages" || area === "queries") && segs.length === 3)
        return {
          path,
          name: area === "pages" ? "Pages" : "Queries",
          kind: "layer",
          count: area === "pages" ? x.v.documents.length : x.v.queries.length,
        };
      // straight reads: no list to page through
      if (area === "pages" && a && segs.length === 4) return pageRow(run, x, docOf(x, a));
      if (area === "pages" && a && b && b !== "hit-by" && segs.length === 5) {
        const f = (x.found.get(a) ?? []).find((y) => y.id === b);
        if (!f) throw new PathError("unknown-path", `page ${a} holds no finding ${b}`);
        return findingRow(run, f);
      }
      if (area === "queries" && a && segs.length === 4) return queryRow(run, x, queryOf(x, a));
      return itemFromParent(adapter, path);
    },
    whole: async (path) => {
      const it = await adapter.item(path);
      const [, run, area, a, b] = segments(it.path);
      const out: Whole = { ...it, links: await linksOf(adapter, it) };
      if (!run) return out;
      const r = await runOf(run);
      if (!area) {
        const x = await view(run);
        return {
          ...out,
          body: r.ask,
          data: {
            run: r,
            queries: x.v.queries.length,
            pages: x.v.documents.length,
            findings: x.v.findings.length,
            kept: x.v.findings.filter((f) => f.kept).length,
          },
        };
      }
      const x = await view(run);
      if (area === "pages" && a && it.kind === "page") {
        const d = docOf(x, a);
        const p = await src.page(run, a);
        return { ...out, body: p.text, data: { document: d, findings: x.found.get(a) ?? [] } };
      }
      if (area === "pages" && a && b && it.kind === "finding") {
        const f = (x.found.get(a) ?? []).find((y) => y.id === b);
        return { ...out, body: f?.text ?? "", data: { finding: f, document: x.doc.get(a) } };
      }
      if (area === "queries" && a && it.kind === "query") {
        const q = queryOf(x, a);
        return { ...out, body: q.why, data: q };
      }
      return out;
    },
    find: async (q, under) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const has = (...texts: (string | undefined)[]) => {
        const t = texts.filter(Boolean).join(" ").toLowerCase();
        return words.every((w) => t.includes(w));
      };
      const [, run] = segments(under ?? ROOT);
      // the root finds runs by their ask; a run finds inside its records
      if (!run) return [...(await runs()).values()].filter((r) => has(r.ask, r.run)).map(runRow);
      const x = await view(run);
      return [
        ...x.v.queries.filter((y) => has(y.terms, y.why)).map((y) => queryRow(run, x, y)),
        ...x.v.documents.filter((d) => has(d.title, d.url)).map((d) => pageRow(run, x, d)),
        ...x.v.findings.filter((f) => has(f.text, f.quote)).map((f) => findingRow(run, f)),
      ].slice(0, PAGE_SIZE);
    },
    stamp: async () => {
      const all = [...(await runs()).values()];
      return {
        root: ROOT,
        updated:
          all
            .map((r) => r.updated)
            .sort()
            .at(-1) ?? null,
      };
    },
  };
  return adapter;
}
