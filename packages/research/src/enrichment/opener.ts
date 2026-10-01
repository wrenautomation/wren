/**
 * One personal line per company for the top of an email: a specific, checkable
 * thing from the firm's own site. The model proposes {line, quote, source_url};
 * code keeps the line only when the quote is on that page word for word, every
 * number in the line is in the quote, and the line is short and plain. No line is
 * a fine answer: the template's group drops the paragraph.
 *
 * One row per (company, model, prompt version), whatever the answer, so a re-run
 * only pays for new firms. A parse failure is retried; a "no line" is not.
 */
import { companies, inPlay, leads } from "@wren/core";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, LlmError, type Tracer } from "@wren/llm";
import { and, asc, desc, eq, exists, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type EvidencePage, foldText, numbersQuoted, pageQuoted, words } from "../grounding.js";
import { documents, enrichments } from "../schema.js";
import type { Shard } from "./shard.js";
import { upsertEnrichment } from "./store.js";

export { type EvidencePage, foldText } from "../grounding.js";

export const OPENER_VERSION = "v1";
export const OPENER_MAX_WORDS = 25;
const PAGE_CHARS = 3500;
const EVIDENCE_CHARS = 10000;
const MAX_TOKENS = 1024;

const PROMPT = `Write the first line of a cold email to the owner of {company}. The line shows we read their website.

Return ONLY a JSON object, no prose, exactly this shape:
{"line": "..." or null, "quote": "..." or null, "source_url": "..." or null}

Rules:
- line: one sentence, at most ${OPENER_MAX_WORDS} words, spoken to them ("you", "your"). Plain words a person says out loud. It names ONE specific thing about this company: a specialty, a market they serve, a year, a milestone, a way they work.
- Specific means it could not be said about most other companies. "You put people first" or "you're committed to quality" is not specific.
- A fact, not their marketing. Never repeat a slogan or a claim about quality (trusted, top-tier, leading, compassionate, innovative). Good: what they place, for whom, where, since when.
- No praise words (impressive, amazing, great, love), no questions, no exclamation marks, no dashes, nothing about us or what we sell.
- Never mention who owns the company or the owners' gender, race, ethnicity, religion, age, veteran or disability status (no "woman-owned", "veteran-owned", "minority-owned").
- quote: the exact words from ONE page below that the line rests on, copied character for character, 5 to 40 words.
- source_url: that page's URL, exactly as written after "===".
- Every number in the line must appear in the quote.
- Nothing specific on the pages: return {"line": null, "quote": null, "source_url": null}.

Company: {company}

PAGES:
{pages}
`;

const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const OpenerProposal = z.object({
  line: nullableString,
  quote: nullableString,
  source_url: nullableString,
});
export type OpenerProposal = z.infer<typeof OpenerProposal>;

export interface Opener {
  line: string;
  quote: string;
  source_url: string;
}

export interface SitePage {
  url: string;
  text: string;
  fetchedAt: Date;
}

const ABOUT =
  /about|story|history|who-we-are|our-firm|our-company|company|mission|leadership|team/i;

/** 0 = homepage, 1 = about-like, 2 = the rest. */
function pageRank(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return 2;
  }
  if (path === "/" || path === "") return 0;
  return ABOUT.test(path) ? 1 : 2;
}

/**
 * The pages the model reads: newest copy per URL, homepage first, then about-like
 * pages, each cut to a few thousand characters, until the budget is spent.
 */
export function openerEvidence(pages: readonly SitePage[]): EvidencePage[] {
  const newest = new Map<string, SitePage>();
  for (const p of pages) {
    const seen = newest.get(p.url);
    if (!p.text.trim()) continue;
    if (!seen || p.fetchedAt > seen.fetchedAt) newest.set(p.url, p);
  }
  const ordered = [...newest.values()].sort(
    (a, b) => pageRank(a.url) - pageRank(b.url) || a.url.localeCompare(b.url),
  );
  const out: EvidencePage[] = [];
  let used = 0;
  for (const p of ordered) {
    if (used >= EVIDENCE_CHARS) break;
    const text = p.text.slice(0, Math.min(PAGE_CHARS, EVIDENCE_CHARS - used));
    out.push({ url: p.url, text });
    used += text.length;
  }
  return out;
}

export function buildOpenerPrompt(company: string, pages: readonly EvidencePage[]): string {
  const body = pages.map((p) => `=== ${p.url}\n${p.text}`).join("\n\n");
  // Function replacers: a "$&" in page text is text, not a replacement pattern.
  return PROMPT.replaceAll("{company}", () => company).replace("{pages}", () => body);
}

