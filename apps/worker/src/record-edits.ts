/**
 * The copy records' `edits` (`@wren/core/edits`): William's words for a text or a DM slot, edited
 * in place on the record with History, Undo and Ask Claude. Each save checks the body against its
 * slot and publishes it in the template store, as the old Edit did; an empty body clears the slot.
 *
 * A keyword reply (HELP, START, STOP) also sets the provider's own answer, which a database write
 * can't do: those keep the Edit action, which goes through `SmsDesk/setTemplate`.
 */
import {
  listTemplates as listTexts,
  type SmsSequence,
  textRef,
  slotsOf as textSlotsOf,
} from "@wren/channel-sms";
import { textCopyRecord } from "@wren/channel-sms/records";
import { checkBody as checkText, keywordOf, type TemplateSlot } from "@wren/channel-sms/templates";
import { wordsPatch } from "@wren/core/edits";
import { PortalRefusal } from "@wren/core/portal";
import type { RecordType } from "@wren/core/records";
import { withEdits } from "@wren/core/records";
import { AuthoringError, type SlotRules } from "@wren/core/slots";
import { clearTemplate, saveLive, type TemplateRef } from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import { SMS_SEQUENCES } from "@wren/niches";
import {
  checkBody as checkDm,
  dmRef,
  slotsOf as dmSlotsOf,
  listTemplates as listDms,
  MESSAGE_MAX,
  REACH_SEQUENCES,
} from "@wren/outreach";
import { dmCopyRecord } from "@wren/outreach/records";

/** Only the words: the rest of a copy row is its slot's, fixed in code. */
const PATCH = wordsPatch({ body: MESSAGE_MAX });

/** Publish the body, or clear the slot when it's empty; the store's refusal reads as one. */
async function publish(
  db: Queryable,
  ref: TemplateRef,
  body: string,
  by: string,
  rules: SlotRules,
) {
  if (!body) return clearTemplate(db, ref);
  try {
    await saveLive(db, ref, body, { by, rules });
  } catch (err) {
    if (err instanceof AuthoringError) throw new PortalRefusal(err.message, 400);
    throw err;
  }
}

/** A slot's checked body, or why not. */
const checked = (check: () => string): string | null => {
  try {
    check();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

export function textCopyEdits(
  type: RecordType,
  sequences: Iterable<SmsSequence>,
  sender: string,
): RecordType {
  const slots = textSlotsOf(sequences);
  const slotOf = (id: string): TemplateSlot | undefined => slots.find((s) => s.key === id);
  return withEdits(type, {
    fields: ["body"],
    patch: PATCH,
    about: "the words of one text; {fields} fill in per person",
    read: async (db, id) => {
      const slot = slotOf(id);
      if (!slot) return null;
      const [view] = await listTexts(db, [slot], sender);
      return { body: view?.body ?? "" };
    },
    check: (patch, _now, _db, id) => {
      const slot = slotOf(id);
      if (!slot) return null;
      if (keywordOf(id)) return "a keyword reply saves with Edit: it sets the provider's too";
      return checked(() => checkText(slot, String(patch.body ?? "")));
    },
    write: async (db, id, patch, by) => {
      const slot = slotOf(id);
      if (!slot) throw new PortalRefusal("no such text", 404);
      if (patch.body === undefined) return;
      const body = checkText(slot, String(patch.body));
      await publish(db, textRef(id), body, by, slot);
    },
    context: async (_db, id) => {
      const slot = slotOf(id);
      if (!slot) return null;
      return [
        `A text Wren sends: ${slot.purpose}${slot.goes ? ` (${slot.goes})` : ""}.`,
        `It may use ${slot.fields.map((f) => `{${f}}`).join(" ")}.`,
        slot.mustSayStop ? "It must say STOP." : "",
        slot.minLength > 1 ? `At least ${slot.minLength} characters.` : "",
        "One SMS part is 160 plain characters; each part past one costs again.",
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}

export function dmCopyEdits(type: RecordType, sender: string): RecordType {
  const slots = dmSlotsOf(REACH_SEQUENCES.values());
  const slotOf = (id: string) => slots.find((s) => s.key === id);
  return withEdits(type, {
    fields: ["body"],
    patch: PATCH,
    about: "the words of one DM slot; {fields} fill in per person",
    read: async (db, id) => {
      const slot = slotOf(id);
      if (!slot) return null;
      const [view] = await listDms(db, [slot], sender);
      return { body: view?.body ?? "" };
    },
    check: (patch, _now, _db, id) => {
      const slot = slotOf(id);
      return slot ? checked(() => checkDm(slot, String(patch.body ?? ""))) : null;
    },
    write: async (db, id, patch, by) => {
      const slot = slotOf(id);
      if (!slot) throw new PortalRefusal("no such slot", 404);
      if (patch.body === undefined) return;
      await publish(db, dmRef(id), checkDm(slot, String(patch.body)), by, slot);
    },
    context: async (_db, id) => {
      const slot = slotOf(id);
      if (!slot) return null;
      return [
        `A ${slot.platform} message Wren sends: ${slot.purpose}.`,
        `At most ${slot.maxLength} characters.`,
        `It may use ${slot.fields.map((f) => `{${f}}`).join(" ")}; {field|fallback} when it may be empty.`,
      ].join("\n");
    },
  });
}

/** Both copy records with their edits, as the console serves them. */
export function copyRecords(sender: string): RecordType[] {
  return [
    dmCopyEdits(dmCopyRecord(sender), sender),
    textCopyEdits(textCopyRecord(SMS_SEQUENCES.values(), sender), SMS_SEQUENCES.values(), sender),
  ];
}
