/**
 * A Meta lead form's consent box as marketing consent (designs/2026-10-04-borrowed-ui.md, M4).
 * Only a lead whose box is ticked counts. The form id, the box's key and Meta's consent text are
 * the proof. One step: it never lifts an opt-out. A lead already recorded is skipped, so pulling
 * the form again never re-subscribes someone who left.
 */
import { addressOf, giveConsent } from "@wren/core/marketing";
import { consentEvents, topics } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Lead } from "./ads.js";

export interface LeadConsent {
  formId: string;
  /** The topic the box signs up for; its channel picks the email or the phone field. */
  topic: string;
  /** The box's key on the form (`custom_disclaimer.checkboxes[].key`). */
  checkbox: string;
  /** The words beside the box, as the form showed them. */
  text: string;
}

const ticked = (v: unknown) => v === true || v === "1" || v === "true";
const usable = (channel: "email" | "sms", raw: string) => {
  try {
    return addressOf(channel, raw);
  } catch {
    return null;
  }
};

export async function consentFromLeads(db: Db, leads: Lead[], c: LeadConsent) {
  const [topic] = await db.select().from(topics).where(eq(topics.name, c.topic));
  if (!topic) throw new Error(`no topic ${c.topic}`);
  const field = topic.channel === "sms" ? "phone_number" : "email";
  const seen = new Set(
    leads.length
      ? (
          await db
            .select({ lead: sql<string>`${consentEvents.evidence}->>'lead'` })
            .from(consentEvents)
            .where(
              and(
                eq(sql`${consentEvents.evidence}->>'form'`, c.formId),
                inArray(
                  sql`${consentEvents.evidence}->>'lead'`,
                  leads.map((l) => l.id),
                ),
              ),
            )
        ).map((r) => r.lead)
      : [],
  );
  let given = 0;
  let skipped = 0;
  for (const l of leads) {
    const box = l.custom_disclaimer_responses?.some(
      (r) => r.checkbox_key === c.checkbox && ticked(r.is_checked),
    );
    const raw = l.field_data?.find((f) => f.name === field)?.values[0] ?? "";
    const address = usable(topic.channel, raw);
    if (seen.has(l.id) || !box || !address) {
      skipped++;
      continue;
    }
    await giveConsent(db, {
      channel: topic.channel,
      address,
      topic: topic.name,
      source: "meta_lead_form",
      textVersion: `meta:${c.formId}`.slice(0, 64),
      evidence: {
        form: c.formId,
        lead: l.id,
        checkbox: c.checkbox,
        text: c.text,
        ...(l.created_time ? { at: l.created_time } : {}),
        ...(l.ad_id ? { ad: l.ad_id } : {}),
      },
      by: "meta:lead-form",
      ...(l.created_time ? { now: new Date(l.created_time) } : {}),
    });
    given++;
  }
  return { given, skipped };
}
