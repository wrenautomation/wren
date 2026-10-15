/**
 * Marketing email bounces (designs/2026-10-14-customerio-audit.md, bounce reading): the delivery
 * reports that came back to a workspace's sending mailbox for a broadcast or a workflow's Send
 * message. Each workspace keeps its own, in its own database. Only `./bounces.ts` writes these.
 */
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { broadcastRecipients } from "./broadcasts-schema.js";
import { consentEvents, suppressions } from "./schema.js";

/** `hard`: the address doesn't take mail (5.x.x), it goes on do-not-contact. `soft`: kept only. */
export const BOUNCE_CLASSES = ["hard", "soft"] as const;
export type BounceClass = (typeof BOUNCE_CLASSES)[number];

/** How a report found its send: the Message-ID it carries, else its Final-Recipient address. */
export const BOUNCE_MATCHES = ["message_id", "address"] as const;
export type BounceMatch = (typeof BOUNCE_MATCHES)[number];

/**
 * One delivery report that matched one of our marketing sends. Exactly one of `recipient_id`
 * (a broadcast) or `consent_event_id` (a workflow's Send message, a newsletter issue) is set.
 */
export const mailBounces = pgTable(
  "mail_bounces",
  {
    id: serial("id").notNull(),
    /** The sending mailbox the report came back to. */
    mailbox: varchar("mailbox", { length: 320 }).notNull(),
    /** The report's id in that mailbox (Gmail's or Graph's): one row per report. */
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    /** Our Message-ID the report names, when it names one. */
    messageId: varchar("message_id", { length: 998 }),
    /** The address the report says failed (its Final-Recipient). */
    address: varchar("address", { length: 320 }),
    class: varchar("class", { length: 8 }).$type<BounceClass>().notNull(),
    matchedBy: varchar("matched_by", { length: 16 }).$type<BounceMatch>().notNull(),
    /** Enhanced status code, e.g. 5.1.1. */
    status: varchar("status", { length: 16 }),
    diagnostic: text("diagnostic"),
    recipientId: integer("recipient_id"),
    consentEventId: integer("consent_event_id"),
    /** The do-not-contact row a hard bounce put the address on. */
    suppressionId: integer("suppression_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_mail_bounces" }),
    unique("uq_mail_bounces_mailbox_provider").on(t.mailbox, t.providerId),
    index("ix_mail_bounces_recipient_id").on(t.recipientId),
    index("ix_mail_bounces_consent_event_id").on(t.consentEventId),
    index("ix_mail_bounces_suppression_id").on(t.suppressionId),
    foreignKey({
      columns: [t.recipientId],
      foreignColumns: [broadcastRecipients.id],
      name: "fk_mail_bounces_recipient_id_broadcast_recipients",
    }),
    foreignKey({
      columns: [t.consentEventId],
      foreignColumns: [consentEvents.id],
      name: "fk_mail_bounces_consent_event_id_consent_events",
    }),
    foreignKey({
      columns: [t.suppressionId],
      foreignColumns: [suppressions.id],
      name: "fk_mail_bounces_suppression_id_suppressions",
    }),
    oneOf("ck_mail_bounces_class", t.class, BOUNCE_CLASSES),
    oneOf("ck_mail_bounces_matched_by", t.matchedBy, BOUNCE_MATCHES),
  ],
);

/**
 * A workspace's sending mailboxes and their last check, one row each: the next check reads from
 * here. The sent log counts an email delivered only once a check ran 48 hours after it went, so a
 * mailbox nobody reads never claims it. A mailbox stays here after the workspace picks another
 * sender, and is read for `BOUNCE_LATE_MS` after it last sent (`lastSenderAt`): late bounces
 * still come back to it.
 */
export const mailBounceReads = pgTable(
  "mail_bounce_reads",
  {
    mailbox: varchar("mailbox", { length: 320 }).notNull(),
    /** Null until the mailbox's first check. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** The last pass's counts. */
    stats: jsonb("stats"),
    /** The last moment this mailbox was the workspace's sender (or last known to be). */
    lastSenderAt: timestamp("last_sender_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.mailbox], name: "pk_mail_bounce_reads" })],
);
