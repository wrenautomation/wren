/**
 * Enroll: pick `new` contacts the policy may text, confirm each is a mobile
 * (one carrier lookup, stored), give it its sticky number, and queue step 1.
 *
 * Who is skipped, and why it is written down: a basis the campaign does not
 * cover (left `new`), a landline or toll-free (`unreachable`), an opted-out
 * number (`opted_out`), a company that already has a running thread (left
 * `new`; one thread per company). Nothing here sends. A sequence with any
 * step still empty (template-store.ts) enrolls no one.
 */
import { activeSuppressionsOf } from "@wren/core";
import type { Db } from "@wren/db";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { countryOf } from "./phone.js";
import type { SmsPolicy } from "./policy.js";
import { pickNumber } from "./pool.js";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import { type LineType, type SmsContact, smsContacts, smsMessages } from "./schema.js";
import { fieldsFor, templateBodies } from "./template-store.js";
import { render, type SmsSequence, stepKey } from "./templates.js";

/** Line types that take a text. VoIP business lines usually do; landlines and switchboards never. */
export const TEXTABLE: ReadonlySet<LineType> = new Set(["mobile", "voip"]);

export interface EnrollOptions {
  sequence: SmsSequence;
  policy: SmsPolicy;
  provider: SmsProvider;
  senderName: string;
  niche?: string | null;
  heldNiches: readonly string[];
  limit: number;
  now: Date;
  runId?: string | null;
}

export interface EnrollStats {
  considered: number;
  enrolled: number;
  lookedUp: number;
  notTextable: number;
  suppressed: number;
  companyBusy: number;
  /** Some contact had no active pool number in its country: left `new`. */
  noNumber: boolean;
  lookupErrors: string[];
}

async function companyBusy(db: Db, companyId: number | null, selfId: number): Promise<boolean> {
  if (companyId === null) return false;
  const [row] = await db
    .select({ id: smsContacts.id })
    .from(smsContacts)
    .where(
      and(
        eq(smsContacts.companyId, companyId),
        inArray(smsContacts.state, ["enrolled", "replied"]),
        sql`${smsContacts.id} <> ${selfId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function end(db: Db, c: SmsContact, state: SmsContact["state"], reason: string, now: Date) {
  await db
    .update(smsContacts)
    .set({ state, stateReason: reason, endedAt: now })
    .where(eq(smsContacts.id, c.id));
}

export async function enroll(db: Db, opts: EnrollOptions): Promise<EnrollStats> {
  const stats: EnrollStats = {
    considered: 0,
    enrolled: 0,
    lookedUp: 0,
    notTextable: 0,
    suppressed: 0,
    companyBusy: 0,
    noNumber: false,
    lookupErrors: [],
  };
  const keys = opts.sequence.steps.map((s) => stepKey(opts.sequence.name, s.step));
  const bodies = await templateBodies(db, keys);
  const empty = keys.filter((k) => !bodies.has(k));
  if (empty.length > 0)
    throw new SmsRefusal(
      `fill ${empty.join(", ")} first (phone app → Templates, or wren sms templates set)`,
    );
  const opener = bodies.get(keys[0] as string) as string;
  const where = [eq(smsContacts.state, "new"), inArray(smsContacts.basis, [...opts.policy.bases])];
  if (opts.niche) where.push(eq(smsContacts.niche, opts.niche));
  if (opts.heldNiches.length > 0) {
    where.push(
      or(isNull(smsContacts.niche), notInArray(smsContacts.niche, [...opts.heldNiches])) as never,
    );
  }
  // Oldest first, so a re-run continues where the last one stopped. Over-read a
  // little: some candidates will be skipped.
  const candidates = await db
    .select()
    .from(smsContacts)
    .where(and(...where))
    .orderBy(asc(smsContacts.id))
    .limit(opts.limit * 4);
  const suppressed = await activeSuppressionsOf(
    db,
    "phone",
    candidates.map((c) => c.e164),
  );
  for (const c of candidates) {
    if (stats.enrolled >= opts.limit) break;
    stats.considered += 1;
    if (suppressed(c.e164)) {
      await end(db, c, "opted_out", "phone suppressed", opts.now);
      stats.suppressed += 1;
      continue;
    }
    if (await companyBusy(db, c.companyId, c.id)) {
      stats.companyBusy += 1;
      continue;
    }
    // A number first: a lookup for a phone no pool number can text is money for nothing.
    const country = countryOf(c.e164);
    const number = c.numberId ? { id: c.numberId } : country ? await pickNumber(db, country) : null;
    if (!number) {
      stats.noNumber = true;
      continue;
    }
    let lineType = c.lineType;
    if (c.lookedUpAt === null) {
      try {
        const found = await opts.provider.lookup(c.e164);
        lineType = found.lineType;
        await db
          .update(smsContacts)
          .set({
            lineType,
            carrier: found.carrier,
            lookup: found.raw as object,
            lookedUpAt: opts.now,
          })
          .where(eq(smsContacts.id, c.id));
        stats.lookedUp += 1;
      } catch (err) {
        // No carrier at all is not one bad number: stop the run.
        if (err instanceof SmsRefusal) throw err;
        stats.lookupErrors.push(`${c.e164}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    if (!TEXTABLE.has(lineType)) {
      await end(db, c, "unreachable", `line type ${lineType}`, opts.now);
      stats.notTextable += 1;
      continue;
    }
    const body = render(opener, await fieldsFor(db, c, opts.senderName));
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(smsContacts)
          .set({
            state: "enrolled",
            stateReason: null,
            numberId: number.id,
            sequence: opts.sequence.name,
            enrolledAt: opts.now,
          })
          .where(and(eq(smsContacts.id, c.id), eq(smsContacts.state, "new")));
        await tx.insert(smsMessages).values({
          contactId: c.id,
          direction: "out",
          kind: "sequence",
          step: 1,
          template: keys[0] as string,
          numberId: number.id,
          toE164: c.e164,
          body,
          state: "queued",
          dueAt: opts.now,
          runId: opts.runId ?? null,
        });
      });
      stats.enrolled += 1;
    } catch (err) {
      // The same phone is already running under another company (the partial unique index).
      if (
        String(
          (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code,
        ) === "23505"
      ) {
        stats.companyBusy += 1;
        continue;
      }
      throw err;
    }
  }
  return stats;
}
