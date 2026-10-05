/**
 * DM follow-ups on the spine, as texts do (channel-sms/src/follow.ts). Each sequence is a cadence
 * of `reach.touch` nodes. Enroll queues the opener, or the invite, whose send queues step 1. When
 * the tick sends a step it leaves that node as `sent`; the next touch queues the next DM due now.
 */
import type { SpineEvent, Step } from "@wren/core/spine";
import { cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Queryable } from "@wren/db";
import type { ReachSequence } from "./sequences.js";
import { type TickOptions, touch } from "./tick.js";

/** One DM contact as a lead on the spine. */
export const reachLead = (contactId: number): SpineEvent => ({
  subject: `lead:reach:${contactId}`,
  kind: "lead",
  data: { contactId },
});

/** A sequence as its cadence: step n is node `s<n>`, waiting its days after the one before. */
export function reachCadence(seq: ReachSequence): Workflow {
  return cadenceWorkflow({
    name: seq.name,
    label: `DMs: ${seq.name}`,
    blurb: `${seq.steps.length} ${seq.platform} messages${seq.connectFirst ? " after an accepted invite" : ""}, stopping when they answer.`,
    for: "wren",
    steps: seq.steps.map((s) => ({
      touch: "reach.touch",
      with: { step: s.step },
      ...(s.afterDays > 0 ? { after: `${s.afterDays} day${s.afterDays === 1 ? "" : "s"}` } : {}),
    })),
  });
}

/** `reach.touch` on the spine: the node's `step`. DMs are Wren's only, in main. */
export const touchStep =
  (db: Queryable, o: Pick<TickOptions, "sequences" | "sender">): Step =>
  async (_port, e, at) => {
    const contactId = Number(e.data.contactId);
    if (!Number.isInteger(contactId)) throw new Error(`${e.subject} is no DM contact`);
    const got = await touch(db, contactId, Number(at.with.step), { ...o, now: new Date() });
    return got === "replied"
      ? [{ port: "replied", event: { ...e, subject: `reply:reach:${contactId}`, kind: "reply" } }]
      : [];
  };
