/**
 * The spine's In group step (designs/2026-10-15-channel-stats.md): is the person this event is
 * about in a People group now? Yes or no; skip when no person is found. A client's workflow
 * checks the client's own database (`open`).
 */
import * as restate from "@restatedev/restate-sdk";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { personOf } from "./message-step.js";
import { type ProfileKey, profileOf } from "./profiles.js";
import { inSegment, segmentById } from "./segments.js";
import type { SpineEvent, Step, StepAt } from "./spine.js";

/** A channel thread's subject, as its touch and Reply steps name it: `lead:email:<enrollment>`. */
const THREAD = /^(?:lead|reply):(email|sms|reach):(\d+)$/;

/** The thread an event rides on, from its subject, else the ids its data carries. */
function threadOf(e: SpineEvent): { channel: string; id: number } | null {
  const m = THREAD.exec(e.subject);
  if (m) return { channel: m[1] as string, id: Number(m[2]) };
  const enrollment = Number(e.data?.enrollmentId);
  if (Number.isSafeInteger(enrollment) && enrollment > 0)
    return { channel: "email", id: enrollment };
  const contact = Number(e.data?.contactId);
  if (Number.isSafeInteger(contact) && contact > 0)
    return { channel: e.data?.channel === "dm" ? "reach" : "sms", id: contact };
  return null;
}

/** The keys a thread's row holds: its person, then its address. */
async function threadKeys(
  db: Queryable,
  t: { channel: string; id: number },
): Promise<ProfileKey[]> {
  const q =
    t.channel === "email"
      ? sql`select person_id, to_email email, null phone, null platform, null handle
          from enrollments where id = ${t.id}`
      : t.channel === "sms"
        ? sql`select person_id, email, e164 phone, null platform, null handle
            from sms_contacts where id = ${t.id}`
        : sql`select person_id, null email, null phone, platform, handle
            from reach_contacts where id = ${t.id}`;
  const [r] = (await db.execute(q)) as unknown as Array<{
    person_id: number | null;
    email: string | null;
    phone: string | null;
    platform: string | null;
    handle: string | null;
  }>;
  if (!r) return [];
  return [
    ...(r.person_id ? [{ kind: "person", value: String(r.person_id) }] : []),
    ...(r.email ? [{ kind: "email", value: r.email }] : []),
    ...(r.phone ? [{ kind: "phone", value: r.phone }] : []),
    ...(r.platform && r.handle ? [{ kind: `handle:${r.platform}`, value: r.handle }] : []),
  ];
}

/**
 * The profile an event is about: `data.profile` or a `profile:<id>` subject; else its email or
 * phone; else the thread it rides on (an email enrollment, a text or DM contact), by the
 * thread's person, then its address.
 */
export async function profileOfEvent(db: Queryable, e: SpineEvent): Promise<number | null> {
  const named = Number(e.data?.profile ?? (/^profile:(\d+)$/.exec(e.subject)?.[1] || NaN));
  if (Number.isSafeInteger(named) && named > 0) return named;
  const p = personOf(e);
  const thread = threadOf(e);
  const keys: ProfileKey[] = [
    ...(p.email ? [{ kind: "email", value: p.email }] : []),
    ...(p.phone ? [{ kind: "phone", value: p.phone }] : []),
    ...(thread ? await threadKeys(db, thread) : []),
  ];
  for (const k of keys) {
    const id = await profileOf(db, k);
    if (id) return id;
  }
  return null;
}

/** "Would check segment 4 for sam@example.com": what a dry test says. */
export function segmentWould(w: StepAt["with"], e: SpineEvent): string {
  const p = personOf(e);
  const who = p.email || p.phone || (e.data?.profile ? `profile ${e.data.profile}` : e.subject);
  return `Would check if ${who} is in group ${String(w.segment ?? "?")}`;
}

export function segmentStep(main: Queryable, open: (client: string) => Queryable): Step {
  return async (_port, e, at) => {
    const db = at.client ? open(at.client) : main;
    const id = Number(at.with.segment);
    const seg = Number.isSafeInteger(id) ? await segmentById(db, id) : null;
    if (!seg) throw new restate.TerminalError(`In group: no group ${String(at.with.segment)}`);
    const profile = await profileOfEvent(db, e);
    if (!profile) return [{ port: "skip", event: e }];
    const yes = await inSegment(db, profile, seg, new Date());
    return [{ port: yes ? "yes" : "no", event: e }];
  };
}
