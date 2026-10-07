/**
 * Client flags (designs/2026-10-07-health.md, "Flags"): one list of risks and opportunities.
 * A source's pass hands over everything it finds; what it no longer finds clears itself. People
 * take, assign, address and clear them. Alerts go as one urgent message on the next pass and one
 * digest a day; the spine hears each raise and clear from an outbox on the row.
 */

import { clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import type { Fired } from "@wren/core/spine";
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  type ClientFlag,
  clientFlags,
  type FlagSide,
  type FlagSource,
  flagDigests,
} from "./schema.js";

const DAY = 86_400_000;
/** A reminder an hour early still counts: passes drift by minutes. */
const SLACK = 5 * 60_000;
/** The digest goes on the first pass at or after this hour, fleet time. */
export const DIGEST_HOUR = 9;
/** Who clears a flag when its cause went away. */
export const WATCH_ACTOR = "pipeline:delivery-watch";

/** A flag as a source finds it. */
export interface FlagFind {
  clientId: string;
  engagementId: number | null;
  side: FlagSide;
  cause: string;
  what: string;
  how?: string | null;
  once?: boolean;
  urgent?: boolean;
  remindDays?: number;
}

/** Starts with a capital, unless it starts with an address. */
const sentence = (s: string) => (/^\S+@/.test(s) ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`);
const keyOf = (f: { clientId: string; engagementId: number | null; cause: string }) =>
  `${f.clientId} ${f.engagementId ?? 0} ${f.cause}`;

/**
 * One source's findings this pass: new ones are raised, standing ones keep their words fresh,
 * and an open flag of that source no longer found clears itself, unless it's once-only.
 */
export async function syncFlags(
  db: Db,
  source: Exclude<FlagSource, "person">,
  found: readonly FlagFind[],
  now: Date,
): Promise<{ raised: number; cleared: number }> {
  const open = await db
    .select()
    .from(clientFlags)
    .where(and(eq(clientFlags.source, source), isNull(clientFlags.clearedAt)));
  const byKey = new Map(open.map((f) => [keyOf(f), f]));
  const seen = new Set<string>();
  let raised = 0;
  for (const f of found) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    seen.add(k);
    const what = sentence(f.what);
    const was = byKey.get(k);
    if (was) {
      const fresh = { what, how: f.how ?? null, remindDays: f.remindDays ?? 7 };
      if (was.what !== fresh.what || was.how !== fresh.how || was.remindDays !== fresh.remindDays)
        await db.update(clientFlags).set(fresh).where(eq(clientFlags.id, was.id));
      continue;
    }
    const [row] = await db
      .insert(clientFlags)
      .values({
        clientId: f.clientId,
        engagementId: f.engagementId,
        side: f.side,
        source,
        cause: f.cause,
        what,
        how: f.how ?? null,
        once: f.once ?? false,
        urgent: f.urgent ?? false,
        remindDays: f.remindDays ?? 7,
        raisedAt: now,
        raisedBy: WATCH_ACTOR,
      })
      .onConflictDoNothing()
      .returning({ id: clientFlags.id });
    if (row) raised += 1;
  }
  const gone = open.filter((f) => !f.once && !seen.has(keyOf(f))).map((f) => f.id);
  if (gone.length)
    await db
      .update(clientFlags)
      .set({ clearedAt: now, clearedBy: WATCH_ACTOR })
      .where(and(inArray(clientFlags.id, gone), isNull(clientFlags.clearedAt)));
  return { raised, cleared: gone.length };
}

// --- a person's hand ---------------------------------------------------------------

export class FlagRefusal extends Error {}

const openFlag = async (db: Queryable, id: number): Promise<ClientFlag> => {
  const [f] = await db.select().from(clientFlags).where(eq(clientFlags.id, id));
  if (!f) throw new FlagRefusal(`No flag ${id}.`);
  if (f.clearedAt) throw new FlagRefusal("That flag is already cleared.");
  return f;
};

/** A person's own flag about a client: it stands until someone clears it. */
export async function raiseFlag(
  db: Queryable,
  r: { clientId: string; side: FlagSide; what: string; owner?: string | null; by: string },
  now = new Date(),
): Promise<ClientFlag> {
  const what = r.what.trim();
  if (!what) throw new FlagRefusal("Say what it is.");
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, r.clientId));
  if (!client) throw new FlagRefusal(`No client ${r.clientId}.`);
  const [{ id } = { id: 0 }] = await db.execute<{ id: number }>(
    sql`select nextval(pg_get_serial_sequence('delivery.flags', 'id'))::int id`,
  );
  const [row] = await db
    .insert(clientFlags)
    .values({
      id,
      clientId: r.clientId,
      engagementId: null,
      side: r.side,
      source: "person",
      cause: `person:${id}`,
      what: sentence(what),
      once: true,
      owner: r.owner?.trim().toLowerCase() || null,
      raisedAt: now,
      raisedBy: r.by,
    })
    .returning();
  if (!row) throw new FlagRefusal("Not raised.");
  return row;
}

/** Who owns it: an address, or null for the team. */
export async function ownFlag(db: Queryable, id: number, owner: string | null): Promise<void> {
  await openFlag(db, id);
  await db
    .update(clientFlags)
    .set({ owner: owner?.trim().toLowerCase() || null })
    .where(eq(clientFlags.id, id));
}

/** Seen to: it stays open while its cause stands, and goes quiet. */
export async function addressFlag(
  db: Queryable,
  id: number,
  by: string,
  note: string | null,
  now = new Date(),
): Promise<void> {
  const f = await openFlag(db, id);
  if (f.addressedAt) throw new FlagRefusal("That flag is already marked addressed.");
  await db
    .update(clientFlags)
    .set({ addressedAt: now, addressedBy: by, note: note?.trim() || null })
    .where(eq(clientFlags.id, id));
}

/**
 * Cleared by hand: only a flag nothing clears by itself (a person's, an interest, a review). The
 * rest clear when their cause goes; until then they're marked addressed.
 */
export async function clearFlag(
  db: Queryable,
  id: number,
  by: string,
  now = new Date(),
): Promise<void> {
  const f = await openFlag(db, id);
  if (!f.once)
    throw new FlagRefusal("This one clears itself when its cause goes away. Mark it addressed.");
  await db.update(clientFlags).set({ clearedAt: now, clearedBy: by }).where(eq(clientFlags.id, id));
}

// --- alerts ---------------------------------------------------------------------------

const line = (f: ClientFlag) =>
  `${f.clientId}: ${f.side === "opportunity" ? "opportunity, " : ""}${f.what}${f.how ? `\n    ${f.how}` : ""}`;

/**
 * The urgent ones, raised since the last pass, in one message; then once a day from 09:00 fleet
 * time the digest: new flags first, then standing ones whose reminder came, grouped by owner.
 * Addressed flags stay quiet. A failed send is tried again next pass.
 */
export async function tellFlags(
  db: Db,
  notifier: Notifier,
  today: string,
  hour: number,
  now: Date,
): Promise<{ urgent: number; digest: number }> {
  const told = { urgent: 0, digest: 0 };
  const urgent = await db
    .select()
    .from(clientFlags)
    .where(
      and(
        isNull(clientFlags.clearedAt),
        isNull(clientFlags.addressedAt),
        isNull(clientFlags.toldAt),
        eq(clientFlags.urgent, true),
      ),
    )
    .orderBy(asc(clientFlags.id));
  if (
    urgent.length &&
    (await notifier.notify(
      `Clients: ${urgent.length} urgent`,
      urgent.map(line).join("\n"),
      "action",
    ))
  ) {
    await db
      .update(clientFlags)
      .set({ toldAt: now })
      .where(
        inArray(
          clientFlags.id,
          urgent.map((f) => f.id),
        ),
      );
    told.urgent = urgent.length;
  }
  if (hour < DIGEST_HOUR) return told;
  const [sent] = await db.select().from(flagDigests).where(eq(flagDigests.day, today));
  if (sent) return told;
  const open = await db
    .select()
    .from(clientFlags)
    .where(and(isNull(clientFlags.clearedAt), isNull(clientFlags.addressedAt)))
    .orderBy(asc(clientFlags.raisedAt), asc(clientFlags.id));
  const due = open.filter(
    (f) => !f.toldAt || f.toldAt.getTime() <= now.getTime() - f.remindDays * DAY + SLACK,
  );
  if (due.length) {
    const owners = [...new Set(due.map((f) => f.owner))].sort((a, b) =>
      a === null ? -1 : b === null ? 1 : a.localeCompare(b),
    );
    const text = owners
      .map((o) => {
        const mine = due.filter((f) => f.owner === o);
        const fresh = mine.filter((f) => !f.toldAt);
        const again = mine.filter((f) => f.toldAt);
        return [
          `${o ?? "Team"}:`,
          ...fresh.map(line),
          ...(again.length ? ["Still open:", ...again.map(line)] : []),
        ].join("\n");
      })
      .join("\n\n");
    if (!(await notifier.notify(`Clients: ${due.length} to look at`, text, "action"))) return told;
    await db
      .update(clientFlags)
      .set({ toldAt: now })
      .where(
        inArray(
          clientFlags.id,
          due.map((f) => f.id),
        ),
      );
    told.digest = due.length;
  }
  await db
    .insert(flagDigests)
    .values({ day: today, flags: due.length, at: now })
    .onConflictDoNothing();
  return told;
}

// --- the spine's outbox ---------------------------------------------------------------

/** What `trigger.flag` hears for one change to a flag. */
export function flagFired(f: ClientFlag, change: "raised" | "cleared"): Fired {
  return {
    client: null,
    facts: { trigger: "trigger.flag", change, side: f.side },
    event: {
      subject: `flag:${f.id}`,
      kind: "client",
      data: {
        flag: f.id,
        change,
        client: f.clientId,
        engagement: f.engagementId,
        side: f.side,
        source: f.source,
        cause: f.cause,
        what: f.what,
        owner: f.owner,
      },
    },
  };
}

/**
 * Every raise and clear the spine hasn't heard, marked heard now: the watch sends them once its
 * pass is journaled. A crash between the two drops them, accepted in the design.
 */
export async function flagsToFire(db: Db, now: Date): Promise<Fired[]> {
  const rows = await db
    .select()
    .from(clientFlags)
    .where(
      or(
        isNull(clientFlags.raiseFiredAt),
        and(isNotNull(clientFlags.clearedAt), isNull(clientFlags.clearFiredAt)),
      ),
    )
    .orderBy(asc(clientFlags.id));
  if (!rows.length) return [];
  const out: Fired[] = [];
  for (const f of rows) {
    if (!f.raiseFiredAt) out.push(flagFired(f, "raised"));
    if (f.clearedAt && !f.clearFiredAt) out.push(flagFired(f, "cleared"));
  }
  const ids = rows.map((f) => f.id);
  const at = now.toISOString();
  await db
    .update(clientFlags)
    .set({
      raiseFiredAt: sql`coalesce(${clientFlags.raiseFiredAt}, ${at}::timestamptz)`,
      clearFiredAt: sql`case when ${clientFlags.clearedAt} is null then null
        else coalesce(${clientFlags.clearFiredAt}, ${at}::timestamptz) end`,
    })
    .where(inArray(clientFlags.id, ids));
  return out;
}
