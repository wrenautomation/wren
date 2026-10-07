/**
 * William's words for the slots sequences.ts declares, kept in the template store
 * (`@wren/core/templates`, kind dm, system `reach`): every save a version, the live one
 * what goes out. Saving here checks the body against its slot and publishes it, so the
 * copy page's Save means what it always did; an empty body clears the slot, so "empty"
 * has one meaning.
 */
import { AuthoringError, type Template } from "@wren/core/slots";
import {
  clearTemplate,
  importVersion,
  liveTemplates,
  saveLive,
  type TemplateRef,
} from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import { ReachRefusal } from "./refusal.js";
import { reachTemplates } from "./schema.js";
import { checkBody, render, sampleFields, type TemplateSlot } from "./sequences.js";

/** Whose messages these are in the template store. */
export const REACH_SYSTEM = "reach";
export const dmRef = (key: string): TemplateRef => ({
  kind: "dm",
  system: REACH_SYSTEM,
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
}

/** The live messages among `keys`; an empty slot is absent. */
export async function liveDms(
  db: Queryable,
  keys: readonly string[],
): Promise<Map<string, Template>> {
  const live = await liveTemplates(db, "dm", REACH_SYSTEM, keys);
  return new Map([...live].map(([key, t]) => [key, t.template]));
}

export async function listTemplates(
  db: Queryable,
  slots: readonly TemplateSlot[],
  sender: string,
): Promise<SlotView[]> {
  const live = await liveTemplates(
    db,
    "dm",
    REACH_SYSTEM,
    slots.map((s) => s.key),
  );
  return slots.map((slot) => {
    const row = live.get(slot.key);
    return {
      ...slot,
      body: row?.source ?? "",
      version: row?.version ?? null,
      updatedAt: row?.publishedAt?.toISOString() ?? null,
      updatedBy: row?.publishedBy ?? null,
      preview: row ? render(row.template, sampleFields(sender), "sample").body : "",
    };
  });
}

export interface SetTemplate {
  key: string;
  /** "" or absent empties the slot. */
  body?: string | null;
  by: string;
}

/** Save and publish (or clear) one slot; returns it as stored. */
export async function setTemplate(
  db: Queryable,
  opts: { slots: readonly TemplateSlot[]; sender: string },
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
  if (!text) await clearTemplate(db, dmRef(slot.key));
  else {
    try {
      await saveLive(db, dmRef(slot.key), text, { by: req.by, rules: slot });
    } catch (err) {
      if (err instanceof AuthoringError) throw new ReachRefusal(err.message);
      throw err;
    }
  }
  const [view] = await listTemplates(db, [slot], opts.sender);
  return view as SlotView;
}

/**
 * The words `reach_templates` held before the template store, each kept as a version with
 * who saved it and when, and live where nothing is. Runs once per database; again is a no-op.
 */
export async function importLegacyDms(db: Queryable): Promise<{ rows: number; live: number }> {
  const rows = await db.select().from(reachTemplates);
  let live = 0;
  for (const r of rows) {
    const out = await importVersion(db, dmRef(r.key), r.body, { by: r.updatedBy, at: r.updatedAt });
    if (out.live) live++;
  }
  return { rows: rows.length, live };
}
