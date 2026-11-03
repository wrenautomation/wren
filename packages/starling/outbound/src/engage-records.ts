/**
 * Outreach → Engage and Marketing → Feed's Explore (designs/2026-10-16-outreach-app.md): what we
 * write on others' ground, and what the searches found that nobody picked yet. Both read reach
 * tables only, so they are outbound's; the app composes Engage with the desk's kinds and
 * inbound's own post (the head of a comment thread's context).
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
  number,
  prose,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import {
  accountPickFor,
  ITEM_STATES,
  type ItemKinds,
  notParked,
  PICK_FIELD,
  type ConsoleRow as Row,
  unsureSends,
} from "@wren/starling-acts";
import { threadContextOf } from "@wren/starling-conversations";
import { conversationOf, typed } from "@wren/starling-conversations/inbox";
import { COMMENT_FOLD } from "@wren/starling-conversations/records";
import type { MediaHost } from "@wren/starling-core";
import { PLATFORM_CUES } from "@wren/starling-core/platform-cues";
import { sql } from "drizzle-orm";
import { reachEngageItems } from "./reach-items.js";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

/** What waits on William: unread, unsorted or waiting. */
const WAITING = { state: ["new", "waiting"] } as const;

export const PROOF_CUES = {
  live: { label: "Live", tone: "good", about: "Someone signed out sees it" },
  hidden: {
    label: "Hidden",
    tone: "warn",
    about: "We see it, strangers don't: a filter or a mod holds it",
  },
  missing: { label: "Missing", tone: "bad", about: "Gone even for us: removed or deleted" },
  pending: { label: "Checking", tone: "neutral", about: "Not read yet, or the read said nothing" },
} as const;

/** Our own post as the head of a comment thread's context. */
type OurPost = NonNullable<Parameters<typeof threadContextOf>[2]>;

export interface EngageDeps {
  /** Every kind a draft box shows: the account picked for an item. */
  kinds: ItemKinds;
  /** Our own post's words and picture, for a comment on it; none = the thread's snapshot only. */
  ourPost?: (db: Queryable) => OurPost;
  /** Signs a proof's screenshot; none = no shot link. */
  host?: MediaHost;
}

/**
 * Reddit threads and others' posts with our comment drafted (as To approve has them), and what
 * went out, with its proof: those comments and our answers under comments. Comments waiting on
 * us stay in Marketing → Comments and the Inbox; DMs are Outreach → DMs. Each row keeps its own
 * page's actions; links he pastes land here too (`ReachDesk.paste`).
 */
export const engageRecordOf = (deps: EngageDeps) =>
  defineRecord({
    id: "marketing.engage",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "reply", many: "replies" },
    rows: async (db) => {
      // A send that may have gone out waits in To approve, not here.
      const parked = notParked(await unsureSends(db));
      return (await reachEngageItems(db, deps.host)).filter(parked);
    },
    key: "id",
    title: "who",
    account: "account",
    subtitle: "body",
    fold: COMMENT_FOLD,
    fields: {
      who: name("Who"),
      messages: text("Their messages", { listed: false }),
      type: status(
        cued({
          thread: neutral("Reddit thread"),
          onpost: neutral("Their post"),
          comment: neutral("On our post"),
        }),
        "Type",
      ),
      platform: status(PLATFORM_CUES, "Site"),
      state: ITEM_STATES,
      body: prose("Their words"),
      postTitle: text("Post"),
      place: text("Where"),
      why: text("Picked for"),
      held: text("Held because"),
      draft: prose("Our draft"),
      pick: PICK_FIELD(),
      account: accountField("On"),
      at: date("When"),
      due: date("Due"),
      sendAt: date("Sends"),
      sent: date("Sent"),
      proof: status(PROOF_CUES, "Proof"),
      proofNote: text("Proof note"),
      proofAt: date("Checked"),
      proofUrl: link("Permalink", { listed: false }),
      proofShot: link("Screenshot", { listed: false }),
      url: link("Open"),
    },
    views: [
      {
        id: "waiting",
        label: "To do",
        where: WAITING,
        sort: "due",
        at: "due",
        hint: "Comments drafted for your yes, most overdue first",
      },
      {
        id: "scheduled",
        label: "Scheduled",
        where: { state: "scheduled" },
        sort: "due",
        at: "due",
        hint: "Approved and set to send, soonest first",
      },
      // Behind a subreddit's karma or age rule: queued, each with the rule it waits on.
      {
        id: "held",
        label: "Held",
        where: { state: "held" },
        sort: "due",
        at: "due",
        hint: "Comments waiting on a subreddit's karma or account-age rule; each sends itself once we meet it",
      },
      // What went out, and whether a stranger sees it (designs/2026-10-14-comment-proof.md).
      {
        id: "posted",
        label: "Posted",
        where: { state: ["sent", "answered"] },
        sort: "-sent",
        at: "sent",
        hint: "Comments and replies we sent, newest first, each with whether a stranger sees it",
      },
      {
        id: "notlive",
        label: "Not live",
        where: { proof: ["hidden", "missing"] },
        sort: "-sent",
        at: "sent",
        hint: "Sent comments a stranger can't see: hidden by a filter or a mod, or gone",
      },
      {
        id: "threads",
        label: "Reddit",
        where: { type: "thread", state: ["waiting", "scheduled", "held"] },
        sort: "-at",
        at: "at",
        hint: "Reddit threads we found and drafted a comment for, newest first",
      },
      {
        id: "posts",
        label: "Their posts",
        where: { type: "onpost", state: ["waiting", "scheduled"] },
        sort: "due",
        at: "due",
        hint: "Other people's posts we drafted a comment on, due soonest first",
      },
      { id: "all", label: "All", sort: "-at", at: "at", hint: "Every item above, newest first" },
    ],
    activity: { view: "draft_activity", by: "item", seq: "seq" },
    drafts: (id) => draftItemsOf(id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)),
    actions: [
      "marketing.threadComment",
      "marketing.threadSkip",
      "marketing.onpostComment",
      "marketing.onpostLike",
      "marketing.onpostFollow",
      "marketing.onpostSkip",
      "marketing.messageFrom",
      "marketing.pass",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
    ],
    /** A thread's or post's Ask Claude thread; an answered comment with its conversation and context. */
    load: async (db, id) => {
      const [type, rest] = typed(id);
      const ask = {
        ask: await draftTurns(db, type, rest),
        record: await recordOfPage(db, type, rest),
        accounts: await accountPickFor(db, id, deps.kinds),
      };
      if (type !== "comment") return ask;
      return {
        ...ask,
        conversation: await conversationOf(db, id),
        // The post and every reply under it, nested (designs/2026-10-15-engage-threads.md).
        context: await threadContextOf(db, Number(rest), deps.ourPost?.(db)),
      };
    },
  });

