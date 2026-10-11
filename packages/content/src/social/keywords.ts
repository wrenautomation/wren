/**
 * Comment keywords (designs/2026-10-11-comment-keywords.md): a word in a comment on our Instagram
 * or Facebook post sends that person the keyword's DM, through Meta's private reply. The match
 * and the log live here; `KeywordDm` (`../restate/keyword-dm.ts`) sends.
 */
import { date, defineRecord, link, number, prose, status, text } from "@wren/core/records";
import { PortalRefusal } from "@wren/core/refusal";
import type { Queryable } from "@wren/db";
import { comments } from "@wren/outreach/schema";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  commentKeywords,
  KEYWORD_PLATFORMS,
  type KeywordPlatform,
  keywordHits,
} from "../schema.js";

/** Words as matched: lower case, accents off, letters and digits, one space between. */
export const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether the comment says the keyword as whole words: "LINK!" says "link", "linked" doesn't. */
export const saysKeyword = (comment: string, keyword: string) => {
  const k = wordsOf(keyword);
  return !!k && ` ${wordsOf(comment)} `.includes(` ${k} `);
};

export interface KeywordInput {
  keyword: string;
  dm: string;
  reply?: string | null;
  platform?: KeywordPlatform | null;
  post?: string | null;
}

const INPUT = z
  .object({
    keyword: z.string().transform(wordsOf).pipe(z.string().min(1, "say the keyword").max(40)),
    dm: z.string().trim().min(1, "write the DM").max(1000),
    reply: z.string().trim().max(300).nullish(),
    platform: z.enum(KEYWORD_PLATFORMS).nullish(),
    post: z.string().trim().max(200).nullish(),
  })
  .strip();

export async function addKeyword(db: Queryable, input: unknown, by: string) {
  const got = INPUT.safeParse(input);
  if (!got.success) throw new PortalRefusal(got.error.issues[0]?.message ?? "check the form", 400);
  const k = got.data;
  const [row] = await db
    .insert(commentKeywords)
    .values({
      keyword: k.keyword,
      dm: k.dm,
      reply: k.reply || null,
      platform: k.platform ?? null,
      post: k.post || null,
      updatedBy: by,
    })
    .onConflictDoNothing()
    .returning({ id: commentKeywords.id, keyword: commentKeywords.keyword });
  if (!row) throw new PortalRefusal(`"${k.keyword}" is set already there`, 409);
  return row;
}

export async function removeKeywords(db: Queryable, ids: readonly number[]) {
  if (!ids.length) return 0;
  const gone = await db
    .delete(commentKeywords)
    .where(inArray(commentKeywords.id, [...ids]))
    .returning({ id: commentKeywords.id });
  return gone.length;
}

export interface Hit {
  id: number;
  commentId: number;
}

/**
 * The comments just kept that say an active keyword, each logged once as `queued`: one per
 * comment (the first keyword that fits), one per person per keyword. Only theirs, only on our own
 * Instagram and Facebook posts (no reach account), only ones not DM'd already.
 */
export async function catchKeywords(db: Queryable, ids: readonly number[]): Promise<Hit[]> {
  if (!ids.length) return [];
  const keys = await db.select().from(commentKeywords).where(eq(commentKeywords.active, true));
  if (!keys.length) return [];
  const rows = await db
    .select({
      id: comments.id,
      platform: comments.platform,
      post: comments.post,
      author: comments.author,
      body: comments.body,
    })
    .from(comments)
    .where(
      and(
        inArray(comments.id, [...ids]),
        inArray(comments.platform, [...KEYWORD_PLATFORMS]),
        isNull(comments.accountId),
        isNull(comments.contactId),
        or(isNull(comments.sort), ne(comments.sort, "ours")),
      ),
    )
    .orderBy(comments.id);
  // The narrowest first: a post's own keyword over a platform's over everywhere.
  const ordered = [...keys].sort((a, b) => +!a.post - +!b.post || +!a.platform - +!b.platform);
  const hits: Hit[] = [];
  for (const c of rows) {
    const k = ordered.find(
      (k) =>
        (!k.platform || k.platform === c.platform) &&
        (!k.post || k.post === c.post) &&
        saysKeyword(c.body, k.keyword),
    );
    if (!k) continue;
    const [hit] = await db
      .insert(keywordHits)
      .values({
        keywordId: k.id,
        commentId: c.id,
        platform: c.platform as KeywordPlatform,
        author: c.author,
      })
      .onConflictDoNothing()
      .returning({ id: keywordHits.id });
    if (hit) hits.push({ id: hit.id, commentId: c.id });
  }
  return hits;
}

