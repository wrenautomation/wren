/**
 * DM follow-ups on the spine, as texts do (channel-sms/src/follow.ts). Each sequence is a cadence
 * of `reach.touch` nodes. Enroll queues the opener, or the invite, whose send queues step 1. When
 * the tick sends a step it leaves that node as `sent`; the next touch queues the next DM due now.
 */
import { type FollowNote, followStart, isFollowTouch, passed } from "@wren/core/follow";
import { passOn, type SpineEvent, type Step, type StepAt } from "@wren/core/spine";
import { refText } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import { labelOf, sequenceLabel } from "@wren/core/templates/labels";
import { cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fieldsFor } from "./contacts.js";
import { reachContacts, reachMessages } from "./schema.js";
import { dmSeed, type ReachSequence, render, stepKey } from "./sequences.js";
import { dmRef } from "./store.js";
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
    label: `DMs: ${sequenceLabel(seq.name)}`,
    blurb: `${seq.steps.length} ${labelOf(seq.platform)} ${seq.steps.length === 1 ? "message" : "messages"}${seq.connectFirst ? " after an accepted invite" : ""}, stopping when they answer.`,
    for: "wren",
    steps: seq.steps.map((s) => ({
      touch: "reach.touch",
      template: dmRef(stepKey(seq, s.step)),
      with: { step: s.step },
      ...(s.afterDays > 0 ? { after: `${s.afterDays} day${s.afterDays === 1 ? "" : "s"}` } : {}),
    })),
  });
}

/** Contact states a follow-up never writes to: they said stop, blocked us, or can't be reached. */
const NEVER = new Set(["opted_out", "blocked", "unreachable"]);

/**
 * One follow-up DM (designs/2026-10-07-follow-up-nurture.md): only on a thread we already wrote
 * on, from the contact's own account, in the node's live words, queued due now as kind
 * `follow_up` for the sender, which keeps the window and the account's caps. One per contact
 * and node, however often it runs.
 */
export async function followDm(
  db: Queryable,
  contactId: number,
  at: Pick<StepAt, "workflow" | "node" | "template">,
  o: { sender: string; would: string | null; now: Date },
): Promise<Pick<FollowNote, "did" | "why">> {
  const [c] = await db.select().from(reachContacts).where(eq(reachContacts.id, contactId));
  if (!c) return { did: "skipped", why: `no DM contact ${contactId}` };
  if (NEVER.has(c.state)) return { did: "skipped", why: `their DMs ended: ${c.state}` };
  if (!c.accountId) return { did: "skipped", why: "no account of ours on the thread" };
  const [wrote] = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.contactId, c.id),
        eq(reachMessages.direction, "out"),
        inArray(reachMessages.kind, ["sequence", "manual"]),
        eq(reachMessages.state, "sent"),
      ),
    )
    .limit(1);
  if (!wrote) return { did: "skipped", why: "we never wrote to them here" };
  if (!at.template) return { did: "skipped", why: "this step has no copy" };
  const live = await liveOrDefault(db, at.template);
  if (!live) return { did: "skipped", why: `${refText(at.template)} has no live words` };
  if (o.would) return { did: "would_send", why: o.would };
  const key = `${at.workflow}/${at.node}`;
  const [queued] = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.contactId, c.id),
        eq(reachMessages.kind, "follow_up"),
        sql`${reachMessages.provenance}->>'follow' = ${key}`,
      ),
    );
  if (queued) return { did: "queued", why: null };
  const text = render(live.template, fieldsFor(c, o.sender), dmSeed(c.id));
  await db
    .insert(reachMessages)
    .values({
      contactId: c.id,
      accountId: c.accountId,
      direction: "out",
      kind: "follow_up",
      template: at.template.name,
      templateVersion: text.provenance.version,
      provenance: { ...text.provenance, follow: key },
      body: text.body,
      state: "queued",
      dueAt: o.now,
    })
    .onConflictDoNothing();
  return { did: "queued", why: null };
}

/** What a follow-up DM needs besides the client's database: why DMs can't go now, null when on. */
export interface FollowDms {
  off: (client: string | null) => string | null | Promise<string | null>;
}

/**
 * `reach.touch` on the spine: the node's `step`, queued in the database of whoever's run it is
 * (Wren's main, or a client's own). The client's sender sends it once its live flag is on. A
 * node with no `step` is a follow-up touch (`followDm`); `db` is then also where clients are.
 */
export const touchStep =
  (
    db: Queryable,
    o: Pick<TickOptions, "sequences" | "sender">,
    clientDb?: (client: string) => Queryable,
    follow?: FollowDms,
  ): Step =>
  async (_port, e, at) => {
    if (at.client && !clientDb) throw new Error(`no database for ${at.client}'s DMs here`);
    const on = at.client && clientDb ? clientDb(at.client) : db;
    if (isFollowTouch(at)) {
      if (!follow) throw new Error("follow-up DMs are not set up here");
      const start = await followStart(
        { db: on, main: db, channel: "dm", globalOff: await follow.off(at.client) },
        e,
        at,
      );
      if ("outs" in start) return start.outs;
      const got = await followDm(on, start.thread, at, {
        sender: o.sender,
        would: start.would,
        now: new Date(),
      });
      return passed(e, { ...start.note, ...got });
    }
    const other = passOn(e, "reach");
    if (other) return other;
    const contactId = Number(e.data.contactId);
    if (!Number.isInteger(contactId)) throw new Error(`${e.subject} is no DM contact`);
    const got = await touch(on, contactId, Number(at.with.step), { ...o, now: new Date() });
    return got === "replied"
      ? [{ port: "replied", event: { ...e, subject: `reply:reach:${contactId}`, kind: "reply" } }]
      : [];
  };