const EXPLORE_ROWS = 150;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

/** Found posts (last 7 days) and ranked Reddit threads (last 3), best fit first: Explore's rows. */
const exploreRows = async (db: Queryable, id?: string) => {
  const [type, key] = id ? typed(id) : [null, null];
  const posts =
    type === null || type === "onpost"
      ? await rowsOf(
          db,
          sql`select id, platform, author, text, why, fit, url, coalesce(posted_at, created_at) at
            from reach_posts where state = 'found'
              and ${key === null ? sql`created_at > now() - interval '7 days'` : sql`id = ${Number(key)}`}
            order by fit desc nulls last, id desc limit ${EXPLORE_ROWS}`,
        )
      : [];
  const threads =
    type === null || type === "thread"
      ? await rowsOf(
          db,
          sql`select id, subreddit, author, title, body, angle, fit, url, posted_at
            from reddit_threads where state = 'ranked'
              and ${key === null ? sql`posted_at > now() - interval '3 days'` : sql`id = ${key}`}
            order by fit desc nulls last, posted_at desc limit ${EXPLORE_ROWS}`,
        )
      : [];
  return [
    ...posts.map((p) => ({
      id: `onpost:${p.id}`,
      type: "onpost",
      who: p.author,
      platform: p.platform,
      where: null,
      body: p.text,
      why: p.why,
      fit: p.fit,
      at: p.at,
      url: p.url,
    })),
    ...threads.map((t) => ({
      id: `thread:${t.id}`,
      type: "thread",
      who: t.author,
      platform: "reddit",
      where: `r/${t.subreddit}`,
      body: t.body ? `${t.title}\n\n${t.body}` : t.title,
      why: t.angle,
      fit: t.fit,
      at: t.posted_at,
      url: t.url,
    })),
  ];
};

/**
 * Marketing → Feed's Explore: what the topic searches and subreddit reads found that no one
 * follows or picked yet. Reply drafts on it now, Follow follows its author (a thread: its
 * subreddit), Skip keeps it out (`ReachDesk.pick`, `skipPost`, `skipThread`).
 */
export const exploreRecord = defineRecord({
  id: "marketing.explore",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "find", many: "finds" },
  rows: (db) => exploreRows(db),
  key: "id",
  title: "who",
  subtitle: "body",
  fields: {
    who: name("Who"),
    type: status(cued({ thread: neutral("Reddit thread"), onpost: neutral("Post") }), "Type"),
    platform: status(PLATFORM_CUES, "Site"),
    where: text("Where"),
    body: prose("Their words"),
    why: text("Found for"),
    fit: number("Fit"),
    at: date("When"),
    url: link("Open"),
  },
  views: [
    { id: "best", label: "Best fit", sort: "-fit", at: "at" },
    { id: "posts", label: "Posts", where: { type: "onpost" }, sort: "-fit", at: "at" },
    { id: "reddit", label: "Reddit", where: { type: "thread" }, sort: "-fit", at: "at" },
    { id: "new", label: "Newest", sort: "-at", at: "at" },
  ],
  actions: [
    "marketing.exploreReply",
    "marketing.exploreFollow",
    "marketing.onpostSkip",
    "marketing.threadSkip",
    "marketing.pass",
  ],
  load: async (db, id) => (await exploreRows(db, id))[0] ?? null,
});
