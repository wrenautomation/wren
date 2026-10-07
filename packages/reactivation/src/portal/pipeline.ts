/**
 * The work as one line of steps, for the portal's rail: from the list as it
 * came in to the replies. Each step says how far it got and what it waits on.
 * Read from what `crm status` reads, so the rail and the CLI never disagree.
 */
import type { Client } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { REACTIVATION } from "../compose.js";
import { readClientProfile } from "../profile.js";
import { reactivationSettingsOf } from "../settings.js";
import { type CrmStatus, crmStatus } from "../status.js";

export const PIPELINE_STEPS = [
  "list",
  "emails",
  "where",
  "hiring",
  "score",
  "briefs",
  "drafts",
  "approve",
  "sent",
  "replies",
] as const;
export type PipelineStepId = (typeof PIPELINE_STEPS)[number];

/**
 * `done`: nothing left to do here. `next`: work is due and runs on the next pass.
 * `waiting`: parked on a daily cap until `resumesAt`, or on Wren's team (an approve that isn't
 * this login's). `yours`: waits on the client.
 * `idle`: nothing has reached it yet.
 */
export type StepState = "done" | "next" | "waiting" | "yours" | "idle";

export interface PipelineStep {
  id: PipelineStepId;
  count: number;
  /** Out of how many, when the step works through a set: 18 of 21 looked up. */
  of: number | null;
  state: StepState;
  /** When a parked step starts again. */
  resumesAt: string | null;
  /** How many are parked. */
  parked: number;
}

export interface Pipeline {
  steps: PipelineStep[];
  /** The demo never sends: its Sent step stays idle on purpose. */
  sends: boolean;
}

const at = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);

/** Due work runs next; parked work waits for its cap; otherwise it's done if it made anything. */
function stateOf(count: number, due: number, parkedUntil: string | null): StepState {
  if (due > 0) return "next";
  if (parkedUntil) return "waiting";
  return count > 0 ? "done" : "idle";
}

/** `approves`: this login says yes to the emails (`mayApprove`); else its approve step waits. */
export function pipelineOf(
  s: CrmStatus,
  replies: number,
  sends: boolean,
  approves = true,
): Pipeline {
  const v = s.health.verification;
  const addresses = v.valid + v.invalid + v.risky + v.catch_all + v.unchecked;
  const people = s.health.people;
  const companies = s.health.companies;
  const lookedUp = s.lookup.matched + s.lookup.unresolved;
  const checked = s.signals.hiring + s.signals.noOpenings + s.signals.unresolved;
  const e = s.emails;
  const step = (
    id: PipelineStepId,
    count: number,
    of: number | null,
    state: StepState,
    parked?: { n: number; until: string | null },
  ): PipelineStep => ({
    id,
    count,
    of,
    state,
    resumesAt: parked?.until ? at(parked.until) : null,
    parked: parked?.until ? parked.n : 0,
  });
  const lookupPark = { n: s.lookup.capped, until: s.lookup.waitingUntil };
  const signalPark = { n: s.signals.capped, until: s.signals.waitingUntil };
  return {
    sends,
    steps: [
      step("list", people, null, s.health.rows > 0 ? "done" : "idle"),
      step("emails", addresses - v.unchecked, addresses, stateOf(addresses, v.unchecked, null)),
      step(
        "where",
        lookedUp,
        people,
        stateOf(lookedUp, s.lookup.due, lookupPark.until),
        lookupPark,
      ),
      step(
        "hiring",
        checked,
        companies,
        stateOf(checked, s.signals.due, signalPark.until),
        signalPark,
      ),
      step("score", s.score.scored, people, stateOf(s.score.scored, s.score.due, null)),
      step("briefs", s.briefs.written, null, stateOf(s.briefs.written, s.briefs.due, null)),
      step("drafts", e.drafted, null, stateOf(e.drafted, e.due, null)),
      step(
        "approve",
        e.awaiting,
        null,
        e.awaiting > 0
          ? approves
            ? "yours"
            : "waiting"
          : e.approved + e.sent > 0
            ? "done"
            : "idle",
      ),
      step(
        "sent",
        e.sent,
        null,
        // Approved but sending off isn't done: it's held.
        e.approved > 0 ? (sends ? "next" : "idle") : e.sent > 0 ? "done" : "idle",
      ),
      step("replies", replies, null, replies > 0 ? "done" : "idle"),
    ],
  };
}

export async function portalPipeline(
  db: Queryable,
  client: Client,
  approves = true,
): Promise<Pipeline> {
  const settings = reactivationSettingsOf(client.products);
  const status = await crmStatus(db, {
    compose: { settings, profile: await readClientProfile(db), demo: client.demo },
  });
  const [r] = await db.execute<{ n: number }>(sql`
    select count(*)::int n from thread_events t join enrollments e on e.id = t.enrollment_id
    where t.kind = 'reply' and e.niche = ${REACTIVATION}`);
  return pipelineOf(
    status,
    r?.n ?? 0,
    !client.demo && settings.on && settings.stages.send,
    approves,
  );
}
