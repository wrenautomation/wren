/**
 * Site edits for the keywords. A person's agent writes them (the `/search-week`
 * skill, `.claude/skills/search-week`); code gates them and stores the ones
 * that pass for `wren search pr`. An edit is a small word or phrase swap: it
 * quotes the page's current text word for word, changes at most
 * `MAX_WORDS_CHANGED` words, and adds no price, no dash and no number the site
 * doesn't already state. A rewrite, a new section, FAQ or page is a note for a
 * person, never an edit. A new batch stales the open ones.
 */
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PROPOSAL_KINDS, type ProposalKind, searchProposals } from "./schema.js";

const Proposal = z.object({
  page: z.string().min(1),
  kind: z.enum(PROPOSAL_KINDS),
  current: z.string(),
  proposed: z.string().min(1),
  why: z.string().min(1),
  keywords: z.array(z.string()).default([]),
});
/** A batch: an array of edits, or `{ proposals: [...] }`. */
export const ProposalBatch = z.union([
  z.array(Proposal).max(12),
  z.object({ proposals: z.array(Proposal).max(12) }).transform((b) => b.proposals),
]);
export type ProposalDraft = z.infer<typeof Proposal>;

/** Words added plus words removed, past this an edit is a rewrite. */
export const MAX_WORDS_CHANGED = 6;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => squash(s).split(" ").filter(Boolean);
const MONEY = /[$€£]\s?\d|\b\d[\d,.]*\s?(k|K)?\s?(USD|CAD|EUR|dollars?)\b/;
const DASH = /[–—]/;

/** Words removed from `a` plus words added in `b`: what stays in order is free. */
export function wordsChanged(a: string, b: string): number {
  const x = words(a),
    y = words(b);
  let row = new Array<number>(y.length + 1).fill(0);
  for (const w of x) {
    const next = [0];
    for (let j = 0; j < y.length; j++)
      next.push(w === y[j] ? (row[j] ?? 0) + 1 : Math.max(row[j + 1] ?? 0, next[j] ?? 0));
    row = next;
  }
  const kept = row[y.length] ?? 0;
  return x.length - kept + (y.length - kept);
}

/** Why a draft is refused, or null when it passes. */
export function refusal(p: ProposalDraft, site: string): string | null {
  const text = squash(site);
  if (p.kind === "faq" || p.kind === "page") return "a new FAQ or page is a note, not an edit";
  if (!p.current) return "no current text to replace";
  if (!text.includes(squash(p.current))) return "current text not found on the site";
  if (MONEY.test(p.proposed)) return "names a price";
  if (DASH.test(p.proposed)) return "uses a dash";
  const invented = (p.proposed.match(/\d[\d,.]*%?/g) ?? []).find(
    (n) => !text.includes(n.replace(/[.,]$/, "")),
  );
  if (invented) return `a number the site doesn't state: ${invented}`;
  const changed = wordsChanged(p.current, p.proposed);
  if (!changed) return "no change";
  if (changed > MAX_WORDS_CHANGED)
    return `changes ${changed} words (most ${MAX_WORDS_CHANGED}): a note, not an edit`;
  return null;
}

export interface ProposeStats {
  made: number;
  refused: Array<{ kind: ProposalKind; page: string; current: string; reason: string }>;
  staled: number;
}

/** Gates a batch against the live site text; stores what passes unless `dry`. */
export async function storeProposals(
  db: Db,
  drafts: readonly ProposalDraft[],
  o: { site: string; today: string; runId: string | null; dry?: boolean },
): Promise<ProposeStats> {
  const stats: ProposeStats = { made: 0, refused: [], staled: 0 };
  const pass: ProposalDraft[] = [];
  for (const p of drafts) {
    const reason = refusal(p, o.site);
    if (reason) stats.refused.push({ kind: p.kind, page: p.page, current: p.current, reason });
    else pass.push(p);
  }
  if (o.dry || !pass.length) return { ...stats, made: pass.length };
  const staled = await db
    .update(searchProposals)
    .set({ state: "dropped" })
    .where(eq(searchProposals.state, "open"))
    .returning({ id: searchProposals.id });
  stats.staled = staled.length;
  for (const p of pass) {
    await db.insert(searchProposals).values({ ...p, madeOn: o.today, runId: o.runId });
    stats.made++;
  }
  return stats;
}
