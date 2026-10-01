/**
 * Enroll: pick `new` contacts on a platform, give each the lightest active
 * account, and queue the first thing to go: the invite (LinkedIn) or step 1
 * (Reddit). Nothing here sends. A sequence with any step still empty
 * (store.ts) enrolls no one. A contact with no page read yet is enrolled
 * anyway; the template's fallbacks cover the blanks.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { activeAccounts } from "./accounts.js";
import { fieldsFor, loadByAccount } from "./contacts.js";
import { ReachRefusal } from "./refusal.js";
import { type ReachContact, reachContacts, reachMessages } from "./schema.js";
import { CONNECT_NOTE, type ReachSequence, render, stepKey, subjectKey } from "./sequences.js";
import { templateBodies } from "./store.js";

export interface EnrollOptions {
  sequence: ReachSequence;
  sender: string;
  /** Only these contacts. Unset = any `new` contact on the platform. */
  contactIds?: readonly number[];
  /** Only contacts whose page was read (richer first lines). */
  enrichedOnly?: boolean;
  limit: number;
  now: Date;
  runId?: string | null;
}

export interface EnrollStats {
  considered: number;
  enrolled: number;
  /** No active account on the platform: nobody enrolled. */
  noAccount: boolean;
}

/** The bodies a sequence needs, or a refusal naming the empty slot. */
export async function sequenceBodies(
  db: Queryable,
  seq: ReachSequence,
): Promise<Map<string, string>> {
  const keys = seq.steps.flatMap((s) => [
    stepKey(seq, s.step),
    ...(s.subject ? [subjectKey(seq, s.step)] : []),
  ]);
  if (seq.connectFirst) keys.push(CONNECT_NOTE);
  const bodies = await templateBodies(db, keys);
  const missing = keys.filter((k) => k !== CONNECT_NOTE && !bodies.has(k));
  if (missing.length)
    throw new ReachRefusal(`sequence ${seq.name} has empty steps: ${missing.join(", ")}`);
  return bodies;
}

export async function enroll(db: Queryable, o: EnrollOptions): Promise<EnrollStats> {
  const seq = o.sequence;
  const bodies = await sequenceBodies(db, seq);
  const accounts = await activeAccounts(db, seq.platform);
  if (accounts.length === 0) return { considered: 0, enrolled: 0, noAccount: true };
  const load = await loadByAccount(db, seq.platform);
  const lightest = () =>
    [...accounts].sort(
      (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0),
    )[0] as (typeof accounts)[number];

  const candidates: ReachContact[] = await db
    .select()
    .from(reachContacts)
    .where(
      and(
        eq(reachContacts.platform, seq.platform),
        eq(reachContacts.state, "new"),
        o.contactIds ? inArray(reachContacts.id, [...o.contactIds]) : undefined,
        o.enrichedOnly ? isNotNull(reachContacts.enrichedAt) : undefined,
      ),
    )
    .orderBy(asc(reachContacts.createdAt))
    .limit(Math.max(o.limit, 0));

  let enrolled = 0;
  for (const c of candidates) {
    const account = lightest();
    const fields = fieldsFor(c, o.sender);
    const first = seq.steps[0];
    if (!first) continue;
    let queued: typeof reachMessages.$inferInsert;
    try {
      queued = seq.connectFirst
        ? {
            contactId: c.id,
            accountId: account.id,
            direction: "out",
            kind: "connect",
            template: CONNECT_NOTE,
            body: bodies.has(CONNECT_NOTE)
              ? render(bodies.get(CONNECT_NOTE) as string, fields)
              : "",
            state: "queued",
            dueAt: o.now,
            runId: o.runId ?? null,
          }
        : {
            contactId: c.id,
            accountId: account.id,
            direction: "out",
            kind: "sequence",
            step: first.step,
            template: stepKey(seq, first.step),
            subject: first.subject
              ? render(bodies.get(subjectKey(seq, first.step)) as string, fields)
              : null,
            body: render(bodies.get(stepKey(seq, first.step)) as string, fields),
            state: "queued",
            dueAt: o.now,
            runId: o.runId ?? null,
          };
    } catch (err) {
      // A field with no fallback and no value: left `new`, said why.
      await db
        .update(reachContacts)
        .set({ stateReason: err instanceof Error ? err.message : String(err) })
        .where(eq(reachContacts.id, c.id));
      continue;
    }
    await db
      .update(reachContacts)
      .set({
        state: "enrolled",
        stateReason: null,
        accountId: account.id,
        sequence: seq.name,
        enrolledAt: o.now,
      })
      .where(eq(reachContacts.id, c.id));
    await db.insert(reachMessages).values(queued);
    load.set(account.id, (load.get(account.id) ?? 0) + 1);
    enrolled++;
  }
  return { considered: candidates.length, enrolled, noAccount: false };
}
