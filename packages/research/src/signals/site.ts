/**
 * Website changes (S7). A firm's first read is Wayback CDX: the newest digest change in the last
 * months, one signal. Every later read (30 days) reads the home page and up to 4 stored pages
 * (pricing, services, about, team, careers, case studies, work) and diffs each against its last
 * stored version. A changed page is a `site_change` finding whose document is the new version, so
 * `keepDocument` keeps a version only when its hash changed. Everything is kept; the read-time
 * view hides small or date-only changes from `lines_changed` and the added and removed lines.
 *
 * First or later: a later read has an earlier check that answered (found, none) or read pages.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { HTTP_TIER, robotsAllows, stripNul } from "../enrichment/crawler.js";
import { FetchError, type Fetcher, type FetchResponse } from "../fetch/fetcher.js";
import { readPage } from "../fetch/htmltext.js";
import type { RobotsCache } from "../fetch/robots.js";
import { pgSafe, type SignalDraft } from "../findings.js";
import { defineCollector, firmOf, subjectOf, type Tried } from "./index.js";

/** Pages worth a diff, by path, in the order they are picked. */
const PAGE_HINTS: readonly [string, RegExp][] = [
  ["pricing", /pric/i],
  ["services", /service/i],
  ["about", /about/i],
  ["team", /team/i],
  ["careers", /career|jobs/i],
  ["case studies", /case[-_]?stud/i],
  ["work", /work/i],
];
/** A page that fails this many times in a read is unresolved. */
const TRIES = 2;
const CDX = "https://web.archive.org/cdx/search/cdx";

interface Page {
  url: string;
  topic: string;
  /** Its last stored version; null for a page never stored. */
  prev: { id: number; text: string } | null;
}

type Row = { id: number; url: string; text: string };

export const site = defineCollector({
  name: "site",
  subject: "company",
  built: true,
  settings: z.object({
    /** Stored pages read beside the home page. */
    pages: z.number().int().min(0).max(10).default(4),
    /** The first read's Wayback window. */
    months: z.number().int().min(1).max(60).default(12),
    /** As the crawler: warn fetches a disallowed page and says so, enforce skips it. */
    robots: z.enum(["warn", "enforce"]).default("warn"),
  }),
  bucket: { perDay: 200, burst: 20 },
  everyDays: 30,
  metered: false,
  async collect(deps, subject, s) {
    const key = subjectOf(subject);
    const firm = key && "companyId" in key ? await firmOf(deps.db, key.companyId) : null;
    const unresolved = (what: string, outcome: string) => ({
      state: "unresolved" as const,
      signals: [],
      tried: [{ step: "firm", what, outcome }],
    });
    if (!firm?.domain) return unresolved(subject, firm ? "no domain" : "no such firm");
    if (!deps.fetcher) return unresolved(subject, "no fetcher");
    const fetcher = deps.fetcher;

    const [last] = await deps.db.execute<{ state: string; tried: Tried[]; checked_at: string }>(sql`
      select state, tried, checked_at from signal_checks
      where collector = 'site' and subject = ${subject}`);
    const later =
      last && (["found", "none"].includes(last.state) || last.tried.some((t) => t.step === "page"));

    if (!later) {
      const from = new Date(deps.now);
      from.setUTCMonth(from.getUTCMonth() - s.months);
      const url = `${CDX}?${new URLSearchParams({
        url: firm.domain,
        collapse: "digest",
        output: "json",
        from: from.toISOString().slice(0, 10).replaceAll("-", ""),
        filter: "statuscode:200",
      })}`;
      const tried: Tried[] = [];
      const resp = await read(fetcher, url, tried, "wayback");
      const rows = resp && cdxRows(resp.text);
      if (!rows) {
        if (resp) tried.push({ step: "wayback", what: url, outcome: "not a CDX answer" });
        return { state: "unresolved", signals: [], tried };
      }
      const change = newestChange(rows);
      tried.push({ step: "wayback", what: url, outcome: `${rows.length} captures` });
      if (!change) return { state: "none", signals: [], tried };
      const snapshot = `https://web.archive.org/web/${change.timestamp}/${change.original}`;
      const at = captured(change.timestamp);
      const signal: SignalDraft = {
        kind: "site_change",
        companyId: firm.id,
        factKey: `c${firm.id}:site_change:wayback:${change.digest}`,
        value: {
          title: `Site changed, archived ${at.toISOString().slice(0, 10)}`,
          topic: "home",
          page: change.original,
          digest: change.digest,
          captured: at.toISOString(),
          captures: rows.length,
        },
        confidence: 0.6,
        via: "wayback",
        sourceUrl: snapshot,
        document: {
          url,
          kind: "snippet",
          title: `wayback ${firm.domain}`,
          text: resp.text,
          fetchTier: "wayback",
        },
        signalAt: at,
        dated: "seen",
      };
      return { state: "found", signals: [signal], tried };
    }

    const pages = pick(
      await deps.db.execute<Row>(sql`
        select distinct on (d.url) d.id, d.url, d.text from documents d
        where d.kind = 'webpage' and d.text <> ''
          and d.url in (select url from documents where company_id = ${firm.id} and kind = 'webpage')
        order by d.url, d.fetched_at desc, d.id desc`),
      firm.domain,
      s.pages,
    );
    const tried: Tried[] = [];
    const signals: SignalDraft[] = [];
    const robots: RobotsCache = new Map();
    const counters = { robots_blocked: 0, robots_warned: 0, robots_disallowed_urls: [] };
    let failed = 0;
    for (const p of pages) {
      const { proceed, disallowed } = await robotsAllows(
        fetcher,
        p.url,
        robots,
        s.robots,
        counters,
      );
      if (!proceed) {
        tried.push({ step: "page", what: p.url, outcome: "robots: skipped" });
        continue;
      }
      const resp = await read(fetcher, p.url, tried, "page");
      if (!resp) {
        failed += 1;
        continue;
      }
      const html = stripNul(resp.text);
      const page = readPage(html, resp.url);
      const text = pgSafe(page.text);
      if (!text) {
        failed += 1;
        tried.push({ step: "page", what: p.url, outcome: "no text" });
        continue;
      }
      if (p.prev?.text === text) {
        tried.push({ step: "page", what: p.url, outcome: "unchanged" });
        continue;
      }
      const hash = createHash("sha256").update(text).digest("hex");
      // ponytail: url cut to 300 so the key fits varchar(400); two urls sharing 300 chars collide.
      const factKey = `c${firm.id}:site_change:${p.url.slice(0, 300)}:${hash}`;
      // A page back on a version already reported (A→B→A) stays one change, not one a month.
      const known = await deps.db.execute(sql`select 1 from findings where fact_key = ${factKey}`);
      if (known.length > 0) {
        tried.push({ step: "page", what: p.url, outcome: "unchanged: version already reported" });
        continue;
      }
      const { added, removed } = lineDiff(p.prev?.text ?? "", text);
      const changed = added.length + removed.length;
      tried.push({ step: "page", what: p.url, outcome: `changed: ${changed} lines` });
      signals.push({
        kind: "site_change",
        companyId: firm.id,
        factKey,
        value: {
          title: p.prev
            ? `${cap(p.topic)} page changed: ${changed} line${changed === 1 ? "" : "s"}`
            : `New ${p.topic} page`,
          topic: p.topic,
          page: p.url,
          added,
          removed,
          lines_changed: changed,
          new_page: !p.prev,
          since: last?.checked_at ? new Date(last.checked_at).toISOString() : null,
          previous_document_id: p.prev?.id ?? null,
          ...(disallowed ? { robots_disallowed: true } : {}),
        },
        confidence: 0.9,
        via: "site",
        sourceUrl: p.url,
        document: {
          url: p.url,
          kind: "webpage",
          title: page.title || null,
          text,
          fetchTier: HTTP_TIER,
        },
        signalAt: deps.now,
        dated: "seen",
      });
    }
    const state = signals.length ? "found" : failed ? "unresolved" : "none";
    return { state, signals, tried };
  },
});

