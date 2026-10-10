/**
 * Site chat's store (designs/2026-10-09-site-chat.md): a visitor's thread by the key their browser
 * holds, their messages and ours, and the Inbox's rows. All in the owner's database.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "@wren/db";
import { CHAT_MAX } from "@wren/sites/chat-widget";
import { and, asc, count, eq, gt, gte, sql } from "drizzle-orm";
import { type ChatMessage, type ChatThread, chatMessages, chatThreads } from "../schema.js";

/** Messages a thread may send in an hour. */
export const CHAT_PER_HOUR = 30;
/** New threads an owner takes in a day. */
export const CHAT_THREADS_PER_DAY = 200;
/** New threads one visitor (by IP) starts in a day, so one script can't use up the owner's. */
export const CHAT_THREADS_PER_IP = 5;
/** The most messages one read returns. */
const READ_MAX = 200;

/** Why a chat call was refused, with the status the Worker answers. */
export class ChatRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChatRefusal";
  }
}

const KEY = /^[A-Za-z0-9_-]{32,64}$/;
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
const newKey = () => randomBytes(24).toString("base64url");

/** A message as the bubble shows it: theirs is `you`, ours `us`. */
export interface ChatLine {
  id: number;
  from: "you" | "us";
  body: string;
  at: string;
}
const lineOf = (m: ChatMessage): ChatLine => ({
  id: m.id,
  from: m.direction === "in" ? "you" : "us",
  body: m.body,
  at: m.at.toISOString(),
});

/** What the visitor typed as their contact: an email, else a phone of 7 to 15 digits. */
export function contactOf(raw: unknown): { email: string | null; phone: string | null } {
  const s = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { email: s.toLowerCase(), phone: null };
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+?\d{7,15}$/.test(digits)) return { email: null, phone: digits };
  return { email: null, phone: null };
}

const bodyOf = (raw: unknown): string => {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new ChatRefusal("Type a message first.", 400);
  if (s.length > CHAT_MAX) throw new ChatRefusal(`Keep it under ${CHAT_MAX} characters.`, 400);
  return s;
};

async function threadOfKey(db: Queryable, key: unknown): Promise<ChatThread> {
  if (typeof key !== "string" || !KEY.test(key)) throw new ChatRefusal("No such chat.", 404);
  const [t] = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.keyHash, keyHash(key)));
  if (!t) throw new ChatRefusal("No such chat.", 404);
  return t;
}

/** The thread's messages after `after`, oldest first. */
async function linesAfter(db: Queryable, threadId: number, after: number): Promise<ChatLine[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), gt(chatMessages.id, after)))
    .orderBy(asc(chatMessages.id))
    .limit(READ_MAX);
  return rows.map(lineOf);
}

/**
 * The visitor says something. No key starts a thread (within the owner's daily cap) and hands the
 * key back once; the bubble keeps it. Answers the thread's messages after `after`.
 */
export async function say(
  db: Queryable,
  input: {
    key?: unknown;
    body: unknown;
    name?: unknown;
    contact?: unknown;
    page?: unknown;
    after?: unknown;
    /** The visitor's IP, from the Worker: hashed before it's kept. */
    ip?: unknown;
  },
  now = new Date(),
): Promise<{ key: string; lines: ChatLine[]; started: boolean }> {
  const body = bodyOf(input.body);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) || null : null;
  const { email, phone } = contactOf(input.contact);
  let key = typeof input.key === "string" && input.key ? input.key : null;
  let thread: ChatThread;
  const started = key === null;
  if (key === null) {
    const day = gte(chatThreads.createdAt, new Date(now.getTime() - 86_400_000));
    const ipHash = typeof input.ip === "string" && input.ip ? keyHash(input.ip) : null;
    if (ipHash) {
      const [mine] = await db
        .select({ n: count() })
        .from(chatThreads)
        .where(and(eq(chatThreads.ipHash, ipHash), day));
      if ((mine?.n ?? 0) >= CHAT_THREADS_PER_IP)
        throw new ChatRefusal("You've started a few chats today. Keep going in the last one.", 429);
    }
    const [today] = await db.select({ n: count() }).from(chatThreads).where(day);
    if ((today?.n ?? 0) >= CHAT_THREADS_PER_DAY)
      throw new ChatRefusal("Chat is busy right now. Try again later.", 429);
    key = newKey();
    const page = typeof input.page === "string" ? input.page.slice(0, 500) : null;
    const [made] = await db
      .insert(chatThreads)
      .values({
        keyHash: keyHash(key),
        name,
        email,
        phone,
        page,
        ipHash,
        lastInAt: now,
        createdAt: now,
      })
      .returning();
    thread = made as ChatThread;
  } else {
    thread = await threadOfKey(db, key);
    const [hour] = await db
      .select({ n: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.threadId, thread.id),
          eq(chatMessages.direction, "in"),
          gte(chatMessages.at, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((hour?.n ?? 0) >= CHAT_PER_HOUR)
      throw new ChatRefusal("That's a lot of messages. Give us a minute to answer.", 429);
    await db
      .update(chatThreads)
      .set({
        lastInAt: now,
        // What they told us later fills what they left empty.
        name: sql`coalesce(${chatThreads.name}, ${name})`,
        email: sql`coalesce(${chatThreads.email}, ${email})`,
        phone: sql`coalesce(${chatThreads.phone}, ${phone})`,
      })
      .where(eq(chatThreads.id, thread.id));
  }
  await db.insert(chatMessages).values({ threadId: thread.id, direction: "in", body, at: now });
  const after = Number(input.after);
  return {
    key,
    lines: await linesAfter(db, thread.id, Number.isInteger(after) && after > 0 ? after : 0),
    started,
  };
}

/** The bubble checks for replies: the thread's messages after `after`. */
export async function readChat(db: Queryable, key: unknown, after: unknown): Promise<ChatLine[]> {
  const t = await threadOfKey(db, key);
  const n = Number(after);
  return linesAfter(db, t.id, Number.isInteger(n) && n > 0 ? n : 0);
}

/** Our reply from the Inbox: the bubble shows it next time it checks. */
export async function replyChat(
  db: Queryable,
  threadId: number,
  body: string,
  by: string,
  now = new Date(),
): Promise<ChatMessage> {
  const text = bodyOf(body);
  const [t] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  if (!t) throw new ChatRefusal("No such chat.", 404);
  const [m] = await db
    .insert(chatMessages)
    .values({ threadId, direction: "out", body: text, by, at: now })
    .returning();
  // Answering it reads it.
  await db.update(chatThreads).set({ readAt: now }).where(eq(chatThreads.id, threadId));
  return m as ChatMessage;
}

/** One chat thread and its messages, for the Inbox's conversation. */
export async function chatOf(
  db: Queryable,
  threadId: number,
): Promise<{ thread: ChatThread; messages: ChatMessage[] } | null> {
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.id));
  return { thread, messages };
}

/** Who a thread is, as the Inbox names it. */
export const chatWho = (t: Pick<ChatThread, "name" | "email" | "phone">) =>
  t.name ?? t.email ?? t.phone ?? "Site visitor";
