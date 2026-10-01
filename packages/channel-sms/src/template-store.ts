/**
 * William's words for the slots templates.ts declares. Saving checks the body
 * against its slot; an empty body deletes the row, so "empty" has one meaning.
 * A keyword reply is pushed to the provider before it is stored: if the
 * provider refuses, nothing is saved.
 */
import { companies, people } from "@wren/core";
import type { Queryable } from "@wren/db";
import { eq, inArray } from "drizzle-orm";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import { type SmsContact, smsTemplates } from "./schema.js";
import {
  checkBody,
  firstName,
  KEYWORD_SLOTS,
  KEYWORD_WORDS,
  keywordOf,
  REMINDER_SLOTS,
  type RenderFields,
  render,
  type Segments,
  type SmsSequence,
  sampleFields,
  segments,
  sequenceSlots,
  type TemplateSlot,
} from "./templates.js";

export interface SlotView extends TemplateSlot {
  /** "" when empty. */
  body: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The body with sample fields filled in; "" when empty. */
  preview: string;
  /** Billed parts of the preview; null when empty. */
  segments: Segments | null;
}

/** Every slot: each sequence's steps, the reminders, then the keyword replies. */
export function slotsOf(sequences: Iterable<SmsSequence>): TemplateSlot[] {
  return [...[...sequences].flatMap(sequenceSlots), ...REMINDER_SLOTS, ...KEYWORD_SLOTS];
}

/** What a sequence text fills in for this contact. */
export async function fieldsFor(
  db: Queryable,
  contact: Pick<SmsContact, "companyId" | "personId" | "name">,
  sender: string,
): Promise<RenderFields> {
  const [company] = contact.companyId
    ? await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, contact.companyId))
    : [];
  const [person] = contact.personId
    ? await db.select({ name: people.fullName }).from(people).where(eq(people.id, contact.personId))
    : [];
  return {
    first_name: firstName(person?.name ?? contact.name),
    company: company?.name ?? null,
    sender,
    time: null,
  };
}

/** The filled bodies among `keys`; an empty slot is absent. */
export async function templateBodies(
  db: Queryable,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ key: smsTemplates.key, body: smsTemplates.body })
    .from(smsTemplates)
    .where(inArray(smsTemplates.key, [...keys]));
  return new Map(rows.map((r) => [r.key, r.body]));
}

export async function listTemplates(
  db: Queryable,
  slots: readonly TemplateSlot[],
  sender: string,
): Promise<SlotView[]> {
  const rows =
    slots.length === 0
      ? []
      : await db
          .select()
          .from(smsTemplates)
          .where(
            inArray(
              smsTemplates.key,
              slots.map((s) => s.key),
            ),
          );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return slots.map((slot) => {
    const row = byKey.get(slot.key);
    const preview = row ? render(row.body, sampleFields(sender)) : "";
    return {
      ...slot,
      body: row?.body ?? "",
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
      preview,
      segments: row ? segments(preview) : null,
    };
  });
}

export interface SetTemplate {
  key: string;
  /** "" clears it. */
  body: string;
  by: string;
}

/** Save (or clear) one slot; returns it as stored. A bad body or unknown key is a refusal. */
export async function setTemplate(
  db: Queryable,
  opts: { provider: SmsProvider; slots: readonly TemplateSlot[]; sender: string; now: Date },
  req: SetTemplate,
): Promise<SlotView> {
  const { provider, slots, now } = opts;
  const slot = slots.find((s) => s.key === req.key);
  if (!slot) throw new SmsRefusal(`no SMS template ${req.key}`);
  let text: string;
  try {
    text = checkBody(slot, req.body ?? "");
  } catch (err) {
    throw new SmsRefusal(err instanceof Error ? err.message : String(err));
  }
  const keyword = keywordOf(slot.key);
  if (keyword) {
    if (!provider.keywordReplies)
      throw new SmsRefusal(`provider ${provider.name} sends no keyword replies`);
    try {
      await provider.keywordReplies.set(keyword, KEYWORD_WORDS[keyword], text || null);
    } catch (err) {
      // Shown to whoever pressed Save; they try again rather than Restate retrying blind.
      throw new SmsRefusal(
        `${provider.name} did not take the ${keyword} reply: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (text === "") await db.delete(smsTemplates).where(eq(smsTemplates.key, slot.key));
  else {
    await db
      .insert(smsTemplates)
      .values({ key: slot.key, body: text, updatedAt: now, updatedBy: req.by })
      .onConflictDoUpdate({
        target: smsTemplates.key,
        set: { body: text, updatedAt: now, updatedBy: req.by },
      });
  }
  const [view] = await listTemplates(db, [slot], opts.sender);
  return view as SlotView;
}