/** A hit's comment and keyword, for the sender. */
export async function hitOf(db: Queryable, id: number) {
  const [h] = await db
    .select({
      id: keywordHits.id,
      state: keywordHits.state,
      commentId: keywordHits.commentId,
      dm: commentKeywords.dm,
      reply: commentKeywords.reply,
    })
    .from(keywordHits)
    .innerJoin(commentKeywords, eq(commentKeywords.id, keywordHits.keywordId))
    .where(eq(keywordHits.id, id));
  return h ?? null;
}

export async function settleHit(
  db: Queryable,
  id: number,
  out: { sent: true; ref: string | null; now: Date } | { sent: false; why: string },
) {
  await db
    .update(keywordHits)
    .set(
      out.sent
        ? { state: "sent", ref: out.ref, sentAt: out.now, why: null }
        : { state: "failed", why: out.why.slice(0, 500) },
    )
    .where(eq(keywordHits.id, id));
}

const neutral = (label: string) => ({ label, tone: "neutral" as const });
const PLATFORM_LABELS = {
  instagram: neutral("Instagram"),
  facebook: neutral("Facebook"),
  any: neutral("Both"),
};

export const keywordRecord = defineRecord({
  id: "marketing.comment_keyword",
  app: "marketing",
  channel: null,
  name: { one: "keyword", many: "keywords" },
  view: "comment_keyword_records",
  key: "id",
  title: "keyword",
  subtitle: "dm",
  fields: {
    keyword: text("Keyword"),
    state: status({ on: { label: "On", tone: "good" }, off: neutral("Off") }, "State"),
    platform: status(PLATFORM_LABELS, "Site"),
    post: text("Post"),
    dm: prose("DM"),
    reply: prose("Public reply"),
    caught: number("Caught"),
    sent: number("Sent"),
    failed: number("Failed"),
    lastAt: date("Last"),
    updatedAt: date("Saved", { listed: false }),
    updatedBy: text("By", { listed: false }),
  },
  quick: ["state", "platform"],
  views: [
    { id: "on", label: "On", where: { state: ["on"] }, sort: "-caught" },
    { id: "all", label: "All", sort: "keyword" },
  ],
  actions: ["marketing.keywordAdd", "marketing.keywordRemove"],
  edits: {
    fields: ["state", "dm", "reply"],
    patch: z
      .object({
        state: z.enum(["on", "off"]),
        dm: z.string().trim().min(1).max(1000),
        reply: z.string().trim().max(300),
      })
      .partial()
      .strict(),
    about:
      "a comment keyword's DM: sent the moment someone comments the word on our post; Meta allows one per comment",
    read: async (db, id) => {
      const [k] = await db
        .select()
        .from(commentKeywords)
        .where(eq(commentKeywords.id, Number(id)));
      return k ? { state: k.active ? "on" : "off", dm: k.dm, reply: k.reply ?? "" } : null;
    },
    write: async (db, id, patch, by) => {
      await db
        .update(commentKeywords)
        .set({
          ...(patch.state !== undefined ? { active: patch.state === "on" } : {}),
          ...(patch.dm !== undefined ? { dm: String(patch.dm) } : {}),
          ...(patch.reply !== undefined ? { reply: String(patch.reply) || null } : {}),
          updatedAt: sql`now()`,
          updatedBy: by,
        })
        .where(eq(commentKeywords.id, Number(id)));
    },
  },
});

export const keywordHitRecord = defineRecord({
  id: "marketing.keyword_hit",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "keyword DM", many: "keyword DMs" },
  view: "keyword_hit_records",
  key: "id",
  title: "author",
  subtitle: "comment",
  fields: {
    author: text("Who"),
    keyword: text("Keyword"),
    comment: prose("Comment"),
    state: status(
      {
        queued: neutral("Sending"),
        sent: { label: "Sent", tone: "good" },
        failed: { label: "Failed", tone: "bad" },
      },
      "DM",
    ),
    why: text("Why"),
    platform: status(PLATFORM_LABELS, "Site"),
    post: text("Post"),
    url: link("Comment"),
    at: date("Caught"),
    sentAt: date("Sent", { listed: false }),
  },
  quick: ["state", "keyword"],
  views: [
    { id: "all", label: "All", sort: "-at", at: "at" },
    { id: "failed", label: "Failed", where: { state: ["failed"] }, sort: "-at", at: "at" },
  ],
});
