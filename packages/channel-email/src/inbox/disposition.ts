/**
 * What a human reply meant, proposed by one LLM step and gated deterministically.
 *
 *     route ──┬─ no reply text ──→ noText ──→ done
 *             └─ otherwise ──────→ classify ─→ ground ─→ done
 *
 * `classify` is the single paid step; `route` and `ground` are deterministic.
 * The LLM proposes a label from the disposition vocabulary and a VERBATIM
 * quote from the reply that justifies it; `ground` checks that the label is in
 * the vocabulary, that the quote really appears in the reply text, and that
 * the stated confidence clears the floor. A proposal that fails any of those
 * is recorded and NOT applied — the event stays unlabelled for the operator.
 *
 * What the label can never do: write a suppression or stop a thread. The
 * deterministic inbound classes and the operator own those; `runDisposition`
 * writes exactly one column (`thread_events.disposition`, with source=llm) and
 * the audit record beside it, and nothing else. An operator's label is never
 * overwritten: the selection excludes every event that already has one, and
 * the label column is re-read right before writing, so a human who labelled
 * the reply while the LLM was thinking keeps their reading — the classifier's
 * record is still kept beside it.
 *
 * Durability: one event per transaction, so a crash loses at most one paid
 * call; a re-run skips events already classified under the same (model,
 * prompt version) unless that attempt was a parse failure.
 */
import { companies } from "@wren/core";
import type { Db, Queryable } from "@wren/db";
import { completeAndParse, type Envelope, type LlmClient, LlmError, type Tracer } from "@wren/llm";
import { and, asc, eq, isNull, not, sql } from "drizzle-orm";
import { z } from "zod";
import {
  enrollments,
  messages,
  REPLY_DISPOSITIONS,
  type ReplyDisposition,
  type ThreadEvent,
  threadEvents,
} from "../schema.js";
import { labelEvent } from "./sync.js";

// v1 (2026-09-08): first prompt. Bump whenever the prompt, the label
// definitions, or the grounding rule changes — the classification record
// carries it, and the run skips events already classified under the same
// (model, version).
export const DISPOSITION_VERSION = "v1";
/** `llm_calls.kind` for these calls. */
export const STAGE_NAME = "reply_disposition";
export const MIN_CONFIDENCE = 0.6;
// The visible answer is under ~60 tokens, but a reasoning model thinks first
// inside the same budget; only generated tokens cost, so a model that does
// not reason pays nothing for the headroom.
const MAX_TOKENS = 2000;
const MAX_OUR_BODY_CHARS = 1500;

export interface DispositionEvent {
  id: number;
  from_address: string | null;
  subject: string | null;
  text: string;
}
export interface DispositionOurs {
  step: number | null;
  template: string | null;
  subject: string | null;
  body: string | null;
  to_email: string | null;
}
export interface DispositionCompany {
  name: string | null;
  domain: string | null;
}

/** The state the run assembles and the steps read — plain data, so the steps are unit-testable on a FakeLlm. */
export interface DispositionState {
  event: DispositionEvent;
  ours: DispositionOurs;
  company: DispositionCompany;
}

