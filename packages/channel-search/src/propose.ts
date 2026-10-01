/**
 * The weekly proposals: the model reads the brief and the live site (its
 * `/llms.txt`) and proposes edits that would answer the keywords better. It
 * proposes; code gates. A proposal must quote the page's current text word
 * for word, carry no price and no number the site doesn't already state, and
 * no dash the copy rules forbid. Last week's unanswered proposals go stale.
 */
import type { Db } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Brief, formatBrief } from "./brief.js";
import { PROPOSAL_KINDS, type ProposalKind, searchProposals } from "./schema.js";

const Proposal = z.object({
  page: z.string().min(1),
  kind: z.enum(PROPOSAL_KINDS),
  current: z.string(),
  proposed: z.string().min(1),
  why: z.string().min(1),
  keywords: z.array(z.string()).default([]),
});
const Proposals = z.object({ proposals: z.array(Proposal).max(8) });
export type ProposalDraft = z.infer<typeof Proposal>;

export function proposePrompt(b: Brief, site: string): string {
  return [
    "You tune a small company's website so Google and AI answer engines (Google AI Overviews, ChatGPT search,",
    "Perplexity) show and cite it for the keywords below. AI engines split a question into narrower searches",
    "(the [fanout] keywords) and cite pages that answer those pieces directly, in a sentence or two, near the top",
    "of a section or in a FAQ answer.",
    "",
    "Propose up to 6 edits with the most expected gain. Kinds: title (the <title>, about 60 characters, what",
    "someone would type first), description (about 155 characters), heading, copy (a sentence or paragraph),",
    "faq (a new question and answer: `current` empty, `proposed` as 'Q: ...\\nA: ...'), page (a new page worth",
    "building: `current` empty, `proposed` its topic and outline).",
    "",
    "Rules. Break none:",
    "- `current` is copied word for word from the site text below, or empty for faq and page.",
    "- No prices or money amounts. No number, percentage or statistic the site text doesn't already state.",
    "- No em dashes or en dashes. Short plain sentences a person would say out loud. Say 'company', not 'firm'.",
    "- Keep the page's claims; sharpen the wording, don't invent offers, results or clients.",
    "- Skip a keyword the site can't honestly answer.",
    "",
    ...formatBrief(b),
    "",
    "The site, as it reads now:",
    site.slice(0, 24_000),
    "",
    'Answer with JSON only: {"proposals": [{"page": "/path", "kind": "...", "current": "...", "proposed": "...", "why": "one sentence", "keywords": ["..."]}]}',
  ].join("\n");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const MONEY = /[$€£]\s?\d|\b\d[\d,.]*\s?(k|K)?\s?(USD|CAD|EUR|dollars?)\b/;
const DASH = /[–—]/;

/** Why a draft is refused, or null when it passes. */
export function refusal(p: ProposalDraft, site: string): string | null {
  const text = squash(site);
  if (p.current && !text.includes(squash(p.current))) return "current text not found on the site";
  if (!p.current && p.kind !== "faq" && p.kind !== "page") return "no current text to replace";
  if (MONEY.test(p.proposed)) return "names a price";
  if (DASH.test(p.proposed)) return "uses a dash";
  const invented = (p.proposed.match(/\d[\d,.]*%?/g) ?? []).find(
    (n) => !text.includes(n.replace(/[.,]$/, "")),
  );
  if (invented) return `a number the site doesn't state: ${invented}`;
  if (squash(p.current) === squash(p.proposed)) return "no change";
  return null;
}

export interface ProposeStats {
  made: number;
  refused: Array<{ kind: ProposalKind; page: string; reason: string }>;
  staled: number;
  parseError: string | null;
}

export async function propose(
  db: Db,
  llm: LlmClient,
  o: { brief: Brief; site: string; today: string; runId: string | null },
): Promise<ProposeStats> {
  const out = await completeAndParse(llm, proposePrompt(o.brief, o.site), Proposals, {
    maxTokens: 4_000,
    runId: o.runId,
    name: "search propose",
  });
  const stats: ProposeStats = {
    made: 0,
    refused: [],
    staled: 0,
    parseError: out.parseError ?? out.providerRejected,
  };
  if (!out.parsed) return stats;
  const staled = await db
    .update(searchProposals)
    .set({ state: "dropped" })
    .where(eq(searchProposals.state, "open"))
    .returning({ id: searchProposals.id });
  stats.staled = staled.length;
  for (const p of out.parsed.proposals) {
    const reason = refusal(p, o.site);
    if (reason) {
      stats.refused.push({ kind: p.kind, page: p.page, reason });
      continue;
    }
    await db
      .insert(searchProposals)
      .values({ ...p, madeOn: o.today, llm: out.call, runId: o.runId });
    stats.made++;
  }
  return stats;
}
