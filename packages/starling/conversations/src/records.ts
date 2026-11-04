/**
 * The turn stores as console records for the Marketing app (designs/2026-11-02-starling.md, R2):
 * each person's DM thread (`marketing.dm`) and each comment on our posts (`marketing.comment`).
 * Factories: the channel that owns the accounts passes its `TurnDeps`; outbound exports the
 * instances until the worker composes them (R3).
 */

import { draftTurns } from "@wren/core/ask";
import { draftItemsOf, recordOfPage } from "@wren/core/draft-record";
import {
  accountField,
  cued,
  date,
  defineRecord,
  link,
  name,
  prose,
  type RecordFold,
  status,
  text,
} from "@wren/core/records";
import {
  accountById,
  accountPickFor,
  pickedAccounts,
  pickedReachAccount,
} from "@wren/starling-acts";
import { PLATFORM_CUES } from "@wren/starling-core/platform-cues";
import { sql } from "drizzle-orm";
import type { TurnDeps } from "./deps.js";
import { type DmPlatform, MESSAGE_MAX } from "./schema.js";
import { threadContextOf } from "./thread-context.js";
import { getThread, listThreads } from "./threads.js";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

/** ponytail: rows, not a view: reach holds a few hundred threads at most; a view past that. */
export const THREAD_ROWS = 500;
export const SITES: Record<DmPlatform, string> = {
  reddit: "Reddit",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};

const COMMENT_KIND_LABELS = {
  post_reply: neutral("On our post"),
  comment_reply: neutral("Under our comment"),
  thread_reply: neutral("Follow-up in the thread"),
  username_mention: neutral("Mention"),
};

/**
 * One person's comments in one thread show as one row (designs/2026-10-15-engage-threads.md):
 * their latest unanswered one stands for the group, every message rides along newest first.
 * Declared once; every comment list (Comments, Engage, Inbox) folds with it.
 */
export const COMMENT_FOLD: RecordFold = {
  by: (r) =>
    (r.type === undefined || r.type === "comment") && r.post && r.who
      ? `${r.platform}|${r.channel}|${r.post}|${String(r.who).toLowerCase()}`
      : null,
  at: "at",
  open: (r) => r.state === "new" || r.state === "waiting",
  text: "body",
  state: "state",
  due: "due",
  into: "messages",
};

/**
 * What a DM thread waits on (designs/2026-10-16-outreach-app.md): their unread reply, else a
 * draft of ours not sent, else nothing once ours is the last word.
 */
export function turnOf(
  unread: boolean,
  draft: string | null | undefined,
  last: string | null,
): "reply" | "draft" | "sent" | null {
  if (unread) return "reply";
  if (draft?.trim()) return "draft";
  return last === "out" ? "sent" : null;
}

