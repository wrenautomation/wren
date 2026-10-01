/**
 * The model's side of a study: plan an angle into searches, read an angle's
 * pages into claims. Prompts, answer shapes and the claim gate; pure.
 *
 * A claim is kept only when its quote is on a page it was shown, word for
 * word, and every number in the claim is in the quote (a year may come from
 * the page). What the model knows without a page never reaches the report.
 */
import { z } from "zod";
import { type EvidencePage, numbersQuoted, pageQuoted, words } from "../grounding.js";

export const STUDY_VERSION = "v1";
export const QUERIES_PER_ANGLE = 3;
export const CLAIMS_PER_ANGLE = 8;
export const CLAIM_MAX_WORDS = 60;
const QUOTE_MIN_WORDS = 5;
/** The prompt asks for 60; a quote past this is a pasted section, not the words a claim rests on. */
const QUOTE_MAX_WORDS = 80;

const PLAN = `You plan web searches for one angle of a research study.

Return ONLY a JSON object, no prose, exactly this shape:
{"queries": ["...", "..."]}

Rules:
- At most {n} queries, each 3 to 10 words, as a person types into a search engine.
- Each query finds a different kind of source: a survey or benchmark with numbers, a trade publication or industry association, people in the field talking (forums, Reddit, reviews), a government statistic.
- Put a year in a query only when fresh numbers matter. This year is {year}.
- No site: operators. Quotes only around a phrase that must match exactly.

Study: {question}
Angle: {angle}
`;

export const QueryPlan = z.object({ queries: z.array(z.string()) });
export type QueryPlan = z.infer<typeof QueryPlan>;

/**
 * `{name}` marks filled in one pass: a "{angle}" or "$&" inside a question or
 * a page stays text.
 */
export const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (mark, name: string) => values[name] ?? mark);

export function buildPlanPrompt(question: string, angle: string, year: number): string {
  return fill(PLAN, { n: String(QUERIES_PER_ANGLE), year: String(year), question, angle });
}

/** The plan's queries, trimmed, each once, at most QUERIES_PER_ANGLE. */
export function planQueries(plan: QueryPlan): string[] {
  const out: string[] = [];
  for (const q of plan.queries.map((s) => s.replace(/\s+/g, " ").trim())) {
    if (q && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  }
  return out.slice(0, QUERIES_PER_ANGLE);
}

const CLAIMS = `You pull facts out of web pages for a research report. Answer ONE angle of the study.

Return ONLY a JSON object, no prose, exactly this shape:
{"claims": [{"claim": "...", "quote": "...", "source_url": "..."}]}

Rules:
- At most {max} claims, the most useful first. Only claims that answer the angle.
- claim: one plain sentence a person would say out loud, at most {words} words. Specific: a number, a named practice, a stated cause. Say who says it ("A 2025 survey of 400 firms found ...", "Recruiters on Reddit say ...").
- quote: the exact words from ONE page below that the claim rests on, copied character for character, 5 to 60 words.
- source_url: that page's URL, exactly as written after "===".
- Every number in the claim must appear in the quote.
- Pages that disagree: give both claims. Never average or combine numbers from two pages.
- A company's marketing about itself is not a fact about the market.
- Nothing on the pages answers the angle: return {"claims": []}.

Study: {question}
Angle: {angle}

PAGES:
{pages}
`;

export const ClaimProposals = z.object({
  claims: z.array(
    z.object({
      claim: z.string().nullable().optional(),
      quote: z.string().nullable().optional(),
      source_url: z.string().nullable().optional(),
    }),
  ),
});
export type ClaimProposals = z.infer<typeof ClaimProposals>;
type ClaimProposal = ClaimProposals["claims"][number];

export function buildClaimsPrompt(
  question: string,
  angle: string,
  pages: readonly EvidencePage[],
): string {
  return fill(CLAIMS, {
    max: String(CLAIMS_PER_ANGLE),
    words: String(CLAIM_MAX_WORDS),
    question,
    angle,
    pages: pages.map((p) => `=== ${p.url}\n${p.text}`).join("\n\n"),
  });
}

export interface Claim {
  claim: string;
  quote: string;
  source_url: string;
}

export type ClaimRejection =
  | "too_long"
  | "no_quote"
  | "quote_too_long"
  | "quote_not_found"
  | "number_not_in_quote";

export interface DroppedClaim {
  claim: string;
  why: ClaimRejection;
}

/** Keep the claim only when it stands on a quote from a page shown; the URL is the page's own. */
export function groundClaim(
  p: ClaimProposal,
  pages: readonly EvidencePage[],
): { claim: Claim | null; rejected: ClaimRejection | null } {
  const claim = (p.claim ?? "").replace(/\s+/g, " ").trim();
  if (!claim) return { claim: null, rejected: null };
  if (words(claim) > CLAIM_MAX_WORDS) return { claim: null, rejected: "too_long" };
  const quote = (p.quote ?? "").trim();
  if (words(quote) < QUOTE_MIN_WORDS) return { claim: null, rejected: "no_quote" };
  if (words(quote) > QUOTE_MAX_WORDS) return { claim: null, rejected: "quote_too_long" };
  const page = pageQuoted(quote, pages, p.source_url ?? null);
  if (!page) return { claim: null, rejected: "quote_not_found" };
  if (!numbersQuoted(claim, quote, page)) return { claim: null, rejected: "number_not_in_quote" };
  return { claim: { claim, quote, source_url: page.url }, rejected: null };
}

/** Every proposal through the gate: kept (each quote once), dropped with why. */
export function gateClaims(
  proposals: ClaimProposals,
  pages: readonly EvidencePage[],
): { kept: Claim[]; dropped: DroppedClaim[] } {
  const kept: Claim[] = [];
  const dropped: DroppedClaim[] = [];
  for (const p of proposals.claims.slice(0, CLAIMS_PER_ANGLE)) {
    const { claim, rejected } = groundClaim(p, pages);
    if (rejected) dropped.push({ claim: (p.claim ?? "").trim(), why: rejected });
    else if (claim && !kept.some((k) => k.quote === claim.quote)) kept.push(claim);
  }
  return { kept, dropped };
}