export const proposalSchema = z.object({
  disposition: z.string(),
  evidence: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export interface DispositionVerdict {
  disposition: ReplyDisposition | null;
  grounded: boolean;
  reason: string;
}

/** What one pass over one event produced — the record `classification` stores. */
export interface DispositionResult {
  proposal: Proposal | null;
  llm: Envelope | null;
  parse_error: string | null;
  provider_rejected: string | null;
  verdict: DispositionVerdict;
}

export function route(state: DispositionState): "classify" | "no_text" {
  return state.event.text.trim() ? "classify" : "no_text";
}

/** A reply with no words of its own: nothing to read, so nothing is bought and nothing is labelled. */
export function noText(): DispositionResult {
  return {
    proposal: null,
    llm: null,
    parse_error: null,
    provider_rejected: null,
    verdict: { disposition: null, grounded: false, reason: "no reply text" },
  };
}

export function buildPrompt(state: DispositionState): string {
  const { event, ours, company } = state;
  let ourBody = (ours.body ?? "").trim();
  if (ourBody.length > MAX_OUR_BODY_CHARS)
    ourBody = `${ourBody.slice(0, MAX_OUR_BODY_CHARS).trimEnd()} …`;
  return `You are reading a reply to a cold email we sent. Decide what the reply means.

Our email (step ${ours.step ?? "?"}, template ${ours.template ?? "?"}), to ${ours.to_email ?? "?"} at ${company.name ?? company.domain ?? "(unknown company)"}:
Subject: ${ours.subject ?? "(rides the thread)"}
${ourBody || "(no body)"}

Their reply, from ${event.from_address ?? "(unknown)"}, subject "${event.subject ?? ""}":
${event.text}

Labels — pick exactly one:
- interested: wants to talk, asks for details, pricing, or a call; says yes
- meeting_booked: a time is agreed, or a booking / calendar link is confirmed
- not_interested: a clear no, "we do this in-house", "not a fit", or a removal request
- not_now: not right now, come back later, busy this quarter, revisit in a month
- wrong_person: the reader says someone else handles this and does NOT name them
- referral: the reader points us to a named person or an address to contact instead
- other: none of the above fits (unrelated question, gibberish, empty)

Return ONLY a JSON object, no prose:
{"disposition": "<label>", "evidence": "<a short quote copied verbatim from their reply>",
"confidence": <0.0 to 1.0>, "reason": "<one sentence>"}

Rules:
- evidence must be copied exactly from their reply, never paraphrased or invented.
- Read only their reply; our own email is context, never evidence.
- If the reply is ambiguous, lower the confidence rather than guessing.
`;
}

export interface ClassifyOptions {
  runId?: string | null;
  tracer?: Tracer | null;
}

/**
 * The one paid step. An LlmError propagates so the owning loop can abort with
 * partial progress; a rejection or a parse failure is this event's recorded outcome.
 */
export async function classifyStep(
  llm: LlmClient,
  state: DispositionState,
  opts: ClassifyOptions = {},
): Promise<Omit<DispositionResult, "verdict">> {
  const outcome = await completeAndParse(llm, buildPrompt(state), proposalSchema, {
    maxTokens: MAX_TOKENS,
    runId: opts.runId ?? null,
    tracer: opts.tracer ?? null,
    name: STAGE_NAME,
    metadata: { thread_event_id: state.event.id, from: state.event.from_address },
  });
  return {
    proposal: outcome.parsed,
    llm: outcome.envelope(),
    parse_error: outcome.parseError,
    provider_rejected: outcome.providerRejected,
  };
}

function fold(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

const VOCABULARY = new Set<string>(REPLY_DISPOSITIONS);

/**
 * The gate. Three deterministic checks on the proposal, any failure leaves the
 * event unlabelled (recorded, never applied): the label is in the vocabulary;
 * the evidence quote appears in the reply text (case and whitespace folded);
 * confidence is at least MIN_CONFIDENCE.
 */
export function ground(
  state: DispositionState,
  step: Omit<DispositionResult, "verdict">,
): DispositionVerdict {
  const proposal = step.proposal;
  if (proposal === null) {
    return {
      disposition: null,
      grounded: false,
      reason: step.parse_error ?? step.provider_rejected ?? "no proposal",
    };
  }
  const label = (proposal.disposition ?? "").trim().toLowerCase();
  if (!VOCABULARY.has(label)) {
    return {
      disposition: null,
      grounded: false,
      reason: `label '${label}' is not in the vocabulary`,
    };
  }
  const text = fold(state.event.text);
  const evidence = fold(proposal.evidence ?? "");
  if (!evidence || !text.includes(evidence)) {
    return { disposition: null, grounded: false, reason: "evidence quote is not in the reply" };
  }
  const confidence = proposal.confidence ?? null;
  if (confidence === null || confidence < MIN_CONFIDENCE) {
    return {
      disposition: null,
      grounded: false,
      reason: `confidence ${confidence === null ? "None" : confidence} below ${MIN_CONFIDENCE}`,
    };
  }
  return { disposition: label as ReplyDisposition, grounded: true, reason: "grounded" };
}

/** The whole edge: route, classify, ground. */
export async function runGraph(
  llm: LlmClient,
  state: DispositionState,
  opts: ClassifyOptions = {},
): Promise<DispositionResult> {
  if (route(state) === "no_text") return noText();
  const step = await classifyStep(llm, state, opts);
  return { ...step, verdict: ground(state, step) };
}

// --------------------------------------------------------------------------
// The database side

/** Human replies with no label yet, oldest first, minus the ones this (model, version) already answered without a parse failure. */
export async function pendingEvents(
  db: Queryable,
  opts: { model: string; niche?: string | null; limit?: number | null },
): Promise<ThreadEvent[]> {
  const already = sql`(${threadEvents.classification} IS NOT NULL
    AND ${threadEvents.classification} ->> 'model' = ${opts.model}
    AND ${threadEvents.classification} ->> 'prompt_version' = ${DISPOSITION_VERSION}
    AND ${threadEvents.classification} ->> 'parse_error' IS NULL)`;
  const conditions = [
    eq(threadEvents.kind, "reply"),
    isNull(threadEvents.disposition),
    not(already),
  ];
  if (opts.niche) conditions.push(eq(enrollments.niche, opts.niche));
  const query = db
    .select({ event: threadEvents })
    .from(threadEvents)
    .innerJoin(enrollments, eq(enrollments.id, threadEvents.enrollmentId))
    .where(and(...conditions))
    .orderBy(asc(threadEvents.receivedAt), asc(threadEvents.id));
  const rows = opts.limit ? await query.limit(opts.limit) : await query;
  return rows.map((row) => row.event);
}

/** Deterministic context assembly: the reply's own words, the message it answered (or the opener), and the company. */
export async function gatherState(db: Queryable, event: ThreadEvent): Promise<DispositionState> {
  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, event.enrollmentId));
  let ours = null;
  if (event.inReplyToMessageId !== null) {
    [ours = null] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, event.inReplyToMessageId));
  }
  if (ours === null && enrollment) {
    [ours = null] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.enrollmentId, enrollment.id), eq(messages.step, 0)))
      .limit(1);
  }
  const [company] = enrollment
    ? await db.select().from(companies).where(eq(companies.id, enrollment.companyId))
    : [];
  return {
    event: {
      id: event.id,
      from_address: event.fromAddress,
      subject: event.subject,
      text: event.bodyText || event.snippet || "",
    },
    ours: {
      step: ours?.step ?? null,
      template: ours?.template ?? null,
      subject: ours?.subject ?? null,
      body: ours?.body ?? null,
      to_email: enrollment?.toEmail ?? null,
    },
    company: { name: company?.name ?? null, domain: company?.domain ?? null },
  };
}

