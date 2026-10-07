/**
 * Text-to-pay (designs/2026-10-07-forms-and-pay.md). Main database, with a `client` column, so
 * To approve and Stripe's webhook read one place. A thread's mark lives with its contact in the
 * owner's database (`sms_contacts.paid_*`).
 *
 * - `pay_links`: one Stripe Payment Link each, from ask to paid.
 * - `pay_accounts`: per client, the webhook endpoint and the name its signing secret is kept
 *   under. Never a secret.
 * - `pay_events`: each Stripe event once, trimmed: ids, amounts, status, email. No card data
 *   ever reaches us; Stripe Checkout holds it.
 */
import { clients } from "@wren/core/clients";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const PAY_CHANNELS = ["sms", "email"] as const;
export type PayChannel = (typeof PAY_CHANNELS)[number];

/**
 * waiting: on a yes. sending: yes given, the link and the message on their way. sent: the text
 * is queued for the window, or the email went. paid: Stripe says so. declined: a person said no.
 * failed: Stripe or the send refused (`why`).
 */
export const PAY_STATUSES = ["waiting", "sending", "sent", "paid", "declined", "failed"] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

export const payLinks = pgTable(
  "pay_links",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose Stripe account it is on. */
    client: varchar("client", { length: 40 }).notNull(),
    /** The texting thread (`sms_contacts.id` in the client's database); null for an email. */
    contact: integer("contact"),
    email: text("email"),
    /** Who it's for, as the thread or the person making it said. */
    name: text("name"),
    channel: varchar("channel", { length: 8 }).notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    quantity: integer("quantity").notNull().default(1),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    status: varchar("status", { length: 8 }).notNull().default("waiting"),
    why: text("why"),
    /** Stripe's Payment Link id (`plink_…`) and its URL. */
    stripeLink: varchar("stripe_link", { length: 80 }),
    url: text("url"),
    /** The queued text's `sms_messages.id`, in the client's database. */
    message: bigint("message", { mode: "number" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidCents: integer("paid_cents"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** The Checkout Session that paid it (`cs_…`). */
    session: varchar("session", { length: 80 }),
    /** Stripe's livemode on the paying event: false is a test payment. */
    live: boolean("live"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_pay_links" }),
    index("ix_pay_links_client_created").on(t.client, t.createdAt),
    uniqueIndex("uq_pay_links_stripe_link").on(t.stripeLink),
    index("ix_pay_links_status").on(t.status),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_pay_links_client",
    }).onDelete("cascade"),
    oneOf("ck_pay_links_channel", t.channel, PAY_CHANNELS),
    oneOf("ck_pay_links_status", t.status, PAY_STATUSES),
    check("ck_pay_links_amount", sql`${t.amountCents} >= 50 and ${t.amountCents} <= 99999999`),
    check("ck_pay_links_quantity", sql`${t.quantity} between 1 and 100`),
    check(
      "ck_pay_links_to",
      sql`(${t.channel} = 'sms' and ${t.contact} is not null) or (${t.channel} = 'email' and ${t.email} is not null)`,
    ),
  ],
);
export type PayLink = typeof payLinks.$inferSelect;

export const payAccounts = pgTable(
  "pay_accounts",
  {
    client: varchar("client", { length: 40 }).notNull(),
    /** Stripe's webhook endpoint id (`we_…`); null until it's registered. */
    endpoint: varchar("endpoint", { length: 80 }),
    /** The signing secret's key store ref (`ks_…`); null until it's saved. */
    secretName: text("secret_name"),
    /** How the endpoint came: Wren registered it with the key, or the client pasted its secret. */
    how: varchar("how", { length: 8 }),
    /** Stripe's livemode on the key: false is a test key. */
    live: boolean("live"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.client], name: "pk_pay_accounts" }),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_pay_accounts_client",
    }).onDelete("cascade"),
    oneOf("ck_pay_accounts_how", t.how, ["api", "pasted"]),
  ],
);
export type PayAccount = typeof payAccounts.$inferSelect;

/** What applying a Stripe event did. */
export const PAY_EVENT_RESULTS = ["paid", "unpaid", "unknown", "ignored"] as const;

export const payEvents = pgTable(
  "pay_events",
  {
    /** Stripe's event id (`evt_…`): each one is kept once. */
    id: varchar("id", { length: 80 }).notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    /** The link it paid, when it matched one. */
    link: uuid("link"),
    result: varchar("result", { length: 8 }).notNull(),
    /** Trimmed: session, payment link, status, amount, currency, email, livemode. */
    seen: jsonb("seen").$type<Record<string, string | number | boolean | null>>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_pay_events" }),
    index("ix_pay_events_client_at").on(t.client, t.at),
    index("ix_pay_events_link").on(t.link),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_pay_events_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.link],
      foreignColumns: [payLinks.id],
      name: "fk_pay_events_link",
    }).onDelete("set null"),
    oneOf("ck_pay_events_result", t.result, PAY_EVENT_RESULTS),
  ],
);