/** A GET, tried twice; null when both fail. Each failure goes into `tried`. */
async function read(
  fetcher: Fetcher,
  url: string,
  tried: Tried[],
  step: string,
): Promise<FetchResponse | null> {
  for (let i = 0; i < TRIES; i++) {
    try {
      const resp = await fetcher.get(url);
      if (resp.status < 400) return resp;
      tried.push({ step, what: url, outcome: `HTTP ${resp.status}` });
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      tried.push({ step, what: url, outcome: err.message });
    }
  }
  return null;
}

/** The home page, then up to `n` stored pages by hint order. A home never stored is new. */
export function pick(rows: readonly Row[], domain: string, n: number): Page[] {
  const pathOf = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return null;
    }
  };
  const asPage = (r: Row, topic: string): Page => ({
    url: r.url,
    topic,
    prev: { id: Number(r.id), text: r.text },
  });
  const home = rows.find((r) => pathOf(r.url) === "/" || pathOf(r.url) === "");
  const out: Page[] = [
    home ? asPage(home, "home") : { url: `https://${domain}`, topic: "home", prev: null },
  ];
  const rest = rows.filter((r) => r !== home);
  for (const [topic, re] of PAGE_HINTS) {
    for (const r of rest) {
      if (out.length > n) return out;
      const path = pathOf(r.url);
      if (path && re.test(path) && !out.some((p) => p.url === r.url)) out.push(asPage(r, topic));
    }
  }
  return out;
}

type Capture = { timestamp: string; original: string; digest: string };

/** CDX JSON (a header row, then one row per capture) as captures; null when it isn't. */
export function cdxRows(body: string): Capture[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return [];
  const [head, ...rows] = parsed as string[][];
  const col = (name: string) => head?.indexOf(name) ?? -1;
  const [t, o, d] = [col("timestamp"), col("original"), col("digest")];
  if (t < 0 || o < 0 || d < 0) return null;
  return rows.map((r) => ({
    timestamp: String(r[t]),
    original: String(r[o]),
    digest: String(r[d]),
  }));
}

/**
 * The newest capture whose digest is new to the window. `collapse=digest` drops only repeats in a
 * row, and http and https captures of one page flap between two digests, so a digest seen earlier
 * is no change. The first capture is the baseline, never a change.
 */
export function newestChange(rows: readonly Capture[]): Capture | null {
  const seen = new Set<string>();
  let newest: Capture | null = null;
  for (const [i, r] of rows.entries()) {
    if (i > 0 && !seen.has(r.digest)) newest = r;
    seen.add(r.digest);
  }
  return newest;
}

/** A CDX timestamp (yyyyMMddhhmmss, UTC) as a date. */
export function captured(ts: string): Date {
  const t = ts.padEnd(14, "0");
  return new Date(
    `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}Z`,
  );
}

/** Whole lines in `next` and not `prev` (added), and the reverse (removed), counted as multisets. */
export function lineDiff(prev: string, next: string): { added: string[]; removed: string[] } {
  const lines = (t: string) => (t ? t.split("\n") : []);
  const minus = (a: string[], b: string[]) => {
    const left = new Map<string, number>();
    for (const l of b) left.set(l, (left.get(l) ?? 0) + 1);
    return a.filter((l) => {
      const n = left.get(l) ?? 0;
      if (n > 0) left.set(l, n - 1);
      return n === 0;
    });
  };
  const [p, n] = [lines(prev), lines(next)];
  return { added: minus(n, p), removed: minus(p, n) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
