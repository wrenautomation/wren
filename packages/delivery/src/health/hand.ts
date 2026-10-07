/**
 * A person's say on a client's health (designs/2026-10-07-health.md): Wren's own 1 to 5 rating,
 * which counts in sentiment, and an override that stands beside the model's score until cleared.
 * Both are kept; nothing here is deleted.
 */
import { clients } from "@wren/core/clients";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import { FlagRefusal } from "./flags.js";
import { healthOverrides, healthRatings } from "./schema.js";

async function known(db: Queryable, clientId: string): Promise<void> {
  const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw new FlagRefusal(`No client ${clientId}.`);
}

/** Wren's read of a client, 1 to 5, with an optional note. */
export async function rateClient(
  db: Queryable,
  r: { clientId: string; score: number; note?: string | null; by: string },
  now = new Date(),
): Promise<void> {
  if (!Number.isInteger(r.score) || r.score < 1 || r.score > 5)
    throw new FlagRefusal("A rating is a whole number from 1 to 5.");
  await known(db, r.clientId);
  await db.insert(healthRatings).values({
    clientId: r.clientId,
    score: r.score,
    note: r.note?.trim() || null,
    by: r.by,
    at: now,
  });
}

/** A score over the model's, 0 to 100, with why. A standing one is replaced, and kept. */
export async function overrideHealth(
  db: Queryable,
  r: { clientId: string; score: number; reason: string; by: string },
  now = new Date(),
): Promise<void> {
  if (!Number.isInteger(r.score) || r.score < 0 || r.score > 100)
    throw new FlagRefusal("An override is a whole number from 0 to 100.");
  const reason = r.reason.trim();
  if (!reason) throw new FlagRefusal("Say why.");
  await known(db, r.clientId);
  await atomic(db, async (tx) => {
    await tx
      .update(healthOverrides)
      .set({ clearedAt: now, clearedBy: r.by })
      .where(and(eq(healthOverrides.clientId, r.clientId), isNull(healthOverrides.clearedAt)));
    await tx
      .insert(healthOverrides)
      .values({ clientId: r.clientId, score: r.score, reason, by: r.by, at: now });
  });
}

/** Back to the model's score. */
export async function clearOverride(
  db: Queryable,
  clientId: string,
  by: string,
  now = new Date(),
): Promise<void> {
  const done = await db
    .update(healthOverrides)
    .set({ clearedAt: now, clearedBy: by })
    .where(and(eq(healthOverrides.clientId, clientId), isNull(healthOverrides.clearedAt)))
    .returning({ id: healthOverrides.id });
  if (!done.length) throw new FlagRefusal("No override stands for that client.");
}
