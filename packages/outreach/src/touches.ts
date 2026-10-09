/**
 * The outreach tables as touches (designs/2026-10-07-touches.md): one function per source row,
 * called where the row is written and again by the backfill, so both keep the same line under
 * the same ref. `rm:` a DM or invite, `c:` their comment, `ca:` our answer to it, `rt:` our
 * comment on a Reddit thread, `rp:` ours on someone's post (LinkedIn, X, Instagram).
 */
import {
  recordTouch,
  respond,
  type TouchKind,
  type TouchResponse,
  touches,
} from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Comment,
  comments,
  reachAccounts,
  reachContacts,
  reachMessages,
  reachPosts,
  redditThreads,
} from "./schema.js";

/** The account our own pages speak as (content comments, LinkedIn post comments). */
export const OWN_ACCOUNT = "wren";

/**
 * A touch write never fails the send or read it follows: the source row already holds the
 * fact, and the backfill writes it again.
 */
export async function keepTouch<T>(what: string, write: () => Promise<T>): Promise<T | null> {
  try {
    return await write();
  } catch (err) {
    console.warn(`touch ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const accountName = async (db: Queryable, id: string | null) => {
  if (!id) return null;
  const [a] = await db
    .select({ account: reachAccounts.account })
    .from(reachAccounts)
    .where(eq(reachAccounts.id, id));
  return a?.account ?? null;
};

/** A DM or invite, ours once sent, theirs once received. Theirs marks ours DMs before it replied. */
export async function touchFromMessage(db: Queryable, messageId: number) {
  const [m] = await db
    .select({ msg: reachMessages, contact: reachContacts })
    .from(reachMessages)
    .innerJoin(reachContacts, eq(reachContacts.id, reachMessages.contactId))
    .where(eq(reachMessages.id, messageId));
  if (!m) return null;
  const { msg, contact } = m;
  const ours = msg.direction === "out";
  if (ours && msg.state !== "sent") return null;
  const at = msg.sentAt ?? msg.createdAt;
  const t = await recordTouch(db, {
    platform: contact.platform,
    handle: contact.handle,
    name: contact.name,
    personId: contact.personId,
    kind: ours && msg.kind === "connect" ? "connect" : "dm",
    direction: ours ? "ours" : "theirs",
    account: await accountName(db, msg.accountId ?? contact.accountId),
    url: contact.url || null,
    text: msg.body,
    at,
    externalId: msg.ref,
    source: "reach_messages",
    ref: `rm:${msg.id}`,
  });
  if (t && !ours)
    await respond(db, { handleId: t.handleId, kinds: ["dm"], before: at }, "replied", at);
  return t;
}

/** Invites answered: `accepted` on the sweep's accept, `ignored` once withdrawn or gone. */
export async function touchInvites(
  db: Queryable,
  contactIds: readonly number[],
  response: TouchResponse,
  at: Date,
): Promise<number> {
  if (!contactIds.length) return 0;
  const sent = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        inArray(reachMessages.contactId, [...contactIds]),
        eq(reachMessages.kind, "connect"),
        eq(reachMessages.state, "sent"),
      ),
    );
  let n = 0;
  for (const m of sent) {
    await touchFromMessage(db, m.id);
    n += await respond(db, { ref: `rm:${m.id}` }, response, at);
  }
  return n;
}

/**
 * Who wrote a comment, as the platform keys them: X lists the author's numeric id, Reddit and
 * LinkedIn a handle or URN.
 */
const authorOf = (platform: string, author: string) =>
  platform === "x" && /^\d+$/.test(author) ? `id:${author}` : author;

const ownAccount = async (db: Queryable, c: Pick<Comment, "accountId">) =>
  (await accountName(db, c.accountId)) ?? OWN_ACCOUNT;

/**
 * Their comment on our post, reply under ours, or mention: theirs. A reply whose parent is a
 * touch of ours answers it. Ours (`sort = ours`) are skipped: our answers are `ca:` touches.
 */
export async function touchFromComment(db: Queryable, id: number) {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c || c.sort === "ours") return null;
  let kind: TouchKind = c.kind === "username_mention" ? "mention" : "comment";
  if (c.kind === "comment_reply") {
    // The reach inbox lists replies to us; on our own posts a reply may be to anyone.
    const [ours] =
      c.channel === "reach"
        ? [true]
        : await db
            .select({ id: touches.id })
            .from(touches)
            .where(and(eq(touches.externalId, c.parent), eq(touches.direction, "ours")))
            .limit(1);
    kind = ours ? "reply" : "comment";
  }
  return recordTouch(db, {
    platform: c.platform,
    handle: authorOf(c.platform, c.author),
    kind,
    direction: "theirs",
    account: await ownAccount(db, c),
    url: c.url || null,
    text: c.body,
    at: c.at,
    externalId: c.ref,
    inReplyTo: c.kind === "comment_reply" ? c.parent : null,
    source: "comments",
    ref: `c:${c.id}`,
  });
}

/** Our answer to their comment: ours, a reply. Their reply under it names `answer_ref`. */
export async function touchFromAnswer(db: Queryable, id: number) {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c?.answer || !c.answeredAt || c.sort === "ours") return null;
  return recordTouch(db, {
    platform: c.platform,
    handle: authorOf(c.platform, c.author),
    kind: "reply",
    direction: "ours",
    account: await ownAccount(db, c),
    url: c.url || null,
    text: c.answer,
    at: c.answeredAt,
    externalId: c.answerRef,
    source: "comments",
    ref: `ca:${c.id}`,
  });
}

/** `u/<author>: …`, as `target_text` names the comment a thread answer replies to. */
const targetAuthor = (text: string | null) => /^u\/([A-Za-z0-9_-]{3,20}):/.exec(text ?? "")?.[1];

/** Our comment in a Reddit thread: on the OP's post, or a reply to the comment that asked. */
export async function touchFromThread(db: Queryable, id: string) {
  const [t] = await db.select().from(redditThreads).where(eq(redditThreads.id, id));
  if (t?.state !== "commented" || !t.answer || !t.answeredAt) return null;
  const reply = !!t.target?.startsWith("t1_");
  const author = reply ? targetAuthor(t.targetText) : t.author;
  if (!author) return null;
  return recordTouch(db, {
    platform: "reddit",
    handle: author,
    kind: reply ? "reply" : "comment",
    direction: "ours",
    account: await accountName(db, t.accountId),
    url: t.url,
    text: t.answer,
    at: t.answeredAt,
    externalId: t.answerRef,
    source: "reddit_threads",
    ref: `rt:${t.id}`,
  });
}

/**
 * Ours on someone's post: the comment, then the like and the follow that went with it. LinkedIn
 * keys them by profile URL (a company page keys as `company:<slug>`), else by name; X and
 * Instagram by username. LinkedIn and X comments go out as our own page (`wren`), the rest as
 * the reading account. The comment's own id isn't returned, so replies to it aren't read yet.
 */
export async function touchesFromReachPost(db: Queryable, id: number) {
  const [p] = await db.select().from(reachPosts).where(eq(reachPosts.id, id));
  if (!p) return null;
  const handle = p.platform === "linkedin" ? p.authorUrl || p.author : p.handle || p.author;
  const base = { platform: p.platform, handle, name: p.author, direction: "ours" as const };
  const done: Array<{ created: boolean } | null> = [];
  if (p.state === "commented" && p.comment && p.commentedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "comment",
        account: p.platform === "instagram" ? p.account : OWN_ACCOUNT,
        url: p.url,
        text: p.comment,
        at: p.commentedAt,
        source: "reach_posts",
        ref: `rp:${p.id}`,
      }),
    );
  if (p.likedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "like",
        account: p.account,
        url: p.url,
        at: p.likedAt,
        source: "reach_posts",
        ref: `rp:${p.id}:like`,
      }),
    );
  if (p.followedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "follow",
        account: p.account,
        url: p.authorUrl,
        at: p.followedAt,
        source: "reach_posts",
        ref: `rp:${p.id}:follow`,
      }),
    );
  return { created: done.some((d) => d?.created) };
}

export interface TouchBackfill {
  messages: number;
  comments: number;
  answers: number;
  threads: number;
  posts: number;
  responses: number;
}

/**
 * Every outreach source row as touches, oldest first so a reply finds what it answers. Re-runs
 * keep nothing twice. `dryRun` counts the rows it would read.
 */
export async function backfillOutreachTouches(
  db: Queryable,
  o: { dryRun?: boolean; now?: Date } = {},
): Promise<TouchBackfill> {
  const out: TouchBackfill = {
    messages: 0,
    comments: 0,
    answers: 0,
    threads: 0,
    posts: 0,
    responses: 0,
  };
  const msgs = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(sql`(direction = 'in') or (direction = 'out' and state = 'sent')`)
    .orderBy(sql`coalesce(sent_at, created_at)`, reachMessages.id);
  const ours = await db
    .select({
      id: comments.id,
      answered: sql<boolean>`answer is not null and answered_at is not null`,
    })
    .from(comments)
    .where(sql`sort is distinct from 'ours'`)
    .orderBy(comments.at, comments.id);
  const threads = await db
    .select({ id: redditThreads.id })
    .from(redditThreads)
    .where(eq(redditThreads.state, "commented"))
    .orderBy(redditThreads.answeredAt);
  const posts = await db
    .select({ id: reachPosts.id })
    .from(reachPosts)
    .where(sql`state = 'commented' or liked_at is not null or followed_at is not null`)
    .orderBy(sql`coalesce(commented_at, liked_at, followed_at)`, reachPosts.id);
  if (o.dryRun) {
    return {
      ...out,
      messages: msgs.length,
      comments: ours.length,
      answers: ours.filter((c) => c.answered).length,
      threads: threads.length,
      posts: posts.length,
    };
  }
  const made = (t: { created: boolean } | null) => (t?.created ? 1 : 0);
  // Ours first, then theirs, so a reply's parent is already a touch.
  for (const t of threads) out.threads += made(await touchFromThread(db, t.id));
  for (const p of posts) out.posts += made(await touchesFromReachPost(db, p.id));
  for (const c of ours) if (c.answered) out.answers += made(await touchFromAnswer(db, c.id));
  for (const m of msgs) out.messages += made(await touchFromMessage(db, m.id));
  for (const c of ours) out.comments += made(await touchFromComment(db, c.id));
  const contacts = await db
    .select({
      id: reachContacts.id,
      connectedAt: reachContacts.connectedAt,
      withdrawnAt: reachContacts.withdrawnAt,
      state: reachContacts.state,
      endedAt: reachContacts.endedAt,
    })
    .from(reachContacts)
    .where(
      sql`connected_at is not null or withdrawn_at is not null or (state = 'unreachable' and state_reason like 'invite no longer pending%')`,
    );
  for (const c of contacts) {
    if (c.connectedAt) out.responses += await touchInvites(db, [c.id], "accepted", c.connectedAt);
    else
      out.responses += await touchInvites(
        db,
        [c.id],
        "ignored",
        c.withdrawnAt ?? c.endedAt ?? o.now ?? new Date(),
      );
  }
  return out;
}
