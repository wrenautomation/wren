/**
 * Texts and call reminders for a client (designs/2026-10-04-outbound-per-client.md, O4): its
 * numbers (the Telnyx messaging profile in `clients.accounts.telnyx`, inside Wren's Telnyx
 * account), its database, and its cal.com (the autobrowse login in `clients.accounts.calcom`).
 * `{}` texts under Wren's sender name with no 10DLC campaign to watch.
 */
import { type Client, findClient } from "@wren/core/clients";
import type { Db } from "@wren/db";
import { z } from "zod";

export const TEXTS = "sms.texts";
export const REMINDERS = "sms.reminders";

export const textsSettingsSchema = z
  .object({
    /** The name a text signs with; null = Wren's (`WREN_SMS_SENDER_NAME`). */
    senderName: z.string().trim().min(1).nullable().default(null),
    /** The client's 10DLC campaign its US numbers attach to; null = none to watch. */
    campaignId: z.string().trim().min(1).nullable().default(null),
    /** Where its leads book, quoted as `{booking_link}` (speed to lead); null = none set. */
    bookingLink: z.url().nullable().default(null),
  })
  .strict();

/** Reminders take no settings: the template is the client's `reminder.day-before`. */
export const remindersSettingsSchema = z.object({}).strict();

/** A client's texts this pass (JSON, so a step can journal it), or why there is nothing to do. */
export type ClientSms =
  | { kind: "gone"; why: string }
  | {
      kind: "work";
      client: Pick<Client, "id" | "database">;
      /** The Telnyx messaging profile its numbers sit on. */
      profile: string;
      senderName: string | null;
      campaignId: string | null;
      bookingLink: string | null;
      /** The autobrowse cal.com login reminders read; null = no reminders. */
      calcom: string | null;
    };

export async function clientSms(main: Db, id: string): Promise<ClientSms> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo never texts" };
  const products = client.products as Record<string, unknown>;
  if (products[TEXTS] === undefined) return { kind: "gone", why: "texts are not installed" };
  const texts = textsSettingsSchema.safeParse(products[TEXTS]);
  if (!texts.success) return { kind: "gone", why: "the texts settings do not parse" };
  const profile = client.accounts.telnyx;
  if (!profile) return { kind: "gone", why: "no Telnyx messaging profile in accounts" };
  return {
    kind: "work",
    client: { id: client.id, database: client.database },
    profile,
    senderName: texts.data.senderName,
    campaignId: texts.data.campaignId,
    bookingLink: texts.data.bookingLink,
    calcom:
      products[REMINDERS] !== undefined && client.accounts.calcom ? client.accounts.calcom : null,
  };
}
