/**
 * Enroll: pick `new` contacts the policy may text, confirm each is a mobile
 * (one carrier lookup, stored), give it its sticky number, and queue step 1.
 *
 * Who is skipped, and why it is written down: a basis the campaign does not
 * cover (left `new`), a landline or toll-free (`unreachable`), an opted-out
 * number (`opted_out`), a company that already has a running thread (left
 * `new`; one thread per company). Nothing here sends.
 */
import { activeSuppressionOf, companies, people } from "@wren/core";
import type { Db } from "@wren/db";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { SmsPolicy } from "./policy.js";
import { pickNumber } from "./pool.js";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import { type LineType, type SmsContact, smsContacts, smsMessages } from "./schema.js";
import { firstName, render, type SmsSequence } from "./templates.js";

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
  const first = opts.sequence.steps[0];
  if (!first) throw new Error(`sms sequence ${opts.sequence.name} has no steps`);
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
  for (const c of candidates) {
    if (stats.enrolled >= opts.limit) break;
    stats.considered += 1;
    if (await activeSuppressionOf(db, "phone", c.e164)) {
      await end(db, c, "opted_out", "phone suppressed", opts.now);
      stats.suppressed += 1;
      continue;
    }
    if (await companyBusy(db, c.companyId, c.id)) {
      stats.companyBusy += 1;
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
    const number = c.numberId ? { id: c.numberId } : await pickNumber(db);
    if (!number) {
      stats.noNumber = true;
      break;
    }
    const [company] = c.companyId
      ? await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, c.companyId))
      : [];
    const [person] = c.personId
      ? await db.select({ name: people.fullName }).from(people).where(eq(people.id, c.personId))
      : [];
    const body = render(first.body, {
      first_name: firstName(person?.name),
      company: company?.name ?? null,
      sender: opts.senderName,
    });
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
          template: `${opts.sequence.name}#1`,
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
