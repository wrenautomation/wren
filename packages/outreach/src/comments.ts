/**
 * Comments as an event source (designs/2026-10-01-reach-reddit-linkedin.md, Comments). Each
 * account's inbox is read with its DMs; every new comment on our posts or under our comments is a
 * row and one `comment` event on the spine. `comments.sort` reads it: clear words in code for $0,
 * a model for the rest, which also drafts an answer when they asked something. William answers,
 * DMs or drops each one from the Replies queue; nothing goes out without his click.
 */

import { warmupOf } from "@wren/channel-reddit";
import type { CommentIn, OutreachChannel } from "@wren/core/outreach";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db, Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { addProspects, contactByHandle } from "./contacts.js";
import { ReachRefusal } from "./refusal.js";
import {
  COMMENT_KINDS,
  type Comment,
  type CommentKind,
  type CommentSort,
  comments,
  type ReachAccount,
  reachAccounts,
  reachContacts,
  reachMessages,
} from "./schema.js";
import { queueManual } from "./tick.js";

/** The workflow, and the node the reader is in it. */
export const COMMENTS_FLOW = "reach.comments";
export const COMMENTS_FROM = "read.comment";

/** They asked for the thing, or to be written to: settled in code, never misread. */
const ASKED =
  /\b(dm me|pm me|message me|send (it|me|over)|i'?m in|count me in|interested|i'?d love (it|that|this|one|a copy)|please share|share (it|the link))\b/i;

export const askedInWords = (text: string) => ASKED.test(text);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Keep what the inbox listed; a re-read keeps nothing twice. Ours are kept and closed. Answers the
 * new comments from other people, oldest first.
 */
export async function keepComments(
  db: Queryable,
  account: Pick<ReachAccount, "id" | "platform">,
  items: readonly CommentIn[],
  ours: readonly string[],
): Promise<Array<Pick<Comment, "id" | "platform" | "author" | "post">>> {
  if (!items.length) return [];
  const rows = [...items]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => {
      const mine = ours.some((h) => same(h, c.handle));
      return {
        platform: account.platform,
        accountId: account.id,
        ref: c.ref.slice(0, 200),
        post: c.post.slice(0, 200),
        parent: c.parent.slice(0, 200),
        // A type Reddit adds later is filed as a reply; the message itself stays in `raw`.
        kind: (COMMENT_KINDS as readonly string[]).includes(c.kind)
          ? (c.kind as CommentKind)
          : ("comment_reply" as const),
        place: c.place?.slice(0, 200) ?? null,
        postTitle: c.postTitle,
        author: c.handle.slice(0, 120),
        body: c.text,
        url: c.url,
        at: new Date(c.at),
        raw: c.raw,
        ...(mine ? { sort: "ours" as const, state: "dropped" as const, why: "One of ours" } : {}),
      };
    });
  const kept = await db.insert(comments).values(rows).onConflictDoNothing().returning({
    id: comments.id,
    platform: comments.platform,
    author: comments.author,
    post: comments.post,
    sort: comments.sort,
  });
  return kept
    .filter((k) => k.sort !== "ours")
    .map(({ sort: _, ...k }) => k)
    .sort((a, b) => a.id - b.id);
}

/** One kept comment on the spine. */
export const commentEvent = (c: Pick<Comment, "id" | "platform" | "author" | "post">) =>
  ({
    subject: `comment:${c.id}`,
    kind: "comment",
    data: { commentId: c.id, platform: c.platform, author: c.author, post: c.post },
  }) satisfies SpineEvent;

const SYSTEM = `You read a comment someone left on our Reddit post or under our comment. We are \
Wren Automation; our posts give something useful and never pitch. Sort it: "asked" = they asked \
for what the post offered, or to be messaged; "question" = they asked us something; "chat" = \
anything else friendly or neutral; "hostile" = an attack, spam or a troll. For asked and question \
only, write the answer we'd post under it: casual and plain, at most 2 short sentences, no links, \
no pitch, no emojis; for asked, say you'll DM them. Otherwise answer "". Answer JSON only: \
{"sort": "asked" | "question" | "chat" | "hostile", "why": "<one short line>", "answer": "<text>"}`;

