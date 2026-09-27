/**
 * The inbox's reads: threads by last activity, one thread in full, and
 * "read up to now". A thread is a contact with at least one text either way.
 * Unread = inbound after the contact's `read_at`.
 */
import { companies } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { formatUs } from "./phone.js";
import {
  type SmsContact,
  type SmsMessage,
  smsContacts,
  smsMessages,
  smsNumbers,
} from "./schema.js";

export interface ThreadSummary {
  contactId: number;
  e164: string;
  display: string;
  company: string | null;
  state: SmsContact["state"];
  lastAt: string;
  lastBody: string;
  lastDirection: "in" | "out";
  unread: number;
  disposition: string | null;
}

export type ThreadFilter = "all" | "unread" | "replied";

export async function listThreads(
  db: Queryable,
  opts: { filter?: ThreadFilter; limit?: number; offset?: number } = {},
): Promise<ThreadSummary[]> {
  const last = db
    .select({
      contactId: smsMessages.contactId,
      lastAt:
        sql<Date>`max(coalesce(${smsMessages.receivedAt}, ${smsMessages.sentAt}, ${smsMessages.createdAt}))`.as(
          "last_at",
        ),
      inbound: sql<number>`count(*) FILTER (WHERE ${smsMessages.direction} = 'in')::int`.as(
        "inbound",
      ),
    })
    .from(smsMessages)
    .where(sql`${smsMessages.state} NOT IN ('queued', 'skipped') OR ${smsMessages.kind} = 'manual'`)
    .groupBy(smsMessages.contactId)
    .as("last");
  const unread = sql<number>`(SELECT count(*)::int FROM ${smsMessages} m WHERE m.contact_id = ${smsContacts.id} AND m.direction = 'in' AND (${smsContacts.readAt} IS NULL OR m.received_at > ${smsContacts.readAt}))`;
  const latest = sql<string>`(SELECT m.body FROM ${smsMessages} m WHERE m.contact_id = ${smsContacts.id} AND m.state <> 'skipped' ORDER BY coalesce(m.received_at, m.sent_at, m.created_at) DESC, m.id DESC LIMIT 1)`;
  const latestDir = sql<
    "in" | "out"
  >`(SELECT m.direction FROM ${smsMessages} m WHERE m.contact_id = ${smsContacts.id} AND m.state <> 'skipped' ORDER BY coalesce(m.received_at, m.sent_at, m.created_at) DESC, m.id DESC LIMIT 1)`;
  const latestDisposition = sql<
    string | null
  >`(SELECT m.disposition FROM ${smsMessages} m WHERE m.contact_id = ${smsContacts.id} AND m.direction = 'in' ORDER BY m.received_at DESC, m.id DESC LIMIT 1)`;
  const where = [];
  if (opts.filter === "unread") where.push(sql`${unread} > 0`);
  if (opts.filter === "replied") where.push(sql`${last.inbound} > 0`);
  const rows = await db
    .select({
      contact: smsContacts,
      company: companies.name,
      lastAt: last.lastAt,
      unread,
      lastBody: latest,
      lastDirection: latestDir,
      disposition: latestDisposition,
    })
    .from(smsContacts)
    .innerJoin(last, eq(last.contactId, smsContacts.id))
    .leftJoin(companies, eq(companies.id, smsContacts.companyId))
    .where(and(...where))
    .orderBy(desc(last.lastAt), desc(smsContacts.id))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return rows.map((r) => ({
    contactId: r.contact.id,
    e164: r.contact.e164,
    display: formatUs(r.contact.e164),
    company: r.company,
    state: r.contact.state,
    lastAt: new Date(r.lastAt).toISOString(),
    lastBody: r.lastBody ?? "",
    lastDirection: r.lastDirection ?? "out",
    unread: r.unread,
    disposition: r.disposition,
  }));
}

export interface Thread {
  contact: SmsContact & {
    display: string;
    company: string | null;
    companyDomain: string | null;
    fromNumber: string | null;
  };
  messages: (Pick<
    SmsMessage,
    | "id"
    | "direction"
    | "kind"
    | "step"
    | "body"
    | "state"
    | "errorCode"
    | "detail"
    | "disposition"
    | "dispositionSource"
  > & { at: string })[];
}

export async function getThread(db: Queryable, contactId: number): Promise<Thread | null> {
  const [row] = await db
    .select({
      contact: smsContacts,
      company: companies.name,
      domain: companies.domain,
      from: smsNumbers.e164,
    })
    .from(smsContacts)
    .leftJoin(companies, eq(companies.id, smsContacts.companyId))
    .leftJoin(smsNumbers, eq(smsNumbers.id, smsContacts.numberId))
    .where(eq(smsContacts.id, contactId));
  if (!row) return null;
  const msgs = await db
    .select()
    .from(smsMessages)
    .where(and(eq(smsMessages.contactId, contactId), sql`${smsMessages.state} <> 'skipped'`))
    .orderBy(
      asc(
        sql`coalesce(${smsMessages.receivedAt}, ${smsMessages.sentAt}, ${smsMessages.dueAt}, ${smsMessages.createdAt})`,
      ),
      asc(smsMessages.id),
    );
  return {
    contact: {
      ...row.contact,
      display: formatUs(row.contact.e164),
      company: row.company,
      companyDomain: row.domain,
      fromNumber: row.from,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      step: m.step,
      body: m.body,
      state: m.state,
      errorCode: m.errorCode,
      detail: m.detail,
      disposition: m.disposition,
      dispositionSource: m.dispositionSource,
      at: (m.receivedAt ?? m.sentAt ?? m.dueAt ?? m.createdAt).toISOString(),
    })),
  };
}

export async function markRead(db: Queryable, contactId: number, now: Date): Promise<void> {
  await db.update(smsContacts).set({ readAt: now }).where(eq(smsContacts.id, contactId));
}
