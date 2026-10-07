/**
 * Inbox notes (designs/2026-10-07-inbox-reply.md): the team's words on a thread or a person,
 * never sent. An `@someone@firm.com` naming a teammate lands in their Mentions, the same rows a
 * note's mention writes.
 */
import { clientMembers, operators } from "@wren/core/clients";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type InboxNote, inboxNotes, noteMentions } from "./schema.js";

/** `@someone@firm.com` in the words, as the notes' comments read it. */
const AT_EMAIL = /(?:^|[^\w.@])@([^\s@]+@[^\s@]+\.[\w-]+)/g;
/** How long a note may run. */
export const INBOX_NOTE_MAX = 4000;

/** The emails `@`ed in these words, lowercased, each once. */
export const atEmails = (body: string): string[] => [
  ...new Set([...body.matchAll(AT_EMAIL)].map((m) => (m[1] ?? "").toLowerCase()).filter(Boolean)),
];

/**
 * Who an Inbox note may `@` and a thread may go to, as emails, lowercased: on Wren's own threads
 * Wren's team; on a client's, the teammates who reach that client and its own people. Notes'
 * `@` finds the same people.
 */
export async function teamEmails(main: Queryable, client: string | null = null): Promise<string[]> {
  const team = await main
    .select({ email: operators.email, clients: operators.clients })
    .from(operators)
    .orderBy(asc(operators.email));
  const out = team
    .filter((t) => client === null || t.clients === null || t.clients.includes(client))
    .map((t) => t.email.toLowerCase());
  if (client !== null) {
    const people = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(eq(clientMembers.clientId, client))
      .orderBy(asc(clientMembers.email));
    out.push(...people.map((p) => p.email.toLowerCase()));
  }
  return [...new Set(out)];
}

/**
 * Keep a note on `thread` (and its person) and a mention for each teammate in `team` it `@`s,
 * the writer left out. Returns the note and who was mentioned.
 */
export async function addInboxNote(
  db: Db,
  o: {
    thread: string;
    personId: number | null;
    body: string;
    by: string;
    team: readonly string[];
    now?: Date;
  },
): Promise<{ note: InboxNote; mentioned: string[] }> {
  const body = o.body.trim();
  if (!body) throw new Error("the note is empty");
  if (body.length > INBOX_NOTE_MAX) throw new Error(`a note runs ${INBOX_NOTE_MAX} characters`);
  const by = o.by.toLowerCase();
  const team = new Set(o.team.map((t) => t.toLowerCase()));
  const mentioned = atEmails(body).filter((e) => team.has(e) && e !== by);
  const at = o.now ?? new Date();
  return atomic(db, async (tx) => {
    const [note] = await tx
      .insert(inboxNotes)
      .values({ thread: o.thread, personId: o.personId, body, by, at })
      .returning();
    if (!note) throw new Error("the note was not kept");
    if (mentioned.length)
      await tx
        .insert(noteMentions)
        .values(mentioned.map((who) => ({ inboxNoteId: note.id, who, by, at })));
    return { note, mentioned };
  });
}

/** Notes on these threads or about this person, oldest first. */
export function inboxNotesOf(
  db: Queryable,
  o: { threads: readonly string[]; personId: number | null },
): Promise<InboxNote[]> {
  const on = [
    ...(o.threads.length ? [inArray(inboxNotes.thread, [...o.threads])] : []),
    ...(o.personId === null ? [] : [eq(inboxNotes.personId, o.personId)]),
  ];
  if (!on.length) return Promise.resolve([]);
  return db
    .select()
    .from(inboxNotes)
    .where(or(...on))
    .orderBy(asc(inboxNotes.at))
    .limit(200);
}

/** Where this person was `@`ed in an Inbox note, newest first, with the note's words. */
export function inboxMentionsOf(db: Queryable, email: string, limit = 50) {
  return db
    .select({
      id: noteMentions.id,
      inboxNoteId: noteMentions.inboxNoteId,
      thread: inboxNotes.thread,
      by: noteMentions.by,
      at: noteMentions.at,
      seenAt: noteMentions.seenAt,
      text: sql<string>`left(${inboxNotes.body}, 240)`,
    })
    .from(noteMentions)
    .innerJoin(inboxNotes, eq(inboxNotes.id, noteMentions.inboxNoteId))
    .where(eq(noteMentions.who, email.toLowerCase()))
    .orderBy(desc(noteMentions.at))
    .limit(Math.min(Math.max(limit, 1), 200));
}

/** How many Inbox-note mentions this person hasn't opened. */
export async function unseenInboxMentions(db: Queryable, email: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(noteMentions)
    .where(
      and(
        eq(noteMentions.who, email.toLowerCase()),
        isNull(noteMentions.seenAt),
        sql`${noteMentions.inboxNoteId} is not null`,
      ),
    );
  return Number(row?.n ?? 0);
}