/** A capitalized word that starts a sentence, or is "I" or "I've", names nothing. */
const I_WORD = /^I(['’](m|ve|d|ll))?$/;

/** Capitalized words past each sentence's first: places, clients, brands. Each must be on a page. */
const names = (line: string): string[] => {
  const tokens = line.split(/\s+/).filter(Boolean);
  return tokens
    .filter((_, i) => i > 0 && !/[.:;]$/.test(tokens[i - 1] ?? ""))
    .flatMap((t) => t.split(/[-/‒–—―.]/))
    .map((w) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "").replace(/['’ʼ]s$/, ""))
    .filter((w) => w.length > 1 && /^\p{Lu}/u.test(w) && !I_WORD.test(w));
};

/** Every word on the pages (and in the company's name), possessives dropped. */
const pageWords = (texts: readonly string[]): Set<string> =>
  new Set(
    foldText(texts.join(" "))
      .split(/[^\p{L}\d']+/u)
      .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
      .filter(Boolean),
  );

export type OpenerRejection =
  | "too_long"
  | "style"
  | "no_quote"
  | "quote_not_found"
  | "number_not_in_quote"
  | "name_not_on_page"
  | "ownership"
  | "puffery";

/** Who owns the firm ("woman-owned", "veteran-led") is never the opener, whatever the page says. */
const OWNERSHIP =
  /\bowned\b|\b(wom[ae]n|female|minority|veteran|disabled|black|hispanic|latin[oax]|asian|indigenous|lgbtq?)[- ](led|founded|run)\b/i;

/** Marketing claims the model copies off the page: their slogan, not a fact about them. */
const PUFFERY =
  /\b(trusted|top[- ]tier|leading|premier|world[- ]class|innovative|cutting[- ]edge|compassionate|exceptional|unparalleled|unmatched|excellence|passionate|seamless|igniting)\b/i;

/**
 * Keep the proposed line only if it stands on a real quote (whole, or sentence by
 * sentence from one page). The quote is looked for
 * on the named page first, then on any page shown (a wrong URL is fixed, not fatal).
 * Every number in the line must be in the quote, and every capitalized name on a
 * page or in the company's own name. A line about who owns the firm, or one
 * repeating its marketing, is dropped however well it is quoted.
 */
export function groundOpener(
  proposal: OpenerProposal,
  pages: readonly EvidencePage[],
  companyName = "",
): { opener: Opener | null; rejected: OpenerRejection | null } {
  const line = (proposal.line ?? "").trim();
  if (!line) return { opener: null, rejected: null };
  if (words(line) > OPENER_MAX_WORDS) return { opener: null, rejected: "too_long" };
  if (/[!?‒–—―\n]|--|\s-\s/.test(line)) return { opener: null, rejected: "style" };
  if (OWNERSHIP.test(line)) return { opener: null, rejected: "ownership" };
  if (PUFFERY.test(line)) return { opener: null, rejected: "puffery" };
  const quote = (proposal.quote ?? "").trim();
  if (words(quote) < 3) return { opener: null, rejected: "no_quote" };
  const source = pageQuoted(quote, pages, proposal.source_url);
  if (!source) return { opener: null, rejected: "quote_not_found" };
  if (!numbersQuoted(line, quote)) return { opener: null, rejected: "number_not_in_quote" };
  const onPage = pageWords([companyName, ...pages.map((p) => p.text)]);
  if (names(line).some((n) => !onPage.has(foldText(n))))
    return { opener: null, rejected: "name_not_on_page" };
  return { opener: { line, quote, source_url: source.url }, rejected: null };
}

export interface OpenerSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
}

/**
 * Companies to write a line for: a stored, non-shell page to read, a lead that can
 * still be mailed, and no finished row for this model and version.
 */
export async function selectOpenerTargets(
  db: Queryable,
  llm: LlmClient,
  opts: OpenerSelectOptions = {},
): Promise<number[]> {
  const done = db
    .select({ id: enrichments.companyId })
    .from(enrichments)
    .where(
      and(
        eq(enrichments.kind, "opener"),
        eq(enrichments.model, llm.name),
        eq(enrichments.promptVersion, OPENER_VERSION),
        sql`${enrichments.output}->>'parse_error' IS NULL`,
      ),
    );
  const hasPage = db
    .select({ one: sql`1` })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companies.id),
        eq(documents.kind, "webpage"),
        eq(documents.isShell, false),
        sql`btrim(${documents.text}) <> ''`,
      ),
    );
  const mailable = db
    .select({ one: sql`1` })
    .from(leads)
    .where(and(eq(leads.companyId, companies.id), inArray(leads.status, ["imported", "verified"])));
  const conditions = [notInArray(companies.id, done), exists(hasPage), exists(mailable), inPlay];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  if (opts.shard) conditions.push(opts.shard.where(companies.id));
  const q = db
    .select({ id: companies.id })
    .from(companies)
    .where(and(...conditions))
    .orderBy(asc(companies.id));
  const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
  return rows.map((r) => r.id);
}

export interface OpenerUnitOptions {
  runId?: string | null | undefined;
  tracer?: Tracer | null | undefined;
}

export type OpenerOutcome =
  | "written"
  | "no_line"
  | "rejected"
  | "parse_error"
  | "provider_rejected"
  | "no_pages";

/**
 * One completion for one company, stored whatever the answer. Throws LlmError on a
 * provider failure (the caller decides to abort).
 */
export async function writeOpener(
  db: Queryable,
  llm: LlmClient,
  companyId: number,
  opts: OpenerUnitOptions = {},
): Promise<{ outcome: OpenerOutcome; rejected: OpenerRejection | null }> {
  const [company] = await db
    .select({ name: companies.name, domain: companies.domain })
    .from(companies)
    .where(eq(companies.id, companyId));
  const stored = await db
    .select({ url: documents.url, text: documents.text, fetchedAt: documents.fetchedAt })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.kind, "webpage"),
        eq(documents.isShell, false),
      ),
    )
    .orderBy(desc(documents.fetchedAt));
  const pages = openerEvidence(stored);
  if (!company || pages.length === 0) return { outcome: "no_pages", rejected: null };
  const name = company.name || company.domain || `company ${companyId}`;
  const result = await completeAndParse(llm, buildOpenerPrompt(name, pages), OpenerProposal, {
    maxTokens: MAX_TOKENS,
    runId: opts.runId ?? null,
    tracer: opts.tracer ?? null,
    name: "opener",
    metadata: { company_id: companyId, pages: pages.map((p) => p.url) },
  });
  const grounded = result.parsed ? groundOpener(result.parsed, pages, name) : null;
  await upsertEnrichment(db, {
    companyId,
    kind: "opener",
    model: llm.name,
    promptVersion: OPENER_VERSION,
    output: result.envelope({
      parsed: result.parsed,
      opener: grounded?.opener ?? null,
      rejected: grounded?.rejected ?? null,
      pages: pages.map((p) => p.url),
    }),
    runId: opts.runId ?? null,
  });
  if (result.providerRejected) return { outcome: "provider_rejected", rejected: null };
  if (!grounded) return { outcome: "parse_error", rejected: null };
  if (grounded.opener) return { outcome: "written", rejected: null };
  return grounded.rejected
    ? { outcome: "rejected", rejected: grounded.rejected }
    : { outcome: "no_line", rejected: null };
}

