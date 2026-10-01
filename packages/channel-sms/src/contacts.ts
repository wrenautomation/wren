/**
 * A contact added by hand: someone who asked to be texted, or the operator's own
 * phone for a test. US or Canadian. The reason is required, because it is the
 * consent record. Enroll treats it like any other `new` contact (same basis
 * gate, same lookup).
 */
import type { Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import { toPhoneE164 } from "./phone.js";
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
