/**
 * A contact added by hand: someone who asked to be texted, or the operator's own
 * phone for a test. US or Canadian. The reason is required, because it is the
 * consent record. Enroll treats it like any other `new` contact (same basis
 * gate, same lookup). A thread started by hand from the app is never enrolled.
 */
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { queueManual } from "./deliver.js";
import { countryOf, toPhoneE164 } from "./phone.js";
import type { SmsPolicy } from "./policy.js";
import { pickNumber } from "./pool.js";
import { SmsRefusal } from "./refusal.js";
import { type ContactBasis, type SmsContact, smsContacts } from "./schema.js";

export async function addContact(
  db: Queryable,
  input: { phone: string; basis: ContactBasis; why: string; niche?: string | null },
): Promise<{ contact: SmsContact; created: boolean }> {
  const e164 = toPhoneE164(input.phone);
  if (!e164) throw new SmsRefusal(`not a US or Canadian number: ${input.phone}`);
  const why = input.why.trim();
  if (!why) throw new SmsRefusal("say why this number may be texted (it is the consent record)");
  const [have] = await db
    .select()
    .from(smsContacts)
    .where(and(eq(smsContacts.e164, e164), isNull(smsContacts.companyId)))
    .limit(1);
  if (have) return { contact: have, created: false };
  const [made] = await db
    .insert(smsContacts)
    .values({
      e164,
      sourceKind: "manual",
      basis: input.basis,
      basisDetail: why,
      niche: input.niche ?? null,
    })
    .returning();
  return { contact: made as SmsContact, created: true };
}

/**
 * Text someone who asked for it, from the app. A phone that already has a
 * thread gets the text there; a new one becomes an `opt_in` contact (the reason
 * is the record) on the pool number for its country, ended so no sequence ever
 * takes it. Sent by the next tick, like a reply.
 */
export async function startThread(
  db: Queryable,
  input: {
    phone: string;
    why: string;
    body: string;
    now: Date;
    policy: Pick<SmsPolicy, "monthlyPerContact">;
  },
): Promise<{ contactId: number; messageId: number }> {
  const e164 = toPhoneE164(input.phone);
  if (!e164) throw new SmsRefusal(`not a US or Canadian number: ${input.phone}`);
  if (!input.body.trim()) throw new SmsRefusal("empty message");
  const [thread] = await db
    .select()
    .from(smsContacts)
    .where(and(eq(smsContacts.e164, e164), isNotNull(smsContacts.numberId)))
    .orderBy(desc(smsContacts.id))
    .limit(1);
  let contact = thread;
  if (!contact) {
    const country = countryOf(e164);
    const number = country ? await pickNumber(db, country) : null;
    if (!number) throw new SmsRefusal(`no pool number texts ${country ?? "that"} phones`);
    const { contact: added } = await addContact(db, {
      phone: e164,
      basis: "opt_in",
      why: input.why,
    });
    const [ended] = await db
      .update(smsContacts)
      .set({
        numberId: number.id,
        ...(added.state === "new"
          ? { state: "finished", stateReason: "started by hand in the app", endedAt: input.now }
          : {}),
      })
      .where(eq(smsContacts.id, added.id))
      .returning();
    contact = ended as SmsContact;
  }
  const msg = await queueManual(db, {
    contactId: contact.id,
    body: input.body,
    now: input.now,
    policy: input.policy,
  });
  return { contactId: contact.id, messageId: msg.id };
}
