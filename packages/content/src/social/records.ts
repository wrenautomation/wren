/**
 * Marketing → Inbox (designs/2026-10-06-social-inbox.md): comments, DMs and activity from every
 * platform in one list (`marketing.inbox`), activity alone (`marketing.activity`), and followers
 * per platform (`marketing.audience`).
 */
import { date, defineRecord, link, name, number, prose, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { commentRecord, dmRecord, PLATFORM_LABELS } from "@wren/outreach/records";
import { sql } from "drizzle-orm";
import { PLATFORM_NAMES } from "./store.js";

/** ponytail: rows, not a view: a few hundred unseen rows at most; a view past that. */
const ACTIVITY_ROWS = 500;

const neutral = (label: string) => ({ label, tone: "neutral" as const });

const KIND_LABELS = {
  follow: neutral("Follow"),
  subscribe: neutral("Subscribe"),
  mention: neutral("Mention"),
  reaction: neutral("Reaction"),
  notification: neutral("Notification"),
};

const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Array<Record<string, unknown>>;

export const activityRecord = defineRecord({
  id: "marketing.activity",
  name: { one: "activity", many: "activity" },
  rows: (db) =>
    rowsOf(
      db,
      sql`select id, platform, kind, actor who, actor_url, text, url, at, state
        from social_activity order by at desc limit ${ACTIVITY_ROWS}`,
    ),
  key: "id",
  title: "text",
  subtitle: "who",
  fields: {
    text: text("What"),
    who: name("Who"),
    actorUrl: link("Their page"),
    platform: status(PLATFORM_LABELS, "Site"),
    kind: status(KIND_LABELS, "Kind"),
    state: status({ new: { label: "New", tone: "warn" }, seen: neutral("Seen") }),
    at: date("When"),
    url: link("Open"),
  },
  views: [
    { id: "new", label: "New", where: { state: "new" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["marketing.activitySeen", "marketing.activityAllSeen"],
});

/** What waits on William in the Inbox: unread, unsorted or waiting. */
export const INBOX_WAITING = { state: ["new", "waiting"] } as const;

/**
 * Comments, DM threads and activity as one list, newest first. Ids carry their type
 * (`comment:12`, `dm:5`, `activity:9`); each action reads the number after the colon.
 */
export const inboxRecord = defineRecord({
  id: "marketing.inbox",
  name: { one: "inbox item", many: "inbox items" },
  rows: async (db) => {
    const cs = (await commentRecord.rows?.(db)) ?? [];
    const ds = (await dmRecord.rows?.(db)) ?? [];
    const as = (await activityRecord.rows?.(db)) ?? [];
    return [
      ...cs.map((c) => ({
        id: `comment:${c.id}`,
        type: "comment",
        who: c.who,
        platform: c.platform,
        kind: c.kind,
        channel: c.channel,
        state: c.state,
        body: c.body,
        post_title: c.post_title,
        draft: c.draft,
        account: c.account,
        at: c.at,
        url: c.url,
      })),
      ...ds.map((d) => ({
        id: `dm:${d.id}`,
        type: "dm",
        who: d.who,
        platform: d.platform,
        kind: "dm",
        channel: "reach",
        state: d.waiting === "waiting" ? "waiting" : "read",
        body: d.last_body,
        post_title: null,
        draft: null,
        account: d.account,
        at: d.last_at,
        url: null,
      })),
      ...as.map((a) => ({
        id: `activity:${a.id}`,
        type: "activity",
        who: a.who,
        platform: a.platform,
        kind: a.kind,
        channel: null,
        state: a.state,
        body: a.text,
        post_title: null,
        draft: null,
        account: null,
        at: a.at,
        url: a.url,
      })),
    ];
  },
  key: "id",
  title: "who",
  subtitle: "body",
  fields: {
    who: name("Who"),
    type: status(
      { comment: neutral("Comment"), dm: neutral("DM"), activity: neutral("Activity") },
      "Type",
    ),
    platform: status(PLATFORM_LABELS, "Site"),
    kind: status(
      {
        post_reply: neutral("On our post"),
        comment_reply: neutral("Under our comment"),
        username_mention: neutral("Mention"),
        dm: neutral("DM"),
        ...KIND_LABELS,
      },
      "Kind",
    ),
    channel: status({ reach: neutral("Reach account"), content: neutral("Our post") }, "Where"),
    state: status({
      new: { label: "New", tone: "warn" },
      waiting: { label: "Waiting on you", tone: "warn" },
      answered: { label: "Answered", tone: "good" },
      dropped: neutral("Dropped"),
      read: neutral("Read"),
      seen: neutral("Seen"),
    }),
    body: prose("Their words"),
    postTitle: text("Post"),
    draft: prose("Draft answer"),
    account: text("On"),
    at: date("When"),
    url: link("Open"),
  },
  views: [
    { id: "comments", label: "Comments", where: { type: "comment" }, sort: "-at", at: "at" },
    { id: "dms", label: "DMs", where: { type: "dm" }, sort: "-at", at: "at" },
    { id: "activity", label: "Activity", where: { type: "activity" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: [
    "marketing.commentAnswer",
    "marketing.commentDm",
    "marketing.commentDrop",
    "marketing.dmReply",
    "marketing.dmRead",
    "marketing.activitySeen",
    "marketing.activityAllSeen",
  ],
  /** A DM thread's messages; nothing past the row for the rest. */
  load: async (db, id) =>
    id.startsWith("dm:") ? ((await dmRecord.load?.(db, id.slice(3))) ?? null) : null,
});

/** Followers per platform: the newest day kept, and the change from a week before it. */
export const audienceRecord = defineRecord({
  id: "marketing.audience",
  name: { one: "platform", many: "platforms" },
  rows: async (db) =>
    (
      await rowsOf(
        db,
        sql`select distinct on (d.platform) d.platform id, d.platform, d.followers, d.day,
          d.followers - (select w.followers from social_days w
            where w.platform = d.platform and w.day <= d.day - 7 order by w.day desc limit 1) week
        from social_days d order by d.platform, d.day desc`,
      )
    ).map((r) => ({ ...r, site: PLATFORM_NAMES[r.platform as keyof typeof PLATFORM_NAMES] })),
  key: "id",
  title: "site",
  fields: {
    site: name("Platform"),
    followers: number("Followers"),
    week: number("Change in 7 days"),
    day: date("As of"),
  },
  views: [{ id: "all", label: "All", sort: "-followers", at: "day" }],
  actions: ["marketing.audienceRead"],
});

export const SOCIAL_RECORDS = [inboxRecord, activityRecord, audienceRecord];
