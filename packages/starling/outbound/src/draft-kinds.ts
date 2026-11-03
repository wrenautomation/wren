/**
 * Outbound's draft kinds for the draft desk (`@wren/starling-acts` DraftKind): a Reddit thread's
 * comment (`reddit_threads.draft`), ours on someone's post (`reach_posts.draft`), our next DM to a
 * reach contact (`reach_contacts.draft`), plus conversations' comment with the platform's cap
 * laid over it, as `reachKinds` lays the floors. The SOPs are the composer's (the content
 * channel's playbooks).
 */
import type { Platform } from "@wren/core/autobrowse";
import type { Queryable } from "@wren/db";
import { type DraftKind, type DraftKinds, factsBlock, siteName } from "@wren/starling-acts";
import { commentDraftKind } from "@wren/starling-conversations";
import { reachContacts } from "@wren/starling-conversations/schema";
import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { DRAFT_MAX, dmContext } from "./drafts.js";
import { invitedSql } from "./invites.js";
import { COMMENT_MAX } from "./reach-posts/settings.js";
import { type ReachPostPlatform, reachPosts, redditThreads } from "./schema.js";

export interface DraftGuides {
  /** The comments SOP for the platform; "" = none. */
  commentGuide(db: Queryable, platform: Platform): Promise<string>;
  /** The `outbound-copy` SOP for the platform; "" = none. */
  dmGuide(db: Queryable, platform: Platform): Promise<string>;
}

const THREAD_OPEN = ["new", "ranked", "queued"] as const;
/** A comment's cap where the platform has one under Reddit's and YouTube's 10,000. */
const commentMax = (platform: string) => COMMENT_MAX[platform as ReachPostPlatform] ?? 10_000;

