/**
 * Who a reply is from, for the event `replyFired` makes. A reply names only its thread (an
 * enrollment, a text or DM contact); the journey steps find a person by a profile id or a key.
 * So the channels read the thread's address here and the profile it already has, if any.
 * Raw SQL on the channels' tables: core holds none of their schemas.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { profileOf } from "./profiles.js";

/** `profile` (when the address has one) and the address under its key's name. */
export type ReplyWho = Record<string, string | number>;

type Channel = "email" | "sms" | "dm";

/** The address a thread's contact goes by: `{email}`, `{phone}` or `{"handle:<platform>"}`. */
async function addressOf(
  db: Queryable,
  channel: Channel,
  id: number,
): Promise<{ kind: string; value: string } | null> {
  if (channel === "email") {
    const [r] = await db.execute<{ v: string }>(
      sql`select lower(to_email) v from enrollments where id = ${id}`,
    );
    return r?.v ? { kind: "email", value: r.v } : null;
  }
  if (channel === "sms") {
    const [r] = await db.execute<{ v: string }>(
      sql`select e164 v from sms_contacts where id = ${id}`,
    );
    return r?.v ? { kind: "phone", value: r.v } : null;
  }
  const [r] = await db.execute<{ platform: string; handle: string }>(
    sql`select platform, handle from reach_contacts where id = ${id}`,
  );
  return r ? { kind: `handle:${r.platform}`, value: r.handle } : null;
}

/** Who a reply on thread `id` is from; empty when the contact is gone. Never throws on a miss. */
export async function replyWho(db: Queryable, channel: Channel, id: number): Promise<ReplyWho> {
  const a = await addressOf(db, channel, id);
  if (!a) return {};
  const profile = await profileOf(db, a);
  return { ...(profile === null ? {} : { profile }), [a.kind]: a.value };
}