/** The DM record for one channel: `deps.kinds` picks accounts, `deps.about` names a Reddit contact. */
export const dmRecordOf = (deps: Pick<TurnDeps, "kinds" | "about">) =>
  defineRecord({
    id: "marketing.dm",
    app: "inbox",
    channel: { field: "platform" },
    name: { one: "DM thread", many: "DM threads" },
    rows: async (db) => {
      // An invite alone is no DM thread: Invites holds it. A thread shows once a DM went either
      // way, or a draft of ours waits to go.
      const threads = (await listThreads(db, { limit: THREAD_ROWS })).filter(
        (t) => t.dms > 0 || Boolean(t.contact.draft?.trim()),
      );
      const reddit = threads.flatMap((t) =>
        t.contact.platform === "reddit" ? [t.contact.handle.toLowerCase()] : [],
      );
      // A Reddit contact has no headline; who they are comes from the channel's read of them.
      const about = reddit.length ? await deps.about(db, "reddit", reddit) : new Map();
      // A reply picked to go out as another account shows as that one.
      const picks = await pickedAccounts(
        db,
        threads.map((t) => `dm:${t.contact.id}`),
      );
      return threads.map((t) => ({
        id: t.contact.id,
        who: t.contact.name ?? t.contact.handle,
        headline: t.contact.headline ?? about.get(t.contact.handle.toLowerCase()) ?? null,
        platform: t.contact.platform,
        account: picks.get(`dm:${t.contact.id}`) ?? t.account,
        state: t.contact.state,
        last_body: t.last?.body ?? null,
        last_at: t.last?.sentAt ?? t.last?.createdAt ?? null,
        direction: t.last?.direction ?? null,
        waiting: t.unread ? "waiting" : "read",
        // An invite alone is no DM sent: Invites holds it.
        turn: turnOf(
          t.unread,
          t.contact.draft,
          t.last?.kind === "connect" ? null : (t.last?.direction ?? null),
        ),
        draft: t.contact.draft,
      }));
    },
    key: "id",
    title: "who",
    account: "account",
    subtitle: "headline",
    fields: {
      who: name("Who"),
      headline: text(),
      platform: status(
        cued({
          reddit: neutral("Reddit"),
          linkedin: neutral("LinkedIn"),
          facebook: neutral("Facebook"),
          instagram: neutral("Instagram"),
          x: neutral("X"),
        }),
        "Site",
      ),
      account: accountField("From"),
      state: status({
        new: neutral("Found"),
        enrolled: neutral("Messaging"),
        connected: { label: "Connected", tone: "good" },
        replied: { label: "Replied", tone: "good" },
        finished: neutral("Finished"),
        unreachable: { label: "Unreachable", tone: "bad" },
        opted_out: { label: "Opted out", tone: "warn" },
        blocked: { label: "Blocked", tone: "bad" },
      }),
      direction: status(
        { in: { label: "Their turn", tone: "warn" }, out: neutral("Ours sent") },
        "Last",
      ),
      lastBody: text("Last message"),
      lastAt: date("When"),
      waiting: status(
        { waiting: { label: "Unread", tone: "warn" }, read: neutral("Read") },
        "Read",
      ),
      turn: status(
        {
          reply: { label: "To answer", tone: "warn" },
          draft: { label: "Draft to send", tone: "warn" },
          sent: neutral("Sent"),
        },
        "To do",
      ),
      draft: prose("Draft reply"),
    },
    views: [
      {
        id: "todo",
        label: "To do",
        where: { turn: ["reply", "draft"] },
        sort: "-lastAt",
        at: "lastAt",
      },
      { id: "sent", label: "Sent", where: { turn: "sent" }, sort: "-lastAt", at: "lastAt" },
      {
        id: "waiting",
        label: "Unread",
        where: { waiting: "waiting" },
        sort: "-lastAt",
        at: "lastAt",
      },
      {
        id: "replied",
        label: "Replied",
        where: { state: "replied" },
        sort: "-lastAt",
        at: "lastAt",
      },
      { id: "all", label: "All", sort: "-lastAt", at: "lastAt" },
    ],
    activity: { view: "draft_activity", by: "contact", seq: "seq" },
    drafts: (id) => draftItemsOf("dm", id),
    actions: [
      "marketing.dmReply",
      "marketing.dmRead",
      "marketing.dmCancel",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
    ],
    /** The thread oldest first, and the preview's app, sender and cap for a reply. */
    load: async (db, id) => {
      const t = await getThread(db, Number(id));
      // The preview's sender: the account picked for the reply, else the thread's.
      const picked = await pickedReachAccount(db, `dm:${id}`).catch(() => null);
      const from = picked
        ? (picked.handle ?? null)
        : t.contact.accountId
          ? ((await accountById(db, t.contact.accountId)).handle ?? null)
          : null;
      return {
        messages: t.messages.map((m) => ({
          id: m.id,
          at: (m.sentAt ?? m.createdAt).toISOString(),
          direction: m.direction,
          kind: m.kind,
          subject: m.subject,
          body: m.body,
          state: m.state,
        })),
        dm: { site: SITES[t.contact.platform], from, max: MESSAGE_MAX },
        accounts: await accountPickFor(db, `dm:${id}`, deps.kinds),
        ask: await draftTurns(db, "dm", id),
        record: await recordOfPage(db, "dm", id),
      };
    },
  });

/**
 * Comments on our posts and under our comments, every platform, newest first: a reach account's
 * inbox (the account that read it) or our own post (`content`, answered by `Content.reply`).
 */
