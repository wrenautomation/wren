/**
 * A post draft checked against its platform's SOP (designs/2026-10-25-competitor-analyzer.md,
 * Use). The draft goes through the same breakdown as a competitor's post; code holds its counts
 * to the standard and its labels to the patterns he kept or dropped (`checkPiece`), and one judge
 * call reads his calls on pieces' own words and gives up to 3 changes. The result is saved on the
 * draft with the words' version it read: an edit makes it stale, never wrong.
 */
import { isVendorStop } from "@wren/core/metered";
import type { Queryable } from "@wren/db";
import {
  answerSchema,
  breakdownPrompt,
  callsOf,
  checkPiece,
  draftScope,
  kindStandardOf,
  type PieceCheck,
  postCounts,
  rulesOf,
  type SopCall,
} from "@wren/learn";
import { completeAndParse, type LlmClient, type Tracer } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { playbookFor } from "./playbook.js";
import { draftVersion } from "./review.js";
import { type ContentPlaybook, contentDrafts, contentPlaybooks } from "./schema.js";

/** His calls on a piece's own words, each judged against the draft. */
export type RuleVerdict = "meets" | "breaks" | "n/a";

export interface DraftCheck extends PieceCheck {
  /** `draftVersion` of the words checked: another version means the check is stale. */
  version: string;
  at: string;
  /** The SOP the platform's playbook was pushed from; null with no playbook. */
  sop: string | null;
  /** Our breakdown's hook, in its words. */
  hook: string | null;
  rules: { call: SopCall["call"]; say: string; cite: string; verdict: RuleVerdict }[];
  changes: string[];
  /** Why nothing was compared (no standard and no calls yet); null when it was. */
  why: string | null;
}

/** Rules the judge reads: past this, the oldest calls wait for the SOP itself. */
const MAX_RULES = 30;

const judgeSchema = z.object({
  rules: z.array(z.object({ n: z.number().int(), verdict: z.enum(["meets", "breaks", "n/a"]) })),
  changes: z.array(z.string()).max(5),
});

const ruleSay = (c: SopCall) =>
  `${c.call === "drop" ? "Never" : c.call === "tune" ? "Do, changed" : "Do"}: ${c.label} "${c.value}"${c.comment ? ` (his words: "${c.comment}")` : ""}`;

export function judgePrompt(
  text: string,
  check: PieceCheck,
  own: SopCall[],
  playbook: Pick<ContentPlaybook, "text"> | null,
): string {
  const off = check.numbers
    .filter((x) => x.where && x.where !== "inside")
    .map((x) => `- ${x.label}: ours ${x.ours}, the middle half is ${x.p25} to ${x.p75}`);
  const broke = check.patterns
    .filter((p) => p.verdict === "breaks")
    .map((p) => `- ${p.label}: ours is ${p.ours}, which he dropped`);
  const rules = own.map((c, i) => `${i + 1}. ${ruleSay(c)}`);
  return `Check this post draft against the house rules. Be strict and short.

${rules.length ? `His calls on example posts (judge each: meets, breaks, or n/a when it does not apply to this draft):\n${rules.join("\n")}\n` : "He made no calls on example posts' own words.\n"}
${off.length || broke.length ? `Where code found it off the standard:\n${[...off, ...broke].join("\n")}\n` : ""}${playbook ? `The playbook:\n"""\n${playbook.text.slice(0, 6000)}\n"""\n` : ""}
Then give up to 3 changes that would most improve it under these rules, each one plain sentence naming what to change. None when it already fits.

Answer {"rules": [{"n": 1, "verdict": "meets"}], "changes": ["..."]}.

The draft:
"""
${text}
"""`;
}

/** The playbook a draft was written with, else the platform's live one. */
async function playbookOf(
  db: Queryable,
  d: { playbookId: string | null; platform: Parameters<typeof playbookFor>[1] },
): Promise<ContentPlaybook | null> {
  if (d.playbookId) {
    const [row] = await db
      .select()
      .from(contentPlaybooks)
      .where(eq(contentPlaybooks.id, d.playbookId));
    if (row) return row;
  }
  return playbookFor(db, d.platform);
}

