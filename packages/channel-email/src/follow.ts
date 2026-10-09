/**
 * Email follow-ups on the spine (designs/2026-10-05-workflows.md, Email on the spine). Each
 * sequence is a cadence of `email.touch` nodes, node `s<n>` for step n-1. Compose writes every
 * follow-up held. When the tick sends a step it leaves that step's node as `sent`, and the next
 * touch releases the next step at once: the tick's business-day math still picks its day.
 */
import {
  type FollowNote,
  followPartOf,
  followStart,
  isFollowTouch,
  NURTURE,
  passed,
} from "@wren/core/follow";
import { MissingFactError, renderKind } from "@wren/core/slots";
import { passOn, type SpineEvent, type Step, type StepAt } from "@wren/core/spine";
import { emailRef, refText } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import { labelOf, sequenceLabel } from "@wren/core/templates/labels";
import { cadenceId, cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Db, Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { EMAIL_TOUCH } from "./components.js";
import { activeSuppression } from "./guards.js";
import { factsFor, factsForCompany } from "./outreach/facts.js";
import type { Sequence } from "./outreach/sequences.js";
import { enrollments, messages } from "./schema.js";

/** A niche's sequence as a cadence name: one cadence serves Wren and every client on the niche. */
export const emailCadenceName = (niche: string, sequence: string) => `email_${niche}_${sequence}`;

/** A sequence as its cadence. No waits on the wires: the tick keeps the days. */
export function emailCadence(niche: string, seq: Sequence): Workflow {
  return cadenceWorkflow({
    name: emailCadenceName(niche, seq.name),
    label: `Email: ${labelOf(niche)} · ${sequenceLabel(seq.name)}`,
    blurb: `${seq.steps.length} emails on business days ${seq.steps.map((s) => s.day).join(", ")}, stopping when they answer.`,
    for: "client",
    steps: seq.steps.map((s, i) => ({
      touch: EMAIL_TOUCH,
      template: emailRef(niche, s.template),
      with: { step: i, day: s.day },
    })),
  });
}

/** One thread as a lead on the spine. */
export const emailLead = (e: {
  id: number;
  personId: number | null;
  companyId: number;
}): SpineEvent => ({
  subject: `lead:email:${e.id}`,
  kind: "lead",
  data: { enrollmentId: e.id, personId: e.personId, companyId: e.companyId },
});

/** A sent step leaving its node. */
export interface Touch {
  workflow: string;
  from: string;
  event: SpineEvent;
}

/**
 * The touches a tick's sends leave, as `[enrollment, step]` pairs. Only threads composed onto
 * the spine (a step held or released) leave any: older ones run on the tick alone.
 */
export async function spineTouches(
  db: Queryable,
  sent: readonly (readonly [number, number])[],
): Promise<Touch[]> {
  if (sent.length === 0) return [];
  const rows = await db
    .select({
      id: enrollments.id,
      niche: enrollments.niche,
      sequence: enrollments.sequenceName,
      personId: enrollments.personId,
      companyId: enrollments.companyId,
    })
    .from(enrollments)
    .where(
      and(
        inArray(enrollments.id, [...new Set(sent.map(([id]) => id))]),
        sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.enrollmentId} = ${enrollments.id}
          AND (${messages.held} OR ${messages.releasedAt} IS NOT NULL))`,
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return sent.flatMap(([id, step]) => {
    const e = byId.get(id);
    return e
      ? [
          {
            workflow: cadenceId(emailCadenceName(e.niche, e.sequence)),
            from: `s${step + 1}.sent`,
            event: emailLead(e),
          },
        ]
      : [];
  });
}

/** A stop that means they answered: a reply, or a call booked off the link. */
const ANSWERED = new Set(["reply", "booked"]);

/**
 * Let step `step` of a thread go, so the tick sends it on its day. A thread they answered says
 * "replied"; any other end releases nothing. Releasing twice is a no-op.
 */
export async function release(
  db: Queryable,
  enrollmentId: number,
  step: number,
  now: Date,
): Promise<"released" | "replied" | "ended"> {
  const [e] = await db
    .select({ state: enrollments.state, stopReason: enrollments.stopReason })
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId));
  if (e?.state === "stopped" && ANSWERED.has(e.stopReason ?? "")) return "replied";
  if (e?.state !== "active") return "ended";
  await db
    .update(messages)
    .set({ held: false, releasedAt: now })
    .where(
      and(
        eq(messages.enrollmentId, enrollmentId),
        eq(messages.step, step),
        eq(messages.held, true),
      ),
    );
  return "released";
}

/**
 * Where a follow-up's email waits for a yes: To approve, as a reply asked in the Inbox
 * (`askFollowEmail` in content). `by` names the node, so a second pass asks nothing.
 */
export type AskFollowEmail = (
  client: string | null,
  o: { subject: string; enrollmentId: number; body: string; by: string; why: string },
) => Promise<{ asked: boolean; why: string | null }>;

/**
 * One follow-up email (designs/2026-10-07-follow-up-nurture.md): our next email in their thread,
 * in the node's live words, drafted into To approve. It sends once a person says yes, in reply to
 * the last one we sent (`Disposition.followUp`). A thread they opted out of, or a fact the copy
 * needs and they lack, skips.
 */
export async function followEmail(
  db: Db,
  enrollmentId: number,
  e: SpineEvent,
  at: Pick<StepAt, "client" | "workflow" | "node" | "template" | "part">,
  o: { would: string | null; ask: AskFollowEmail | null; main: Db },
): Promise<Pick<FollowNote, "did" | "why">> {
  const [en] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
  if (!en) return { did: "skipped", why: `no email thread ${enrollmentId}` };
  if (!at.template) return { did: "skipped", why: "this step has no copy" };
  const shared = at.client ? { main: o.main, client: at.client } : null;
  if (await activeSuppression(db, en.toEmail, shared))
    return { did: "skipped", why: "they opted out of email" };
  const live = await liveOrDefault(db, at.template);
  if (!live) return { did: "skipped", why: `${refText(at.template)} has no live words` };
  if (o.would) return { did: "would_send", why: o.would };
  if (!o.ask) return { did: "skipped", why: "To approve is not wired here" };
  const facts = en.personId
    ? await factsFor(db, en.personId, null)
    : await factsForCompany(db, en.companyId, null);
  let body: string;
  try {
    body = renderKind("email", live.template, facts.values, `follow:${en.id}:${at.node}`).body;
  } catch (err) {
    if (err instanceof MissingFactError)
      return { did: "skipped", why: `the copy needs a fact they lack: ${err.message}` };
    throw err;
  }
  const got = await o.ask(at.client, {
    subject: e.subject,
    enrollmentId,
    body,
    by: `workflow:${at.workflow}/${at.node}`.slice(0, 200),
    why: `${followPartOf(at) === NURTURE ? "Nurture" : "Follow-up"}'s email: it sends once someone says yes.`,
  });
  return got.asked
    ? { did: "asked", why: null }
    : { did: "skipped", why: got.why ?? "already asked" };
}

/**
 * `email.touch` on the spine: the node's `step`, in the database of whoever's workflow it is. A
 * node with no `step` is a follow-up's email (`followEmail`).
 */
export const emailTouchStep =
  (dbFor: (client: string | null) => Db, ask: AskFollowEmail | null = null): Step =>
  async (_port, e, at) => {
    if (isFollowTouch(at)) {
      const db = dbFor(at.client);
      const main = dbFor(null);
      const start = await followStart({ db, main, channel: "email", globalOff: null }, e, at);
      if ("outs" in start) return start.outs;
      const got = await followEmail(db, start.thread, e, at, { would: start.would, ask, main });
      return passed(e, { ...start.note, ...got });
    }
    const other = passOn(e, "email");
    if (other) return other;
    const enrollmentId = Number(e.data.enrollmentId);
    if (!Number.isInteger(enrollmentId)) throw new Error(`${e.subject} is no email thread`);
    const got = await release(dbFor(at.client), enrollmentId, Number(at.with.step), new Date());
    return got === "replied"
      ? [
          {
            port: "replied",
            event: { ...e, subject: `reply:email:${enrollmentId}`, kind: "reply" },
          },
        ]
      : [];
  };
