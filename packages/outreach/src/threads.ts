/** The operator's reads: threads, one thread, counts. */
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { contactById } from "./contacts.js";
import {
  type ContactState,
  type Platform,
  type ReachContact,
  type ReachMessage,
  reachAccounts,
  reachContacts,
  reachMessages,
} from "./schema.js";

export interface ThreadFilter {
  platform?: Platform | null;
  state?: ContactState | null;
  unread?: boolean;
  limit?: number;
}

export interface ThreadSummary {
  contact: ReachContact;
  account: string | null;
  last: Pick<ReachMessage, "direction" | "kind" | "body" | "state" | "sentAt" | "createdAt"> | null;
  unread: boolean;
}

export async function listThreads(db: Queryable, f: ThreadFilter = {}): Promise<ThreadSummary[]> {
  const contacts = await db
    .select({ contact: reachContacts, account: reachAccounts.account })
    .from(reachContacts)
    .leftJoin(reachAccounts, eq(reachAccounts.id, reachContacts.accountId))
    .where(
      and(
        f.platform ? eq(reachContacts.platform, f.platform) : undefined,
        f.state ? eq(reachContacts.state, f.state) : undefined,
        f.unread ? inArray(reachContacts.state, ["replied"]) : undefined,
      ),
    )
    .orderBy(desc(reachContacts.createdAt))
    .limit(Math.min(Math.max(f.limit ?? 50, 1), 500));
  if (contacts.length === 0) return [];
  const msgs = await db
    .select()
    .from(reachMessages)
    .where(
      inArray(
        reachMessages.contactId,
        contacts.map((c) => c.contact.id),
      ),
    )
    .orderBy(desc(reachMessages.createdAt));
  const lastOf = new Map<number, ReachMessage>();
  const lastInAt = new Map<number, Date>();
  for (const m of msgs) {
    if (!lastOf.has(m.contactId)) lastOf.set(m.contactId, m);
    if (m.direction === "in" && !lastInAt.has(m.contactId))
      lastInAt.set(m.contactId, m.sentAt ?? m.createdAt);
  }
  return contacts
    .map(({ contact, account }) => {
      const last = lastOf.get(contact.id) ?? null;
      const inAt = lastInAt.get(contact.id);
      const unread = Boolean(inAt && (!contact.readAt || contact.readAt < inAt));
      return { contact, account, last, unread };
    })
    .filter((t) => !f.unread || t.unread);
}

export interface Thread {
  contact: ReachContact;
  messages: ReachMessage[];
}

export async function getThread(db: Queryable, contactId: number): Promise<Thread> {
  const contact = await contactById(db, contactId);
  const messages = await db
    .select()
    .from(reachMessages)
    .where(eq(reachMessages.contactId, contactId))
    .orderBy(reachMessages.createdAt);
  return { contact, messages };
}

export async function markRead(db: Queryable, contactId: number, now: Date): Promise<void> {
  await db.update(reachContacts).set({ readAt: now }).where(eq(reachContacts.id, contactId));
}

export interface ReachStats {
  contacts: Record<string, number>;
  /** Out rows by state over the window. */
  out: Record<string, number>;
  replies: number;
  days: number;
}

export async function reachStats(
  db: Queryable,
  o: { platform?: Platform | null; days: number; now: Date },
): Promise<ReachStats> {
  const since = new Date(o.now.getTime() - o.days * 86_400_000);
  const byState = await db
    .select({ state: reachContacts.state, n: sql<number>`count(*)::int` })
    .from(reachContacts)
    .where(o.platform ? eq(reachContacts.platform, o.platform) : undefined)
    .groupBy(reachContacts.state);
  const out = await db
    .select({ state: reachMessages.state, n: sql<number>`count(*)::int` })
    .from(reachMessages)
    .innerJoin(reachContacts, eq(reachContacts.id, reachMessages.contactId))
    .where(
      and(
        eq(reachMessages.direction, "out"),
        gte(reachMessages.createdAt, since),
        o.platform ? eq(reachContacts.platform, o.platform) : undefined,
      ),
    )
    .groupBy(reachMessages.state);
  const [replies] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reachMessages)
    .innerJoin(reachContacts, eq(reachContacts.id, reachMessages.contactId))
    .where(
      and(
        eq(reachMessages.direction, "in"),
        gte(reachMessages.createdAt, since),
        o.platform ? eq(reachContacts.platform, o.platform) : undefined,
      ),
    );
  return {
    contacts: Object.fromEntries(byState.map((r) => [r.state, r.n])),
    out: Object.fromEntries(out.map((r) => [r.state, r.n])),
    replies: replies?.n ?? 0,
    days: o.days,
  };
}
