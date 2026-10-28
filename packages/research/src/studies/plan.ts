/**
 * The study planner falcon 0.5.0 dropped (raven plans, weaver runs there now): plan an angle into
 * searches, pick which pages to read, read one page into claims on every angle. A bridge, kept
 * here word for word from falcon 0.4, until `wren study` runs on raven and weaver.
 *
 * A claim is kept only when its quote is on a page it was shown, word for word, and every number
 * in the claim is in the quote (a year may come from the page).
 */
import {
  type Claim,
  type EvidencePage,
  fill,
  numbersQuoted,
  pageQuoted,
  words,
} from "@wrenautomation/falcon/study";
import { z } from "zod";

export const STUDY_VERSION = "v2";
const QUERIES_PER_ANGLE = 3;
const CLAIMS_PER_PAGE = 8;
const CLAIM_MAX_WORDS = 60;
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

const CLAIMS = `You pull facts out of one web page for a research report. The study has numbered angles.

Return ONLY a JSON object, no prose, exactly this shape:
{"claims": [{"angle": 1, "claim": "...", "quote": "..."}]}

Rules:
- At most {max} claims, the most useful first. Only claims that answer an angle.
- angle: the number of the angle the claim answers.
- claim: one plain sentence a person would say out loud, at most {words} words. Specific: a number, a named practice, a stated cause. Say who says it ("A 2025 survey of 400 firms found ...", "Recruiters on Reddit say ...").
- quote: the exact words from the page that the claim rests on, copied character for character, 5 to 60 words.
- Every number in the claim must appear in the quote.
- A company's marketing about itself is not a fact about the market.
- Nothing on the page answers an angle: return {"claims": []}.

Study: {question}

ANGLES:
{angles}

PAGE: {url}
{page}
`;

export const ClaimProposals = z.object({
  claims: z.array(
    z.object({
      angle: z.coerce.number().nullable().optional(),
      claim: z.string().nullable().optional(),
      quote: z.string().nullable().optional(),
    }),
  ),
});
export type ClaimProposals = z.infer<typeof ClaimProposals>;
type ClaimProposal = ClaimProposals["claims"][number];

export function buildClaimsPrompt(
  question: string,
  angles: readonly string[],
  page: EvidencePage,
): string {
  return fill(CLAIMS, {
    max: String(CLAIMS_PER_PAGE),
    words: String(CLAIM_MAX_WORDS),
    question,
    angles: angles.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    url: page.url,
    page: page.text,
  });
}

type ClaimRejection =
  | "no_angle"
  | "too_long"
  | "no_quote"
  | "quote_too_long"
  | "quote_not_found"
  | "number_not_in_quote";

export interface DroppedClaim {
  claim: string;
  why: ClaimRejection;
}

/** Keep the claim only when it answers an angle and stands on a quote from the page. */
function groundClaim(
  p: ClaimProposal,
  page: EvidencePage,
  angles: number,
): { claim: Claim | null; rejected: ClaimRejection | null } {
  const claim = (p.claim ?? "").replace(/\s+/g, " ").trim();
  if (!claim) return { claim: null, rejected: null };
  const angle = Number(p.angle) - 1;
  if (!Number.isInteger(angle) || angle < 0 || angle >= angles)
    return { claim: null, rejected: "no_angle" };
  if (words(claim) > CLAIM_MAX_WORDS) return { claim: null, rejected: "too_long" };
  const quote = (p.quote ?? "").trim();
  if (words(quote) < QUOTE_MIN_WORDS) return { claim: null, rejected: "no_quote" };
  if (words(quote) > QUOTE_MAX_WORDS) return { claim: null, rejected: "quote_too_long" };
  if (!pageQuoted(quote, [page], page.url)) return { claim: null, rejected: "quote_not_found" };
  if (!numbersQuoted(claim, quote, page)) return { claim: null, rejected: "number_not_in_quote" };
  return { claim: { angle, claim, quote, source_url: page.url }, rejected: null };
}

/** Every proposal through the gate: kept (each quote once), dropped with why. */
export function gateClaims(
  proposals: ClaimProposals,
  page: EvidencePage,
  angles: number,
): { kept: Claim[]; dropped: DroppedClaim[] } {
  const kept: Claim[] = [];
  const dropped: DroppedClaim[] = [];
  for (const p of proposals.claims.slice(0, CLAIMS_PER_PAGE)) {
    const { claim, rejected } = groundClaim(p, page, angles);
    if (rejected) dropped.push({ claim: (p.claim ?? "").trim(), why: rejected });
    else if (claim && !kept.some((k) => k.quote === claim.quote)) kept.push(claim);
  }
  return { kept, dropped };
}

export interface Hit {
  title: string;
  url: string;
  snippet: string | null;
}

/** Pages that read as a login wall or a video player, not text. */
const UNREADABLE = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** One page, one read: no fragment, no trailing slash. */
export const pageKey = (url: string): string => url.replace(/#.*$/, "").replace(/\/+$/, "");

/**
 * The pages to read for one angle: each list's best hit, then each list's
 * second, until `limit`. One list per query (and one for an answer engine's
 * sources), so no single query fills the angle. Social and video pages are
 * skipped; they don't read as text.
 */
export function pickReads(lists: readonly (readonly Hit[])[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < longest && out.length < limit; rank++) {
    for (const list of lists) {
      const hit = list[rank];
      if (!hit) continue;
      const host = hostOf(hit.url);
      if (!host || UNREADABLE.some((h) => host === h || host.endsWith(`.${h}`))) continue;
      const key = pageKey(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= limit) break;
    }
  }
  return out;
}
