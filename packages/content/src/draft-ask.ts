/**
 * Every draft William finishes, by kind (designs/2026-10-06-content-desk.md, 3 and 4): a post
 * (`content_drafts.text`), a comment's answer (`comments.draft`), a Reddit thread's comment
 * (`reddit_threads.draft`). Each kind reads its draft with what Claude needs beside it and writes
 * the same field the console edits. Ids are the Inbox's: `draft:12`, `comment:3`, `thread:t3_x`.
 *
 * Every write is a `runs` row (`draft-ask`, `draft-set`, `draft-undo`) keeping the text it
 * replaced, so the item's thread shows it and Undo puts it back.
 */

import { finishRun, openRun } from "@wren/core";
import { type DraftCommand, draftEdits, draftTurns, editsFor } from "@wren/core/ask";
import type { Platform } from "@wren/core/content";
import {
  isThread,
  THREAD_BREAK,
  THREAD_MAX,
  THREAD_MIN,
  X_POST_MAX,
} from "@wren/core/content/thread";
import { recordDraft } from "@wren/core/draft-record";
import { parseKind } from "@wren/core/slots";
import { type LiveTemplate, promptRef, renderPrompt } from "@wren/core/templates";
import { defaultSource } from "@wren/core/templates/defaults";
import { atomic, type Queryable } from "@wren/db";
import {
  COMMENT_KINDS_LEARNED,
  comments,
  DRAFT_MAX,
  dmContext,
  examplesFor,
  COMMENT_MAX as POST_COMMENT_MAX,
  reachContacts,
  reachPosts,
  redditThreads,
} from "@wren/outreach";
import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { PLATFORM_SPECS } from "./platforms.js";
import { commentGuide, dmGuide, playbookFor } from "./playbook.js";
import { editDraft } from "./review.js";
import { contentDrafts, contentIdeas } from "./schema.js";

/** What `wren drafts list --type` names: a post is an Inbox `draft:`. */
export const DRAFT_TYPES = ["post", "comment", "thread", "dm", "invite", "onpost"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export interface DraftItem {
  /** What it is, for the prompt: "LinkedIn post", "Reddit comment answer". */
  what: string;
  platform?: string;
  /** One line for a list: the post's title, who commented. */
  title: string;
  draft: string | null;
  /** Its platform's cap on the draft. */
  max: number;
  /** Whether the draft can still change: waiting on William, not sent. */
  open: boolean;
  /** What Claude reads beside it: the post, the comment, the thread. */
  context: string;
  /** The platform's playbook and comments SOP; "" = none. */
  guide: string;
  /** His last 5 edits of this kind as a prompt block (`readDraft` adds it); "" = none. */
  edits?: string;
  /** A comment: what it answers, to pick his past decisions closest to it. */
  about?: string;
  /** A comment: his past sent and turned-down comments as a prompt block (`readDraft`); "" = none. */
  examples?: string;
}

export interface Waiting {
  item: string;
  type: DraftType;
  title: string;
  draft: string | null;
  at: Date;
}

interface DraftKind {
  type: DraftType;
  read: (db: Queryable, id: string) => Promise<DraftItem | null>;
  /** The same field the console edits; throws when it can't (sent, over the cap). */
  write: (db: Queryable, id: string, text: string | null) => Promise<void>;
  /** Drafts waiting on William, newest first. */
  waiting: (db: Queryable, limit: number) => Promise<Waiting[]>;
}

/** A comment's cap where the platform has one under Reddit's and YouTube's 10,000. */
const COMMENT_MAX: Readonly<Record<string, number>> = POST_COMMENT_MAX;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE: Record<string, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Business Profile",
};
const siteOf = (p: string) => SITE[p] ?? p;

