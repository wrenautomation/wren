/**
 * What a reply meant, proposed by one LLM call and gated deterministically
 * (the email classifier's shape). The model returns a label and a quote copied
 * from the reply; the gate checks the label is ours, the quote is really in the
 * text, and confidence clears 0.6. Anything else is recorded, not applied.
 *
 * A grounded `opt_out` also writes the phone suppression: a person asking not
 * to be texted is honored however they said it. Rule labels (STOP words) and
 * operator labels are never overwritten.
 */
import { addSuppression, companies } from "@wren/core";
import { type Db, serializable } from "@wren/db";
import { completeAndParse, type Envelope, type LlmClient, LlmError } from "@wren/llm";
import { and, asc, desc, eq, isNull, lt, not, sql } from "drizzle-orm";
import { z } from "zod";
import { skipQueued } from "./deliver.js";
import { SmsRefusal } from "./refusal.js";
import { DISPOSITIONS, type Disposition, smsContacts, smsMessages } from "./schema.js";

export const CLASSIFY_VERSION = "v1";
export const STAGE_NAME = "sms_reply_disposition";
export const MIN_CONFIDENCE = 0.6;
const MAX_TOKENS = 2000;

export const proposalSchema = z.object({
  disposition: z.string(),
  evidence: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export interface ReplyState {
  reply: string;
  ours: string | null;
  company: string | null;
}

export interface Verdict {
  disposition: Disposition | null;
  grounded: boolean;
  reason: string;
}

export function buildPrompt(s: ReplyState): string {
  return `You are reading a reply to a short business text message we sent. Decide what the reply means.

Our text, to someone at ${s.company ?? "(unknown company)"}:
${s.ours ?? "(none: they texted us first)"}

Their reply:
${s.reply}

Labels, pick exactly one:
- interested: wants to talk, asks for details, pricing or a call; says yes
- question: asks something before deciding (who is this, how did you get my number)
- not_interested: a clear no, not a fit, in-house
- wrong_person: not the right person or not their business
- opt_out: asks not to be texted or contacted, in any words
- other: none of the above

Return ONLY a JSON object:
{"disposition": "<label>", "evidence": "<a short quote copied verbatim from their reply>", "confidence": <0.0 to 1.0>, "reason": "<one sentence>"}

Rules: evidence is copied exactly from their reply. Our text is context, never evidence. When unsure, lower the confidence.
`;
}

const fold = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const VOCABULARY: ReadonlySet<string> = new Set(DISPOSITIONS);

export function ground(s: ReplyState, proposal: Proposal | null, why: string | null): Verdict {
  if (!proposal) return { disposition: null, grounded: false, reason: why ?? "no proposal" };
  const label = proposal.disposition.trim().toLowerCase();
  if (!VOCABULARY.has(label))
    return { disposition: null, grounded: false, reason: `label '${label}' is not ours` };
  const quote = fold(proposal.evidence ?? "");
  if (!quote || !fold(s.reply).includes(quote)) {
    return { disposition: null, grounded: false, reason: "evidence quote is not in the reply" };
  }
  const c = proposal.confidence ?? null;
  if (c === null || c < MIN_CONFIDENCE) {
    return {
      disposition: null,
      grounded: false,
      reason: `confidence ${c ?? "none"} below ${MIN_CONFIDENCE}`,
    };
  }
  return { disposition: label as Disposition, grounded: true, reason: "grounded" };
}

export interface ClassifyStats {
  selected: number;
  labelled: number;
  ungrounded: number;
  optOuts: number;
  aborted: string | null;
}

/** Label unlabelled inbound texts, oldest first, one commit each. */
export async function classifyReplies(
  db: Db,
  llm: LlmClient,
  opts: { limit?: number; runId?: string | null; now: Date },
): Promise<ClassifyStats> {
  const already = sql`(${smsMessages.classification} ->> 'model' = ${llm.name} AND ${smsMessages.classification} ->> 'prompt_version' = ${CLASSIFY_VERSION} AND ${smsMessages.classification} ->> 'parse_error' IS NULL)`;
  const pending = await db
    .select({ msg: smsMessages, company: companies.name })
    .from(smsMessages)
    .innerJoin(smsContacts, eq(smsContacts.id, smsMessages.contactId))
    .leftJoin(companies, eq(companies.id, smsContacts.companyId))
    .where(
      and(
        eq(smsMessages.direction, "in"),
        isNull(smsMessages.disposition),
        sql`(${smsMessages.classification} IS NULL OR NOT ${already})`,
      ),
    )
    .orderBy(asc(smsMessages.receivedAt), asc(smsMessages.id))
    .limit(opts.limit ?? 50);
  const stats: ClassifyStats = {
    selected: pending.length,
    labelled: 0,
    ungrounded: 0,
    optOuts: 0,
    aborted: null,
  };
  for (const { msg, company } of pending) {
    if (!msg.body.trim()) continue;
    const [ours] = await db
      .select({ body: smsMessages.body })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.contactId, msg.contactId),
          eq(smsMessages.direction, "out"),
          lt(smsMessages.createdAt, msg.createdAt),
          not(eq(smsMessages.state, "skipped")),
        ),
      )
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);
    const state: ReplyState = { reply: msg.body, ours: ours?.body ?? null, company };
    let envelope: Envelope;
    let verdict: Verdict;
    let proposal: Proposal | null;
    try {
      const outcome = await completeAndParse(llm, buildPrompt(state), proposalSchema, {
        maxTokens: MAX_TOKENS,
        runId: opts.runId ?? null,
        name: STAGE_NAME,
        metadata: { sms_message_id: msg.id },
      });
      envelope = outcome.envelope();
      proposal = outcome.parsed;
      verdict = ground(state, proposal, outcome.parseError ?? outcome.providerRejected);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      stats.aborted = err.message;
      break;
    }
    // Level 4: the stored disposition decides the label. The body can rerun, so stats wait.
    const outcome = await serializable(db, async (tx) => {
      const [fresh] = await tx
        .select({ disposition: smsMessages.disposition })
        .from(smsMessages)
        .where(eq(smsMessages.id, msg.id));
      const apply = verdict.grounded && verdict.disposition && !fresh?.disposition;
      await tx
        .update(smsMessages)
        .set({
          classification: {
            ...envelope,
            model: llm.name,
            prompt_version: CLASSIFY_VERSION,
            proposal,
            verdict,
            classified_at: opts.now.toISOString(),
          },
          ...(apply ? { disposition: verdict.disposition, dispositionSource: "llm" as const } : {}),
        })
        .where(eq(smsMessages.id, msg.id));
      if (!apply) return verdict.grounded ? null : "ungrounded";
      if (verdict.disposition === "opt_out" && msg.fromE164) {
        await addSuppression(tx, {
          kind: "phone",
          value: msg.fromE164,
          reason: "opt_out",
          evidence: {
            source: "sms_classifier",
            sms_message_id: msg.id,
            quote: proposal?.evidence ?? null,
          },
        });
        await tx
          .update(smsContacts)
          .set({ state: "opted_out", stateReason: "asked not to be texted", endedAt: opts.now })
          .where(eq(smsContacts.e164, msg.fromE164));
        await skipQueued(tx, msg.contactId, "opted out");
        return "optOut";
      }
      return "labelled";
    });
    if (outcome === "ungrounded") stats.ungrounded += 1;
    if (outcome === "labelled" || outcome === "optOut") stats.labelled += 1;
    if (outcome === "optOut") stats.optOuts += 1;
  }
  return stats;
}

/** An operator's label: always wins, and `opt_out` suppresses like any other. */
export async function labelReply(
  db: Db,
  input: { messageId: number; disposition: Disposition; now: Date },
): Promise<void> {
  await serializable(db, async (tx) => {
    const [msg] = await tx
      .update(smsMessages)
      .set({ disposition: input.disposition, dispositionSource: "operator" })
      .where(and(eq(smsMessages.id, input.messageId), eq(smsMessages.direction, "in")))
      .returning();
    if (!msg) throw new SmsRefusal(`no inbound sms ${input.messageId}`);
    if (input.disposition === "opt_out" && msg.fromE164) {
      await addSuppression(tx, {
        kind: "phone",
        value: msg.fromE164,
        reason: "opt_out",
        evidence: { source: "operator", sms_message_id: msg.id },
      });
      await tx
        .update(smsContacts)
        .set({ state: "opted_out", stateReason: "operator: opt out", endedAt: input.now })
        .where(eq(smsContacts.e164, msg.fromE164));
      await skipQueued(tx, msg.contactId, "opted out");
    }
  });
}