/**
 * Check one draft and save the result on it. Null when a model vendor stopped the call (its cap
 * or its gate): nothing is saved, and asking again later works.
 */
export async function checkDraft(
  db: Queryable,
  llm: LlmClient,
  draftId: string,
  o: { tracer?: Tracer; runId?: string; now?: Date } = {},
): Promise<DraftCheck | null> {
  const [d] = await db
    .select({
      id: contentDrafts.id,
      text: contentDrafts.text,
      title: contentDrafts.title,
      platform: contentDrafts.platform,
      playbookId: contentDrafts.playbookId,
    })
    .from(contentDrafts)
    .where(eq(contentDrafts.id, draftId));
  if (!d) throw new Error(`no draft ${draftId}`);
  const playbook = await playbookOf(db, d);
  const scope = draftScope(playbook, "post", d.platform);
  const [standard, calls] = await Promise.all([
    kindStandardOf(db, scope),
    playbook ? callsOf(db, scope, playbook.sop) : Promise.resolve([]),
  ]);
  const { patterns, own } = rulesOf(calls);
  const base = {
    version: draftVersion(d.text),
    at: (o.now ?? new Date()).toISOString(),
    sop: playbook?.sop ?? null,
  };
  const save = async (check: DraftCheck) => {
    await db.update(contentDrafts).set({ check }).where(eq(contentDrafts.id, d.id));
    return check;
  };
  if (!standard && !calls.length)
    return save({
      ...base,
      ...checkPiece("post", null, [], {}),
      hook: null,
      rules: [],
      changes: [],
      why: `No posts on ${d.platform} broken down and no calls yet: nothing to hold it to.`,
    });
  const stage = {
    ...(o.tracer ? { tracer: o.tracer } : {}),
    ...(o.runId ? { runId: o.runId } : {}),
  };
  const stopped = (err: unknown) => {
    if (isVendorStop(err)) return null;
    throw err;
  };
  const read = await completeAndParse(
    llm,
    breakdownPrompt({
      kind: "post",
      title: d.title ?? "Our draft",
      url: "(not posted)",
      text: d.text,
    }),
    answerSchema("post"),
    {
      maxTokens: 900,
      system: "You study how social posts are made. Answer with JSON only.",
      name: "content.check.breakdown",
      ...stage,
    },
  ).catch(stopped);
  if (!read) return null;
  const v = read.parsed;
  const counts = postCounts(d.text);
  const check = checkPiece("post", standard, patterns, {
    chars: counts.chars,
    lines: counts.lines,
    firstLineChars: counts.first_line_chars,
    hashtags: counts.hashtags,
    link: counts.link,
    hookStyle: v?.hook_style ?? null,
    ctaKind: v?.cta_kind ?? null,
    shape: v?.shape ?? null,
  });
  const rules = own.slice(-MAX_RULES);
  const judged = await completeAndParse(
    llm,
    judgePrompt(d.text, check, rules, playbook),
    judgeSchema,
    {
      maxTokens: 700,
      system: "You hold drafts to a brand's rules. Answer with JSON only.",
      name: "content.check.judge",
      ...stage,
    },
  ).catch(stopped);
  if (!judged) return null;
  const verdicts = new Map((judged.parsed?.rules ?? []).map((r) => [r.n, r.verdict]));
  return save({
    ...base,
    ...check,
    hook: v?.hook ?? null,
    rules: rules.map((c, i) => ({
      call: c.call,
      say: ruleSay(c),
      cite: `learn:${c.id}`,
      verdict: verdicts.get(i + 1) ?? "n/a",
    })),
    changes: (judged.parsed?.changes ?? []).slice(0, 3),
    why: null,
  });
}
