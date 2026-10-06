/**
 * Email follow-ups on the spine (designs/2026-10-05-workflows.md, Email on the spine). Each
 * sequence is a cadence of `email.touch` nodes, node `s<n>` for step n-1. Compose writes every
 * follow-up held. When the tick sends a step it leaves that step's node as `sent`, and the next
 * touch releases the next step at once: the tick's business-day math still picks its day.
 */
import type { SpineEvent, Step } from "@wren/core/spine";
import { cadenceId, cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Db, Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { EMAIL_TOUCH } from "./components.js";
import type { Sequence } from "./outreach/sequences.js";
import { enrollments, messages } from "./schema.js";

/** A niche's sequence as a cadence name: one cadence serves Wren and every client on the niche. */
export const emailCadenceName = (niche: string, sequence: string) => `email_${niche}_${sequence}`;

/** A sequence as its cadence. No waits on the wires: the tick keeps the days. */
export function emailCadence(niche: string, seq: Sequence): Workflow {
  return cadenceWorkflow({
    name: emailCadenceName(niche, seq.name),
    label: `Email: ${niche} ${seq.name}`,
    blurb: `${seq.steps.length} emails on business days ${seq.steps.map((s) => s.day).join(", ")}, stopping when they answer.`,
    for: "client",
    steps: seq.steps.map((s, i) => ({ touch: EMAIL_TOUCH, with: { step: i, day: s.day } })),
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

/** `email.touch` on the spine: the node's `step`, in the database of whoever's workflow it is. */
export const emailTouchStep =
  (dbFor: (client: string | null) => Db): Step =>
  async (_port, e, at) => {
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