/** "Label: value" blocks, the empty ones left out. */
const facts = (pairs: [string, unknown][]) =>
  pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}:\n${String(v)}`)
    .join("\n\n");

const POST_OPEN = ["draft", "failed", "approved"];
const COMMENT_OPEN = ["new", "waiting"] as const;
const THREAD_OPEN = ["new", "ranked", "queued"] as const;

const post: DraftKind = {
  type: "post",
  read: async (db, id) => {
    if (!UUID.test(id)) return null;
    const [d] = await db
      .select({
        platform: contentDrafts.platform,
        text: contentDrafts.text,
        title: contentDrafts.title,
        status: contentDrafts.status,
        extra: contentDrafts.extra,
        idea: contentIdeas.text,
      })
      .from(contentDrafts)
      .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
      .where(eq(contentDrafts.id, id));
    if (!d) return null;
    const spec = PLATFORM_SPECS[d.platform];
    // A thread is one text: its posts split by a line of ---, each checked by `editDraft`.
    const thread = isThread(d);
    return {
      what: thread
        ? `thread on X of ${THREAD_MIN} to ${THREAD_MAX} posts. Put a line holding only --- between posts. Each post is at most ${X_POST_MAX} characters, the last one with room for a link added after it. No link in the first post. The whole thread`
        : `${siteOf(d.platform)} post`,
      platform: d.platform,
      title: d.title ?? d.idea.slice(0, 80),
      draft: d.text,
      max: thread ? THREAD_MAX * (X_POST_MAX + THREAD_BREAK.length) : spec.maxChars,
      open: POST_OPEN.includes(d.status),
      context: facts([
        ["The idea it was drafted from", d.idea],
        ["Its title (unchanged by a rewrite)", d.title],
      ]),
      guide: (await playbookFor(db, d.platform))?.text ?? "",
    };
  },
  write: async (db, id, text) => {
    if (text === null) throw new Error("a post can't be empty");
    await editDraft(db, id, { text });
  },
  waiting: async (db, limit) =>
    (
      await db
        .select({
          id: contentDrafts.id,
          platform: contentDrafts.platform,
          title: contentDrafts.title,
          text: contentDrafts.text,
          at: contentDrafts.createdAt,
        })
        .from(contentDrafts)
        .where(inArray(contentDrafts.status, ["draft", "failed"]))
        .orderBy(desc(contentDrafts.createdAt))
        .limit(limit)
    ).map((d) => ({
      item: `draft:${d.id}`,
      type: "post" as const,
      title: `${siteOf(d.platform)}: ${d.title ?? d.text.slice(0, 60)}`,
      draft: d.text,
      at: d.at,
    })),
};

const comment: DraftKind = {
  type: "comment",
  read: async (db, id) => {
    if (!/^\d+$/.test(id)) return null;
    const [c] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, Number(id)));
    if (!c) return null;
    return {
      what: `${siteOf(c.platform)} comment answer`,
      platform: c.platform,
      title: c.author,
      draft: c.draft,
      max: COMMENT_MAX[c.platform] ?? 10_000,
      open: (COMMENT_OPEN as readonly string[]).includes(c.state),
      context: facts([
        ["Where", c.place],
        ["Our post", c.postTitle],
        [`${c.author} wrote`, c.body],
        ["Read as", c.why ? `${c.sort}: ${c.why}` : c.sort],
      ]),
      about: `${c.postTitle ?? ""} ${c.body}`,
      guide: await commentGuide(db, c.platform as Platform),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(comments)
      .set({ draft: text })
      .where(and(eq(comments.id, Number(id)), inArray(comments.state, COMMENT_OPEN)))
      .returning({ id: comments.id });
    if (!done.length) throw new Error(`comment ${id} is answered or dropped`);
  },
  waiting: async (db, limit) =>
    (
      await db
        .select()
        .from(comments)
        .where(and(inArray(comments.state, COMMENT_OPEN), isNotNull(comments.draft)))
        .orderBy(desc(comments.at))
        .limit(limit)
    ).map((c) => ({
      item: `comment:${c.id}`,
      type: "comment" as const,
      title: `${siteOf(c.platform)}: ${c.author} on ${c.postTitle ?? c.place ?? "a post"}`,
      draft: c.draft,
      at: c.at,
    })),
};

const thread: DraftKind = {
  type: "thread",
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
      context: facts([
        ["Subreddit", `r/${t.subreddit}`],
        [`Post by ${t.author}`, `${t.title}\n\n${t.body}`],
        ["Answering", t.targetText],
        ["Angle", t.angle],
        ["Read for the draft", t.sources?.map((s) => `${s.label}: ${s.text}`).join("\n\n")],
      ]),
      about: `${t.title} ${t.body}`,
      guide: await commentGuide(db, "reddit"),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(redditThreads)
      .set({ draft: text })
      .where(and(eq(redditThreads.id, id), inArray(redditThreads.state, THREAD_OPEN)))
      .returning({ id: redditThreads.id });
    if (!done.length) throw new Error(`thread ${id} is commented, skipped or dropped`);
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
};

/** Our comment on someone else's post (`reach_posts.draft`), while it waits. */
const onpost: DraftKind = {
  type: "onpost",
  read: async (db, id) => {
    if (!/^\d+$/.test(id)) return null;
    const [p] = await db
      .select()
      .from(reachPosts)
      .where(eq(reachPosts.id, Number(id)));
    if (!p) return null;
    return {
      what: `${PLATFORM_SPECS[p.platform].name} comment on someone else's post`,
      platform: p.platform,
      title: `${PLATFORM_SPECS[p.platform].name}: ${p.author}`,
      draft: p.draft,
      max: POST_COMMENT_MAX[p.platform],
      open: p.state === "found" || p.state === "queued",
      context: facts([
        [`Post by ${p.author}`, `${p.headline ? `${p.headline}\n\n` : ""}${p.text}`],
        ["Why it was picked", p.why],
      ]),
      about: p.text,
      guide: await commentGuide(db, p.platform),
    };
  },
  write: async (db, id, text) => {
    const done = await db
      .update(reachPosts)
      .set({ draft: text })
      .where(and(eq(reachPosts.id, Number(id)), inArray(reachPosts.state, ["found", "queued"])))
      .returning({ id: reachPosts.id });
    if (!done.length) throw new Error(`post ${id} is commented, skipped or dropped`);
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
      title: `${PLATFORM_SPECS[p.platform].name}: ${p.author}`,
      draft: p.draft,
      at: p.queuedAt ?? p.createdAt,
    })),
};