export interface OpenerStats {
  selected: number;
  written: number;
  no_line: number;
  rejected: Partial<Record<OpenerRejection, number>>;
  parse_errors: number;
  provider_rejected: number;
  no_pages: number;
  aborted: string | null;
}

export const emptyOpenerStats = (selected: number): OpenerStats => ({
  selected,
  written: 0,
  no_line: 0,
  rejected: {},
  parse_errors: 0,
  provider_rejected: 0,
  no_pages: 0,
  aborted: null,
});

export function countOpener(
  stats: OpenerStats,
  unit: { outcome: OpenerOutcome; rejected: OpenerRejection | null },
): void {
  if (unit.outcome === "written") stats.written += 1;
  else if (unit.outcome === "no_line") stats.no_line += 1;
  else if (unit.outcome === "parse_error") stats.parse_errors += 1;
  else if (unit.outcome === "provider_rejected") stats.provider_rejected += 1;
  else if (unit.outcome === "no_pages") stats.no_pages += 1;
  else if (unit.rejected) stats.rejected[unit.rejected] = (stats.rejected[unit.rejected] ?? 0) + 1;
}

/** One completion per selected company, each in its own transaction. A provider failure aborts with progress kept. */
export async function runOpener(
  db: Queryable,
  llm: LlmClient,
  opts: OpenerSelectOptions & OpenerUnitOptions = {},
): Promise<OpenerStats> {
  const ids = await selectOpenerTargets(db, llm, opts);
  const stats = emptyOpenerStats(ids.length);
  for (const id of ids) {
    try {
      countOpener(stats, await db.transaction((tx) => writeOpener(tx, llm, id, opts)));
    } catch (err) {
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
  }
  return stats;
}