export const promptFor = (c: Comment) =>
  `Post: ${c.postTitle ?? "(untitled)"}${c.place ? ` in r/${c.place}` : ""}\n` +
  `${c.kind === "comment_reply" ? "Under our comment" : "On our post"}, u/${c.author} wrote:\n${c.body}`;

const ANSWER = z.object({
  sort: z.enum(["asked", "question", "chat", "hostile"]),
  why: z.string(),
  answer: z.string(),
});

const line = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Sort one comment and draft its answer. Null when there's no such row; a second call answers the
 * first's sort. With no model, or an answer that doesn't read, it waits unsorted: a missed comment
 * costs more than a glance. A provider failure throws, so the step tries again.
 */
export async function sortComment(
  db: Db,
  llm: LlmClient | null,
  id: number,
): Promise<CommentSort | null> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) return null;
  if (c.sort || c.state !== "new") return c.sort;
  let sort: CommentSort | null = askedInWords(c.body) ? "asked" : null;
  let why = sort ? "Asked in words" : "No model is set, so it waits unsorted.";
  let draft: string | null = null;
  if (llm) {
    const out = await completeAndParse(llm, promptFor(c), ANSWER, {
      maxTokens: 300,
      system: SYSTEM,
      name: "comments.sort",
    });
    if (out.parsed) {
      if (!sort) {
        sort = out.parsed.sort;
        why = line(out.parsed.why);
      }
      if (sort === "asked" || sort === "question") draft = out.parsed.answer.trim() || null;
    } else if (!sort) why = "The model's answer didn't read, so it waits unsorted.";
  }
  await db
    .update(comments)
    .set({ sort, why, draft, state: "waiting" })
    .where(and(eq(comments.id, id), eq(comments.state, "new")));
  return sort;
}

