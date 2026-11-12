/**
 * The Add box's queue (designs/2026-11-12-canon-references.md, D4): the portal asks, a drain
 * files. Claims take `for update skip locked` plus a lease, so any number of machines can drain;
 * a lease that runs out (the machine died) frees the row for the next claim.
 */
import type { Db } from "@wren/db";
import { and, desc, eq, gt, ne, or, sql } from "drizzle-orm";
import { type CanonAddRequest, canonAddRequests as t } from "./canon-adds-schema.js";

export type { CanonAddRequest } from "./canon-adds-schema.js";

/** a claim after this many is a failure: the link or file is the problem, not the machine */
const MAX_ATTEMPTS = 3;
/** a breakdown with frames can run long; `renew` extends it while the work goes on */
const LEASE_MS = 20 * 60_000;

const LINK = /^https?:\/\/\S+$/;
export const STORED_FILE = /^s3:\/\/[\w.-]+\/media\/[0-9a-f]{32}\.[a-z0-9]+$/;

/** what the row is: a link or a stored file, else null */
export const whatOf = (what: string) =>
  LINK.test(what) ? "link" : STORED_FILE.test(what) ? "file" : null;

/** Canon's name for a person: the local part of their email (`william@…` → `william`). */
const personOf = (email: string) => email.split("@")[0]?.toLowerCase() || email;

interface AddAsk {
  what: string;
  fileName?: string | null;
  note?: string | null;
  askedBy: string;
}

/** One ask; the same link or file still open answers the open row, its note added. */
export async function enqueueAdd(db: Db, a: AddAsk): Promise<CanonAddRequest> {
  const what = a.what.trim();
  if (!whatOf(what)) throw new Error("give a link (https://…) or a file");
  const note = a.note?.trim() || null;
  const [open] = await db
    .select()
    .from(t)
    .where(and(eq(t.what, what), or(eq(t.state, "pending"), eq(t.state, "failed"))))
    .limit(1);
  if (open) {
    const [row] = await db
      .update(t)
      .set({
        note:
          note && open.note && !open.note.includes(note)
            ? `${open.note}\n\n${note}`
            : (note ?? open.note),
        state: "pending",
        attempts: 0,
        error: null,
      })
      .where(eq(t.id, open.id))
      .returning();
    return row as CanonAddRequest;
  }
  const [row] = await db
    .insert(t)
    .values({
      what,
      fileName: a.fileName?.trim() || null,
      note,
      person: personOf(a.askedBy),
      askedBy: a.askedBy,
    })
    .returning();
  return row as CanonAddRequest;
}

/** The open asks, then the ones filed in the last day: newest first. */
export async function listAdds(db: Db, limit = 30): Promise<CanonAddRequest[]> {
  return db
    .select()
    .from(t)
    .where(or(ne(t.state, "done"), gt(t.doneAt, sql`now() - interval '1 day'`)))
    .orderBy(desc(t.at))
    .limit(limit);
}

/** A failed ask back in line, its tries reset. */
export async function retryAdd(db: Db, id: number): Promise<CanonAddRequest | null> {
  const [row] = await db
    .update(t)
    .set({ state: "pending", attempts: 0, error: null, worker: null, leaseUntil: null })
    .where(and(eq(t.id, id), eq(t.state, "failed")))
    .returning();
  return row ?? null;
}

/**
 * The oldest open ask, now this worker's. A claim whose lease ran out counts as open; past
 * MAX_ATTEMPTS it fails instead, so a link that kills the machine can't loop forever.
 */
export async function claimAdd(
  db: Db,
  worker: string,
  leaseMs = LEASE_MS,
): Promise<CanonAddRequest | null> {
  await db
    .update(t)
    .set({
      state: "failed",
      error: sql`coalesce(${t.error}, 'stopped mid-add, ' || ${t.attempts} || ' times')`,
    })
    .where(
      and(
        eq(t.state, "claimed"),
        sql`${t.leaseUntil} < now()`,
        sql`${t.attempts} >= ${MAX_ATTEMPTS}`,
      ),
    );
  const [row] = await db
    .update(t)
    .set({
      state: "claimed",
      worker,
      leaseUntil: sql`now() + ${`${leaseMs} milliseconds`}::interval`,
      attempts: sql`${t.attempts} + 1`,
    })
    .where(
      sql`${t.id} = (select id from canon_add_requests
        where state = 'pending' or (state = 'claimed' and lease_until < now())
        order by at limit 1 for update skip locked)`,
    )
    .returning();
  return row ?? null;
}

/** Still working: push the lease out. False when the claim was lost. */
export async function renewAdd(db: Db, id: number, worker: string, leaseMs = LEASE_MS) {
  const rows = await db
    .update(t)
    .set({ leaseUntil: sql`now() + ${`${leaseMs} milliseconds`}::interval` })
    .where(and(eq(t.id, id), eq(t.worker, worker), eq(t.state, "claimed")))
    .returning({ id: t.id });
  return rows.length > 0;
}

export async function finishAdd(db: Db, id: number, worker: string, records: string[]) {
  await db
    .update(t)
    .set({ state: "done", records, doneAt: sql`now()`, error: null, leaseUntil: null })
    .where(and(eq(t.id, id), eq(t.worker, worker)));
}

/** A failure the drain caught: back in line until MAX_ATTEMPTS, then failed for a person. */
export async function failAdd(db: Db, id: number, worker: string, error: string) {
  await db
    .update(t)
    .set({
      state: sql`case when ${t.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
      error: error.slice(0, 2000),
      leaseUntil: null,
    })
    .where(and(eq(t.id, id), eq(t.worker, worker)));
}