const thread = (g: DraftGuides): DraftKind => ({
  type: "thread",
  edits: ["thread"],
  read: async (db, id) => {
    const [t] = await db.select().from(redditThreads).where(eq(redditThreads.id, id));
    if (!t) return null;
    return {
      what: "Reddit comment in a thread",
      platform: "reddit",
      title: `r/${t.subreddit}: ${t.title}`,
      draft: t.draft,
      max: 10_000,
      open: (THREAD_OPEN as readonly string[]).includes(t.state),
      context: factsBlock([
        ["Subreddit", `r/${t.subreddit}`],
        [`Post by ${t.author}`, `${t.title}\n\n${t.body}`],
        ["Answering", t.targetText],
        ["Angle", t.angle],
        ["Read for the draft", t.sources?.map((s) => `${s.label}: ${s.text}`).join("\n\n")],
      ]),
      about: `${t.title} ${t.body}`,
      guide: await g.commentGuide(db, "reddit"),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(redditThreads)
      .set({ draft: text })
      .where(and(eq(redditThreads.id, id), inArray(redditThreads.state, THREAD_OPEN)))
      .returning({ id: redditThreads.id });
    if (!done.length)
      throw new Error(
        "That thread is commented, skipped or dropped already, so its comment can't change.",
      );
  },
  waiting: async (db, limit) =>
    (
      await db
        .select()
        .from(redditThreads)
        .where(and(eq(redditThreads.state, "queued"), isNotNull(redditThreads.draft)))
        .orderBy(desc(redditThreads.postedAt))
        .limit(limit)
    ).map((t) => ({
      item: `thread:${t.id}`,
      type: "thread" as const,
      title: `r/${t.subreddit}: ${t.title}`,
      draft: t.draft,
      at: t.postedAt,
    })),
});

/** Our comment on someone else's post, while it waits. */
const onpost = (g: DraftGuides): DraftKind => ({
  type: "onpost",
  edits: ["onpost"],
  read: async (db, id) => {
    if (!/^\d+$/.test(id)) return null;
    const [p] = await db
      .select()
      .from(reachPosts)
      .where(eq(reachPosts.id, Number(id)));
    if (!p) return null;
    return {
      what: `${siteName(p.platform)} comment on someone else's post`,
      platform: p.platform,
      title: `${siteName(p.platform)}: ${p.author}`,
      draft: p.draft,
      max: COMMENT_MAX[p.platform],
      open: p.state === "found" || p.state === "queued",
      context: factsBlock([
        [`Post by ${p.author}`, `${p.headline ? `${p.headline}\n\n` : ""}${p.text}`],
        ["Why it was picked", p.why],
      ]),
      about: p.text,
      guide: await g.commentGuide(db, p.platform),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(reachPosts)
      .set({ draft: text })
      .where(and(eq(reachPosts.id, Number(id)), inArray(reachPosts.state, ["found", "queued"])))
      .returning({ id: reachPosts.id });
    if (!done.length)
      throw new Error(
        "That post is commented, skipped or dropped already, so its comment can't change.",
      );
  },
  waiting: async (db, limit) =>
    (
      await db
        .select()
        .from(reachPosts)
        .where(and(eq(reachPosts.state, "queued"), isNotNull(reachPosts.draft)))
        .orderBy(desc(reachPosts.queuedAt))
        .limit(limit)
    ).map((p) => ({
      item: `onpost:${p.id}`,
      type: "onpost" as const,
      title: `${siteName(p.platform)}: ${p.author}`,
      draft: p.draft,
      at: p.queuedAt ?? p.createdAt,
    })),
});

/** A contact who asked us to stop gets no draft. */
const STOPPED: ("opted_out" | "blocked")[] = ["opted_out", "blocked"];
/** An accepted invite nobody wrote to yet: no message either way past the invite. */
const FIRST = sql`${reachContacts.connectedAt} is not null and ${invitedSql(sql`${reachContacts.id}`)}
  and not exists (select 1 from reach_messages m where m.contact_id = ${reachContacts.id}
    and (m.direction = 'in' or m.kind <> 'connect'))`;
/** Ask Claude keeps a DM reply's and a first message's edits as one kind. */
const DM_EDITS = ["dm", "invite"] as const;

/**
 * Our next DM to a reach contact: a reply on a thread (`dm`) or a first message to an accepted
 * invite (`invite`). Ids are the contact's. A write answers their newest word (`draft_for`), so
 * the watch's model doesn't write over it until they write again.
 */
const reach = (type: "dm" | "invite", g: DraftGuides): DraftKind => ({
  type,
  edits: DM_EDITS,
  read: async (db, id) => {
    if (!/^\d+$/.test(id)) return null;
    const [c] = await db
      .select()
      .from(reachContacts)
      .where(eq(reachContacts.id, Number(id)));
    if (!c) return null;
    return {
      what: `${siteName(c.platform)} ${type === "dm" ? "direct message" : "first message after they accepted my invite"}`,
      platform: c.platform,
      title: c.name ?? c.handle,
      draft: c.draft,
      max: DRAFT_MAX,
      open: !(STOPPED as string[]).includes(c.state),
      context: (await dmContext(db, c.id)).prompt,
      guide: await g.dmGuide(db, c.platform),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(reachContacts)
      .set({
        draft: text,
        draftAt: new Date(),
        draftFor: sql`(select id from reach_messages where contact_id = ${Number(id)}
          and direction = 'in' order by coalesce(sent_at, created_at) desc, id desc limit 1)`,
      })
      .where(and(eq(reachContacts.id, Number(id)), notInArray(reachContacts.state, STOPPED)))
      .returning({ id: reachContacts.id });
    if (!done.length) throw new Error("They asked us to stop, so nothing more goes to them.");
  },
  waiting: async (db, limit) =>
    (
      await db
        .select()
        .from(reachContacts)
        .where(
          and(
            isNotNull(reachContacts.draft),
            notInArray(reachContacts.state, STOPPED),
            type === "invite" ? FIRST : sql`not (${FIRST})`,
          ),
        )
        .orderBy(desc(reachContacts.draftAt))
        .limit(limit)
    ).map((c) => ({
      item: `${type}:${c.id}`,
      type,
      title: `${siteName(c.platform)}: ${c.name ?? c.handle}`,
      draft: c.draft,
      at: c.draftAt ?? c.createdAt,
    })),
});

/** The draft kinds outbound answers for: its own and conversations' comment with the platform's cap. */
export const reachDraftKinds = (g: DraftGuides): DraftKinds => ({
  comment: commentDraftKind({ guide: g.commentGuide, max: commentMax }),
  thread: thread(g),
  onpost: onpost(g),
  dm: reach("dm", g),
  invite: reach("invite", g),
});