/** `comments.sort` on the spine: the comment leaves by its sort's port; unsorted, by `chat`. */
export const sortStep =
  (db: Db, llm: LlmClient | null): Step =>
  async (_port, e) => {
    const id = Number(e.data.commentId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept comment`);
    const sort = await sortComment(db, llm, id);
    return sort === "ours" ? [] : [{ port: sort ?? "chat", event: e }];
  };

export async function commentById(db: Queryable, id: number): Promise<Comment> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) throw new ReachRefusal(`no comment ${id}`);
  return c;
}

async function accountOf(db: Queryable, c: Comment): Promise<ReachAccount> {
  const [a] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, c.accountId));
  if (!a) throw new ReachRefusal(`comment ${c.id}: its account is gone`);
  return a;
}

/** Our other accounts' handles on the platform: never two of ours in one thread. */
async function othersOf(db: Queryable, a: ReachAccount): Promise<string[]> {
  const rows = await db
    .select({ handle: reachAccounts.handle })
    .from(reachAccounts)
    .where(and(eq(reachAccounts.platform, a.platform), ne(reachAccounts.id, a.id)));
  return rows.flatMap((r) => (r.handle ? [r.handle] : []));
}

/** Answers this account sent today (UTC day), against its rung's comment cap. */
async function answeredToday(db: Queryable, accountId: string, now: Date): Promise<number> {
  const day = new Date(now.toISOString().slice(0, 10));
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.accountId, accountId), gte(comments.answeredAt, day)));
  return r?.n ?? 0;
}

export interface AnswerPlan {
  comment: Comment;
  account: ReachAccount;
  others: string[];
}

/** Everything that refuses an answer before the platform is asked. */
export async function planAnswer(db: Queryable, id: number, now: Date): Promise<AnswerPlan> {
  const comment = await commentById(db, id);
  if (comment.state === "answered") throw new ReachRefusal("already answered");
  if (comment.sort === "ours") throw new ReachRefusal("that one is ours");
  const account = await accountOf(db, comment);
  if (account.state === "paused" || account.state === "retired")
    throw new ReachRefusal(`${account.account} is ${account.state}`);
  if (account.platform === "reddit" && account.health) {
    const w = warmupOf(account.health as Parameters<typeof warmupOf>[0], now);
    if (w.frozen) throw new ReachRefusal(`${account.account}: ${w.frozen}`);
    if ((await answeredToday(db, account.id, now)) >= w.caps.comments)
      throw new ReachRefusal(
        `${account.account} is at ${w.stage}: ${w.caps.comments} comments a day${w.next ? ` (${w.next})` : ""}`,
      );
  }
  return { comment, account, others: await othersOf(db, account) };
}

/** Refuses when another of our accounts already wrote in the thread. */
export function checkThread(authors: readonly string[], others: readonly string[]) {
  const met = others.find((o) => authors.some((a) => same(a, o)));
  if (met) throw new ReachRefusal(`u/${met} already wrote in this thread; ours never meet in one`);
}

export async function markAnswered(
  db: Queryable,
  id: number,
  r: { body: string; ref: string | null; now: Date },
) {
  await db
    .update(comments)
    .set({ state: "answered", answer: r.body, answerRef: r.ref, answeredAt: r.now })
    .where(eq(comments.id, id));
}

/** The answer, end to end, for the CLI and tests; the desk journals the same steps one by one. */
export async function answerComment(
  db: Queryable,
  ch: OutreachChannel,
  req: { id: number; body: string; now: Date },
): Promise<{ ref: string | null }> {
  const body = req.body.trim();
  if (!body) throw new ReachRefusal("the answer is empty");
  const plan = await planAnswer(db, req.id, req.now);
  if (!ch.comment) throw new ReachRefusal(`${plan.account.platform} can't answer comments`);
  checkThread((await ch.threadAuthors?.(plan.comment.post)) ?? [], plan.others);
  const sent = await ch.comment(plan.comment.ref, body);
  await markAnswered(db, req.id, { body, ref: sent.ref, now: req.now });
  return { ref: sent.ref };
}

/**
 * A DM to the comment's author from the account that read it, queued for the sender. Once per
 * person: after that, only their reply opens the thread again, and it's answered there.
 */
export async function dmCommenter(
  db: Queryable,
  req: { id: number; body: string; subject?: string | null; now: Date },
): Promise<{ contactId: number; messageId: number }> {
  const body = req.body.trim();
  if (!body) throw new ReachRefusal("the message is empty");
  const c = await commentById(db, req.id);
  if (c.sort === "ours") throw new ReachRefusal("that one is ours");
  const account = await accountOf(db, c);
  if (account.platform === "reddit" && account.health) {
    const w = warmupOf(account.health as Parameters<typeof warmupOf>[0], req.now);
    if (w.frozen) throw new ReachRefusal(`${account.account}: ${w.frozen}`);
    if (w.caps.messages === 0)
      throw new ReachRefusal(`${account.account} can't DM yet: ${w.next || w.stage}`);
  }
  await addProspects(db, c.platform, [
    {
      handle: c.author,
      url: `https://www.reddit.com/user/${c.author}`,
      name: null,
      headline: null,
      foundIn: c.place ? `r/${c.place}` : "comment",
    },
  ]);
  const contact = await contactByHandle(db, c.platform, c.author);
  if (["opted_out", "blocked"].includes(contact.state))
    throw new ReachRefusal(`u/${c.author} asked us to stop`);
  const [prior] = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.contactId, contact.id),
        eq(reachMessages.direction, "out"),
        inArray(reachMessages.state, ["queued", "sending", "sent", "unknown"]),
      ),
    )
    .limit(1);
  if (prior) throw new ReachRefusal(`u/${c.author} has a DM from us; answer in their thread`);
  if (!contact.accountId)
    await db
      .update(reachContacts)
      .set({ accountId: account.id })
      .where(eq(reachContacts.id, contact.id));
  const msg = await queueManual(db, {
    contact: { ...contact, accountId: contact.accountId ?? account.id },
    body,
    subject: req.subject ?? c.postTitle?.slice(0, 100) ?? null,
    now: req.now,
  });
  await db.update(comments).set({ contactId: contact.id }).where(eq(comments.id, c.id));
  return { contactId: contact.id, messageId: msg.id };
}

export async function dropComment(db: Queryable, id: number): Promise<void> {
  await db
    .update(comments)
    .set({ state: "dropped" })
    .where(and(eq(comments.id, id), ne(comments.state, "answered")));
}