/** A contact who asked us to stop gets no draft. */
const STOPPED: ("opted_out" | "blocked")[] = ["opted_out", "blocked"];
/** An accepted invite nobody wrote to yet: no message either way past the invite. */
const FIRST = sql`${reachContacts.connectedAt} is not null and not exists (select 1 from
  reach_messages m where m.contact_id = ${reachContacts.id} and (m.direction = 'in' or m.kind <> 'connect'))`;

/**
 * Our next DM to a reach contact (`reach_contacts.draft`): a reply on a thread (`dm`) or a first
 * message to an accepted invite (`invite`). Ids are the contact's. A write answers their newest
 * word (`draft_for`), so the watch's model doesn't write over it until they write again.
 */
const reach = (type: "dm" | "invite"): DraftKind => ({
  type,
  read: async (db, id) => {
    if (!/^\d+$/.test(id)) return null;
    const [c] = await db
      .select()
      .from(reachContacts)
      .where(eq(reachContacts.id, Number(id)));
    if (!c) return null;
    return {
      what: `${siteOf(c.platform)} ${type === "dm" ? "direct message" : "first message after they accepted my invite"}`,
      platform: c.platform,
      title: c.name ?? c.handle,
      draft: c.draft,
      max: DRAFT_MAX,
      open: !(STOPPED as string[]).includes(c.state),
      context: (await dmContext(db, c.id)).prompt,
      guide: await dmGuide(db, c.platform),
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
    if (!done.length) throw new Error(`contact ${id} asked us to stop`);
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
      title: `${siteOf(c.platform)}: ${c.name ?? c.handle}`,
      draft: c.draft,
      at: c.draftAt ?? c.createdAt,
    })),
});

/** Each kind by its Inbox prefix. */
export const DRAFT_KINDS: Record<string, DraftKind> = {
  draft: post,
  comment,
  thread,
  dm: reach("dm"),
  invite: reach("invite"),
  onpost,
};

/** "comment:12" as its kind and id; throws on one no kind holds. */
export function itemOf(item: string): { record: string; id: string; kind: DraftKind } {
  const at = item.indexOf(":");
  const record = item.slice(0, at);
  const kind = DRAFT_KINDS[record];
  if (at < 1 || !kind || at === item.length - 1)
    throw new Error(`say a draft as ${Object.keys(DRAFT_KINDS).join(":<id>, ")}:<id>`);
  return { record, id: item.slice(at + 1), kind };
}

/**
 * The draft and what it needs, or a throw that says why not. A comment also gets his past
 * decisions on comments, closest to what it answers: the same few-shot its drafting prompt reads.
 */
export async function readDraft(db: Queryable, item: string) {
  const { kind, id, record } = itemOf(item);
  const got = await kind.read(db, id);
  if (!got) throw new Error(`no ${record} ${id}`);
  const examples =
    got.about !== undefined ? await examplesFor(db, COMMENT_KINDS_LEARNED, got.about) : "";
  return { ...got, edits: await editsFor(db, editRecords(record)), examples };
}

/** Drafts waiting on William, every kind or one, newest first. */
export async function listWaiting(db: Queryable, o: { type?: DraftType; limit?: number } = {}) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 500);
  const kinds = Object.values(DRAFT_KINDS).filter((k) => !o.type || k.type === o.type);
  const all = (await Promise.all(kinds.map((k) => k.waiting(db, limit)))).flat();
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/**
 * The kinds whose edits teach a kind's drafts (content desk, 6): a DM reply and a first message
 * are one kind; the rest are their own. Keyed by the Inbox prefix and by `DraftType`.
 */
const DM_EDITS = ["dm", "invite"] as const;
export const editRecords = (kind: string): readonly string[] =>
  kind === "dm" || kind === "invite" ? DM_EDITS : [kind === "post" ? "draft" : kind];

