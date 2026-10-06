/**
 * Tech stack (S4): which tools a firm runs, from the pages the crawl already stored and the
 * domain's DNS TXT and MX. No new page reads. One `stack` finding per (firm, tool), dated by the
 * page's fetch (`seen`). Switching is read-time: first seen, and a stale `observed_at`.
 */
import { Resolver } from "node:dns/promises";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { findBoards } from "../companies/boards.js";
import type { DocumentDraft } from "../findings.js";
import { htmlOf } from "../pages.js";
import { defineCollector, firmOf, type SignalDraft, subjectOf, type Tried } from "./index.js";
import { STACK_PRINTS, type StackCategory, type StackPrint } from "./stack-prints.js";

/** The two DNS reads, as `node:dns/promises` has them; tests pass a fake. */
export interface StackDns {
  resolveTxt(name: string): Promise<string[][]>;
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
}

export interface StackMatch {
  how: "script" | "meta" | "board" | "spf" | "txt" | "mx";
  match: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The host or a subdomain of it, in a URL or an address, and not a longer name. */
const hostIn = (host: string) => new RegExp(`(?:^|//|[./@])${esc(host)}(?![\\w-]|\\.\\w)`, "i");
const underHost = (name: string, host: string) => hostIn(host).test(name.replace(/\.$/, ""));
const META = /<meta\b[^>]*>/gi;

/** What one page shows of each print. */
export function pagePrints(
  html: string,
  prints: readonly StackPrint[] = STACK_PRINTS,
): Map<string, StackMatch[]> {
  const text = html.replace(/\\\//g, "/");
  const metas = text.match(META) ?? [];
  const out = new Map<string, StackMatch[]>();
  const add = (tool: string, m: StackMatch) => out.set(tool, [...(out.get(tool) ?? []), m]);
  for (const p of prints) {
    for (const h of p.scripts ?? [])
      if (hostIn(h).test(text)) add(p.tool, { how: "script", match: h });
    for (const re of p.meta ?? []) {
      const tag = metas.find((t) => re.test(t));
      if (tag) add(p.tool, { how: "meta", match: tag.slice(0, 300) });
    }
  }
  for (const b of findBoards(html)) add(b.ats.replace(/-eu$/, ""), { how: "board", match: b.page });
  return out;
}

/** What the domain's TXT and MX records show of each print. */
export function dnsPrints(
  txt: readonly string[],
  mx: readonly string[],
  prints: readonly StackPrint[] = STACK_PRINTS,
): Map<string, StackMatch[]> {
  const includes = txt
    .filter((r) => /^v=spf1\b/i.test(r))
    .flatMap((r) => [...r.matchAll(/\binclude:(\S+)/gi)].map((m) => m[1] as string));
  const out = new Map<string, StackMatch[]>();
  const add = (tool: string, m: StackMatch) => out.set(tool, [...(out.get(tool) ?? []), m]);
  for (const p of prints) {
    for (const i of includes)
      if ((p.spf ?? []).some((h) => underHost(i, h)))
        add(p.tool, { how: "spf", match: `include:${i}` });
    for (const r of txt)
      if ((p.txt ?? []).some((re) => re.test(r))) add(p.tool, { how: "txt", match: r });
    for (const e of mx)
      if ((p.mx ?? []).some((h) => underHost(e, h))) add(p.tool, { how: "mx", match: e });
  }
  return out;
}

/** The bare domain a firm's `domain` names. */
export const bareDomain = (d: string) =>
  d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0] ?? "";

export const dnsLink = (domain: string, type: "TXT" | "MX") =>
  `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;

const ATS_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
  bamboohr: "BambooHR",
};
function toolInfo(tool: string): { label: string; category: StackCategory } {
  const p = STACK_PRINTS.find((x) => x.tool === tool);
  return p ? p : { label: ATS_LABEL[tool] ?? tool, category: "ats" };
}

/** A DNS read: its records, or null when there is no answer (no domain, a failure). */
async function readDns<T>(
  tried: Tried[],
  what: string,
  read: () => Promise<T[]>,
): Promise<T[] | null> {
  try {
    const got = await read();
    tried.push({ step: "dns", what, outcome: `${got.length} records` });
    return got;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // The name exists with no records of this type: an answer, empty.
    if (code === "ENODATA") {
      tried.push({ step: "dns", what, outcome: "0 records" });
      return [];
    }
    tried.push({ step: "dns", what, outcome: `failed: ${code ?? (err as Error).message}` });
    return null;
  }
}

type FirmDraft = Extract<SignalDraft, { companyId: number }>;

type PageRow = {
  id: number;
  url: string;
  title: string | null;
  fetched_at: string | Date;
  html: string | null;
  html_key: string | null;
};

const defaultDns = (): StackDns => new Resolver({ timeout: 5_000, tries: 2 });

/** The collector over a resolver; `stack` is the one on real DNS. */
export function stackCollector(dns: () => StackDns = defaultDns) {
  return defineCollector({
    name: "stack",
    subject: "company",
    built: true,
    settings: z.object({
      /** Stored pages read per firm, newest first. */
      pages: z.number().int().positive().default(25),
      /** Read the domain's TXT and MX. */
      dns: z.boolean().default(true),
    }),
    bucket: { perDay: 1000, burst: 20 },
    everyDays: 30,
    metered: false,
    async collect(deps, subject, s) {
      const key = subjectOf(subject);
      const firm = key && "companyId" in key ? await firmOf(deps.db, key.companyId) : null;
      if (!firm)
        return {
          state: "unresolved",
          signals: [],
          tried: [{ step: "firm", what: subject, outcome: "no such firm" }],
        };
      const tried: Tried[] = [];
      const found = new Map<
        string,
        { draft: Omit<FirmDraft, "value">; evidence: (StackMatch & { page: string })[] }
      >();
      const note = (
        hits: Map<string, StackMatch[]>,
        page: string,
        source: Omit<FirmDraft, "value" | "factKey" | "kind" | "companyId">,
      ) => {
        for (const [tool, ms] of hits) {
          const had = found.get(tool);
          const evidence = ms.map((m) => ({ ...m, page }));
          if (had) had.evidence.push(...evidence);
          else
            found.set(tool, {
              draft: {
                kind: "stack",
                factKey: `c${firm.id}:stack:${tool}`,
                companyId: firm.id,
                ...source,
              },
              evidence,
            });
        }
      };

      const rows = await deps.db.execute<PageRow>(sql`
        select id, url, title, fetched_at, html, html_key from documents
        where company_id = ${firm.id} and kind = 'webpage'
          and (html is not null or html_key is not null)
        order by fetched_at desc, id desc
        limit ${s.pages}`);
      let read = 0;
      for (const r of rows) {
        // An archived page with no store to read it from is a page we cannot see, not a failure.
        const html = await htmlOf({ html: r.html, htmlKey: r.html_key }, deps.pages).catch(
          () => null,
        );
        if (html === null) continue;
        read += 1;
        const document: DocumentDraft = {
          url: r.url,
          kind: "webpage",
          title: r.title,
          // The crawl hashes the HTML, so this finds the crawl's own row.
          text: html,
          fetchTier: "stack",
        };
        note(pagePrints(html), r.url, {
          sourceUrl: r.url,
          document,
          via: "page",
          confidence: 0.9,
          signalAt: new Date(r.fetched_at),
          dated: "seen",
        });
      }
      tried.push({ step: "pages", what: `c${firm.id}`, outcome: `${read} of ${rows.length} read` });

      const domain = firm.domain ? bareDomain(firm.domain) : "";
      let answered = false;
      if (s.dns && domain) {
        const resolver = dns();
        const txt = await readDns(tried, `${domain} TXT`, () => resolver.resolveTxt(domain));
        const mx = await readDns(tried, `${domain} MX`, () => resolver.resolveMx(domain));
        answered = txt !== null || mx !== null;
        const txtLines = (txt ?? []).map((parts) => parts.join(""));
        const mxHosts = (mx ?? []).map((m) => m.exchange);
        const doc = (type: "TXT" | "MX", answer: unknown): DocumentDraft => ({
          url: dnsLink(domain, type),
          kind: "snippet",
          title: `${domain} ${type}`,
          text: JSON.stringify({ name: domain, type, answer }),
          fetchTier: "dns",
        });
        const hits = dnsPrints(txtLines, mxHosts);
        const byType = (mx: boolean) =>
          new Map(
            [...hits]
              .map(([t, ms]) => [t, ms.filter((m) => (m.how === "mx") === mx)] as const)
              .filter(([, ms]) => ms.length),
          );
        const at = { via: "dns", confidence: 0.9, signalAt: deps.now, dated: "seen" as const };
        const txtLink = dnsLink(domain, "TXT");
        const mxLink = dnsLink(domain, "MX");
        note(byType(false), txtLink, { ...at, sourceUrl: txtLink, document: doc("TXT", txtLines) });
        note(byType(true), mxLink, { ...at, sourceUrl: mxLink, document: doc("MX", mx ?? []) });
      }

      if (read === 0 && !answered) return { state: "unresolved", signals: [], tried };
      const signals: SignalDraft[] = [...found].map(([tool, f]) => {
        const { label, category } = toolInfo(tool);
        return {
          ...f.draft,
          value: {
            title: `Uses ${label}`,
            topic: category,
            tool,
            evidence: f.evidence,
            page: f.draft.sourceUrl,
          },
        };
      });
      return { state: signals.length ? "found" : "none", signals, tried };
    },
  });
}

export const stack = stackCollector();