export interface DispositionStats {
  selected: number;
  classified: number;
  labelled: number;
  ungrounded: number;
  no_text: number;
  parse_errors: number;
  provider_rejected: number;
  /** Grounded, but an operator labelled the reply while the LLM ran. */
  skipped_labelled_meanwhile: number;
  aborted: string | null;
}

export interface RunDispositionOptions {
  limit?: number | null;
  niche?: string | null;
  runId?: string | null;
  tracer?: Tracer | null;
  now?: Date;
}

/**
 * One graph run per pending reply. Writes `classification` on every event it
 * reads (the audit record: successes and failures alike) and
 * `disposition`/`disposition_source=llm`/`classified_at` only when the
 * grounding gate passed. Each event commits on its own.
 */
export async function runDisposition(
  db: Db,
  llm: LlmClient,
  opts: RunDispositionOptions = {},
): Promise<DispositionStats> {
  const events = await pendingEvents(db, {
    model: llm.name,
    niche: opts.niche ?? null,
    limit: opts.limit ?? null,
  });
  const stats: DispositionStats = {
    selected: events.length,
    classified: 0,
    labelled: 0,
    ungrounded: 0,
    no_text: 0,
    parse_errors: 0,
    provider_rejected: 0,
    skipped_labelled_meanwhile: 0,
    aborted: null,
  };
  for (const event of events) {
    const state = await gatherState(db, event);
    let result: DispositionResult;
    try {
      result = await runGraph(llm, state, {
        runId: opts.runId ?? null,
        tracer: opts.tracer ?? null,
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      stats.aborted = err.message; // provider failure: keep partial progress
      break;
    }
    const now = opts.now ?? new Date();
    await db.transaction(async (tx) => {
      // The paid call took seconds; the label column may have moved.
      const [fresh] = await tx
        .select({ disposition: threadEvents.disposition })
        .from(threadEvents)
        .where(eq(threadEvents.id, event.id));
      const envelope: Envelope = result.llm ?? {
        raw_text: null,
        parse_error: null,
        provider_rejected: null,
        api: null,
        call: null,
      };
      await tx
        .update(threadEvents)
        .set({
          classification: {
            ...envelope,
            model: llm.name,
            prompt_version: DISPOSITION_VERSION,
            proposal: result.proposal,
            verdict: result.verdict,
            classified_at: now.toISOString(),
          },
        })
        .where(eq(threadEvents.id, event.id));
      stats.classified += 1;
      if (result.parse_error) stats.parse_errors += 1;
      if (result.provider_rejected) stats.provider_rejected += 1;
      if (result.verdict.grounded && fresh?.disposition) {
        stats.skipped_labelled_meanwhile += 1;
      } else if (result.verdict.grounded && result.verdict.disposition) {
        await labelEvent(tx, {
          event,
          disposition: result.verdict.disposition,
          now,
          source: "llm",
        });
        stats.labelled += 1;
      } else if (!state.event.text.trim()) {
        stats.no_text += 1;
      } else {
        stats.ungrounded += 1;
      }
    });
  }
  return stats;
}