/** His newest edits of one type (or every type), newest first, for `wren drafts edits`. */
export const listEdits = (db: Queryable, o: { type?: DraftType; limit?: number } = {}) =>
  draftEdits(db, { ...(o.type ? { records: editRecords(o.type) } : {}), limit: o.limit ?? 5 });

/**
 * Write `text` over the draft as one `runs` row that keeps what it replaced: `run` when one is
 * open (an ask), else a new one. `expect`: write only over this text, so a hand edit made
 * meanwhile is never lost.
 */
export async function writeDraft(
  db: Queryable,
  item: string,
  text: string | null,
  o: {
    command: DraftCommand;
    by: string;
    expect?: string | null;
    argv?: object;
    run?: string;
    stats?: object;
    /** Claude's write: what he asked, and what Claude was given. */
    ask?: string;
    llm?: Record<string, unknown>;
  },
) {
  const { kind, record, id } = itemOf(item);
  return atomic(db, async (tx) => {
    const now = await kind.read(tx, id);
    if (!now) throw new Error(`no ${record} ${id}`);
    if (o.expect !== undefined && now.draft !== o.expect)
      throw new Error("the draft changed since; nothing written");
    if (text && text.length > now.max)
      throw new Error(`${text.length} characters, over ${now.max} for a ${now.what}`);
    await kind.write(tx, id, text);
    const run =
      o.run ??
      (await openRun(tx, { command: o.command, argv: { ...o.argv, record, id, by: o.by } })).id;
    await finishRun(tx, run, { ...o.stats, draft: text, before: now.draft });
    // His box emptied is a no; anything else is a new version.
    const cleared = text === null && o.command === "draft-set";
    await recordDraft(tx, {
      item,
      platform: now.platform ?? null,
      event: cleared ? "rejected" : "edited",
      via: o.command === "draft-ask" ? "claude" : "person",
      by: o.by,
      text: cleared ? now.draft : text,
      ask: o.ask ?? null,
      llm: o.llm ?? null,
      meta: o.command === "draft-undo" ? { undo: true } : {},
      runId: run,
    });
    return { run, before: now.draft };
  });
}

/**
 * Put back the text the newest change replaced, when the draft is still what that change wrote.
 * Undo twice and the change is back.
 */
export async function undoDraft(db: Queryable, item: string, by: string) {
  const { record, id } = itemOf(item);
  const last = (await draftTurns(db, record, id)).findLast(
    (t) => t.state === "done" && t.draft !== null,
  );
  if (!last) throw new Error("nothing to undo");
  return writeDraft(db, item, last.before, {
    command: "draft-undo",
    by,
    expect: last.draft,
    argv: { of: last.id },
  });
}

/** The longest draft Ask Claude takes: the desk's system prompt holds 8,000 characters. */
const ASK_DRAFT_MAX = 5000;
const QUESTION_MAX = 4000;
const SYSTEM_MAX = 8000;
export const ASK_MESSAGE_MAX = 2000;

/**
 * The system prompt (kind prompt, system `content`, name `draft-ask`); its words ship as
 * `packages/templates/defaults/prompt/content/draft-ask.prompt`. His edits, then his past
 * decisions on comments, come before the SOP: the cut takes the end, and his own say the most.
 */
export const DRAFT_ASK_REF = { system: "content", name: "draft-ask" } as const;
/** The shipped words, parsed. */
export const draftAskDefault = () =>
  parseKind(
    "prompt",
    DRAFT_ASK_REF.name,
    defaultSource(promptRef(DRAFT_ASK_REF.system, DRAFT_ASK_REF.name)),
  );

/** The desk's question and system prompt for one ask, or why it can't go. `prompt`: the store's. */
export function askPrompt(
  d: DraftItem,
  ask: { by: string; message: string },
  prompt: Pick<LiveTemplate, "template"> = { template: draftAskDefault() },
): { question: string; system: string } | { error: string } {
  if ((d.draft?.length ?? 0) > ASK_DRAFT_MAX)
    return { error: `the draft is over ${ASK_DRAFT_MAX} characters; use wren drafts set` };
  const system = renderPrompt(prompt, {
    what: d.what,
    max: String(d.max),
    draft: d.draft ? `"""\n${d.draft}\n"""` : "(none yet)",
    edits: d.edits || null,
    examples: d.examples || null,
    guide: d.guide || null,
  });
  return {
    question: `${ask.by} asks: ${ask.message}\n\n${d.context}`.slice(0, QUESTION_MAX),
    system: system.slice(0, SYSTEM_MAX),
  };
}
