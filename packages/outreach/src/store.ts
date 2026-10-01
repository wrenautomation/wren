/**
 * William's words for the slots sequences.ts declares. Saving checks the body
 * against its slot; an empty body deletes the row, so "empty" has one meaning.
 */
import type { Queryable } from "@wren/db";
import { eq, inArray } from "drizzle-orm";
import { ReachRefusal } from "./refusal.js";
import { reachTemplates } from "./schema.js";
import { checkBody, render, sampleFields, type TemplateSlot } from "./sequences.js";

export interface SlotView extends TemplateSlot {
  /** "" when empty. */
  body: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The body with sample fields filled in; "" when empty. */
  preview: string;
}

/** The filled bodies among `keys`; an empty slot is absent. */
export async function templateBodies(
  db: Queryable,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ key: reachTemplates.key, body: reachTemplates.body })
    .from(reachTemplates)
    .where(inArray(reachTemplates.key, [...keys]));
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
          .from(reachTemplates)
          .where(
            inArray(
              reachTemplates.key,
              slots.map((s) => s.key),
            ),
          );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return slots.map((slot) => {
    const row = byKey.get(slot.key);
    return {
      ...slot,
      body: row?.body ?? "",
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
      preview: row ? render(row.body, sampleFields(sender)) : "",
    };
  });
}

export interface SetTemplate {
  key: string;
  /** "" or absent empties the slot. */
  body?: string | null;
  by: string;
}

export async function setTemplate(
  db: Queryable,
  opts: { slots: readonly TemplateSlot[]; sender: string; now: Date },
  req: SetTemplate,
): Promise<SlotView> {
  const slot = opts.slots.find((s) => s.key === req.key);
  if (!slot) throw new ReachRefusal(`no outreach template ${req.key}`);
  let text: string;
  try {
    text = checkBody(slot, req.body ?? "");
  } catch (err) {
    throw new ReachRefusal(err instanceof Error ? err.message : String(err));
  }
  if (!text) {
    await db.delete(reachTemplates).where(eq(reachTemplates.key, slot.key));
  } else {
    await db
      .insert(reachTemplates)
      .values({ key: slot.key, body: text, updatedAt: opts.now, updatedBy: req.by })
      .onConflictDoUpdate({
        target: reachTemplates.key,
        set: { body: text, updatedAt: opts.now, updatedBy: req.by },
      });
  }
  const [view] = await listTemplates(db, [slot], opts.sender);
  return view as SlotView;
}
