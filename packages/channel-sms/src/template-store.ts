/**
 * William's words for the slots templates.ts declares, kept in the template store
 * (`@wren/core/templates`, kind sms, system `texts`): every save a version, the live one
 * what goes out. Saving here checks the body against its slot and publishes it, so the
 * phone app's Save means what it always did; an empty body clears the slot, so "empty"
 * has one meaning. A keyword reply is pushed to the provider before it is stored: if the
 * provider refuses, nothing is saved.
 */
import { companies, people } from "@wren/core";
import { AuthoringError, type Template } from "@wren/core/slots";
import {
  clearTemplate,
  importVersion,
  liveTemplates,
  saveLive,
  type TemplateRef,
} from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
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

/** Whose texts these are in the template store. */
export const TEXTS_SYSTEM = "texts";
export const textRef = (key: string): TemplateRef => ({
  kind: "sms",
  system: TEXTS_SYSTEM,
  name: key,
});

export interface SlotView extends TemplateSlot {
  /** "" when empty. */
  body: string;
  /** The live version's hash; null when empty. */
  version: string | null;
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
  bookingLink: string | null = null,
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
    booking_link: bookingLink,
  };
}

/** The live texts among `keys`; an empty slot is absent. */
export async function liveTexts(
  db: Queryable,
  keys: readonly string[],
): Promise<Map<string, Template>> {
  const live = await liveTemplates(db, "sms", TEXTS_SYSTEM, keys);
  return new Map([...live].map(([key, t]) => [key, t.template]));
}

export async function listTemplates(
  db: Queryable,
  slots: readonly TemplateSlot[],
  sender: string,
): Promise<SlotView[]> {
  const live = await liveTemplates(
    db,
    "sms",
    TEXTS_SYSTEM,
    slots.map((s) => s.key),
  );
  return slots.map((slot) => {
    const row = live.get(slot.key);
    const preview = row ? render(row.template, sampleFields(sender), "sample").body : "";
    return {
      ...slot,
      body: row?.source ?? "",
      version: row?.version ?? null,
      updatedAt: row?.publishedAt?.toISOString() ?? null,
      updatedBy: row?.publishedBy ?? null,
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

/** Save and publish (or clear) one slot; returns it as stored. A bad body or unknown key is a refusal. */
export async function setTemplate(
  db: Queryable,
  opts: { provider: SmsProvider; slots: readonly TemplateSlot[]; sender: string },
  req: SetTemplate,
): Promise<SlotView> {
  const { provider, slots } = opts;
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
  if (text === "") await clearTemplate(db, textRef(slot.key));
  else {
    try {
      await saveLive(db, textRef(slot.key), text, { by: req.by, rules: slot });
    } catch (err) {
      if (err instanceof AuthoringError) throw new SmsRefusal(err.message);
      throw err;
    }
  }
  const [view] = await listTemplates(db, [slot], opts.sender);
  return view as SlotView;
}

/**
 * The words `sms_templates` held before the template store, each kept as a version with
 * who saved it and when, and live where nothing is. Runs once per database; again is a no-op.
 */
export async function importLegacyTexts(db: Queryable): Promise<{ rows: number; live: number }> {
  const rows = await db.select().from(smsTemplates);
  let live = 0;
  for (const r of rows) {
    const out = await importVersion(db, textRef(r.key), r.body, {
      by: r.updatedBy,
      at: r.updatedAt,
    });
    if (out.live) live++;
  }
  return { rows: rows.length, live };
}