export const commentRecordOf = (deps: Pick<TurnDeps, "kinds" | "about">) =>
  defineRecord({
    id: "marketing.comment",
    app: "inbox",
    channel: { field: "platform" },
    name: { one: "comment", many: "comments" },
    rows: async (db) => {
      const rows = (await db.execute(sql`
      select c.id, c.author,
        -- Their name; a LinkedIn profile link read before names were kept shows as its slug.
        coalesce(nullif(c.raw->>'authorName', ''),
          substring(c.author from '^https?://(?:www\\.)?linkedin\\.com/in/([^/?#]+)'), c.author) who,
        c.platform, c.channel, c.kind, c.place, c.post, c.post_title, c.body,
        c.sort, c.why, c.draft, c.state, c.answer, c.at, c.answered_at, c.url,
        coalesce(da.account, a.account) account,
        c.contact_id,
        -- The way into their DMs (dmDoorOf): the button shows only where there is one.
        case when c.account_id is not null then 'reach'
          when c.platform in ('instagram', 'facebook') then 'private_reply' end door
      from comments c left join reach_accounts a on a.id = c.account_id
      left join draft_accounts da on da.item = 'comment:' || c.id
      order by c.at desc limit ${THREAD_ROWS}`)) as unknown as Array<
        Record<string, unknown> & { author: string; platform: string }
      >;
      // Who a Reddit commenter is, from the channel's read of them.
      const reddit = rows.flatMap((r) => (r.platform === "reddit" ? [r.author.toLowerCase()] : []));
      const about = reddit.length ? await deps.about(db, "reddit", reddit) : new Map();
      return rows.map(({ author, ...r }) => ({
        ...r,
        about: r.platform === "reddit" ? (about.get(author.toLowerCase()) ?? null) : null,
      }));
    },
    key: "id",
    title: "who",
    account: "account",
    subtitle: "body",
    fold: COMMENT_FOLD,
    fields: {
      who: name("Who"),
      about: text("Who they are"),
      platform: status(PLATFORM_CUES, "Site"),
      channel: status(
        cued({ reach: neutral("Reach account"), content: neutral("Our post") }),
        "Where",
      ),
      kind: status(cued(COMMENT_KIND_LABELS), "Kind"),
      door: status(
        {
          reach: neutral("From the reach account"),
          private_reply: neutral("Reply to the comment"),
        },
        "DM door",
      ),
      place: text("Place"),
      postTitle: text("Post"),
      body: prose("Their words"),
      messages: text("Their messages", { listed: false }),
      sort: status(
        {
          asked: { label: "Asked", tone: "good" },
          question: { label: "Question", tone: "warn" },
          chat: neutral("Chat"),
          hostile: { label: "Hostile", tone: "bad" },
          ours: neutral("Ours"),
          noise: neutral("Noise"),
        },
        "Read as",
      ),
      why: text("Why"),
      draft: prose("Draft answer"),
      state: status({
        new: neutral("Unread"),
        waiting: { label: "Waiting on you", tone: "warn" },
        answered: { label: "Answered", tone: "good" },
        dropped: neutral("Dropped"),
      }),
      answer: prose("Our answer"),
      // Our own post's comments have none: the content channel answers them.
      account: accountField("On"),
      at: date("When"),
      url: link("Open"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: { state: ["new", "waiting"] },
        sort: "-at",
        at: "at",
      },
      { id: "answered", label: "Answered", where: { state: "answered" }, sort: "-at", at: "at" },
      // Dropped in words before any model: here to check the filter never eats a real one.
      { id: "noise", label: "Filtered", where: { sort: "noise" }, sort: "-at", at: "at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    activity: { view: "draft_activity", by: "comment", seq: "seq" },
    drafts: (id) => [`comment:${id}`],
    actions: [
      "marketing.commentAnswer",
      "marketing.threadReply",
      "marketing.threadRead",
      "marketing.commentDm",
      "marketing.commentDrop",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
    ],
    /** Ask Claude's thread on the draft answer. */
    load: async (db, id) => ({
      accounts: await accountPickFor(db, `comment:${id}`, deps.kinds),
      ask: await draftTurns(db, "comment", id),
      record: await recordOfPage(db, "comment", id),
      context: await threadContextOf(db, Number(id)),
    }),
  });
