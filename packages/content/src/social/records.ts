/**
 * Marketing → Inbox and the Inbox app's "Waiting on you" (designs/2026-10-06-social-inbox.md,
 * 2026-10-06-content-desk.md): everything waiting on William's click in one list
 * (`marketing.inbox`): post drafts, comments, DMs, Reddit threads to answer, accepted invites,
 * email replies, text threads and activity. Activity alone (`marketing.activity`), and
 * followers per platform (`marketing.audience`).
 */

import { threadRecord as textThreadRecord } from "@wren/channel-sms/records";
import { draftTurns } from "@wren/core/ask";
import { date, defineRecord, link, name, number, prose, status, text } from "@wren/core/records";
import { refText, waitingAsks } from "@wren/core/templates";
import { approvalId, templateAt } from "@wren/core/templates/console";
import { installApprovalId, waitingInstalls } from "@wren/core/templates/install";
import type { Queryable } from "@wren/db";
import { commentRecord, dmRecord, PLATFORM_LABELS, threadRecord } from "@wren/outreach/records";
import { sql } from "drizzle-orm";
import { DRAFT_CALLS } from "../draft-calls.js";
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
  app: "marketing",
  channel: { field: "platform" },
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

/** What waits on William in the Inbox and To approve: unread, unsorted or waiting. */
export const INBOX_WAITING = { state: ["new", "waiting"] } as const;

/** An email reply's state, in the Inbox's words: its call invite's, when it has one. */
const INVITE: Record<string, string> = {
  needs_you: "waiting",
  proposed: "waiting",
  booking: "answered",
  booked: "answered",
  already_booked: "answered",
  sent: "answered",
  dropped: "left",
};
/** With no invite, its disposition's; unread or a question for a person waits on him. */
const DISPOSITION: Record<string, string> = {
  interested: "waiting",
  referral: "waiting",
  other: "waiting",
  meeting_booked: "answered",
  not_interested: "left",
  not_now: "left",
  wrong_person: "left",
};

/** Every human email reply, with its call invite when it has one. */
const emailRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select te.id, ci.id invite, ci.state invite_state, te.disposition, m.body draft,
        coalesce(nullif(concat_ws(' ', p.first_name, p.last_name), ''), p.full_name,
          te.from_address) who,
        co.name company, coalesce(te.received_at, te.created_at) at,
        coalesce(te.body_text, te.snippet) words
      from thread_events te
      left join call_invites ci on ci.thread_event_id = te.id
      left join messages m on m.id = ci.reply_message_id
      left join enrollments e on e.id = te.enrollment_id
      left join people p on p.id = e.person_id
      left join companies co on co.id = e.company_id
      where te.kind = 'reply'
      order by at desc limit ${ACTIVITY_ROWS}`,
  );

/** Text threads they wrote in: their last word, and whether ours came after or it's unread. */
const textRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.e164) who, i.body words, i.at,
        exists (select 1 from sms_messages o where o.contact_id = c.id and o.direction = 'out'
          and o.state <> 'skipped' and o.created_at > i.at) answered,
        (c.read_at is null or c.read_at < i.at) unread
      from sms_contacts c
      join lateral (select body, received_at at from sms_messages
        where contact_id = c.id and direction = 'in'
        order by received_at desc limit 1) i on true
      order by i.at desc limit ${ACTIVITY_ROWS}`,
  );

/** Post drafts waiting on a yes, with the slot each holds. */
const draftRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select id, platform, title, text, scheduled, created from marketing_draft_records
      where state = 'draft' order by created desc limit ${ACTIVITY_ROWS}`,
  );

/** Rendered videos waiting on his Approve (Marketing → Videos). */
const videoRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select id, title, description, updated_at at from video_edits
      where state = 'rendered' order by updated_at desc limit ${ACTIVITY_ROWS}`,
  );

/** Accepted invites nobody wrote to yet: no message either way past the invite. */
const acceptedRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.handle) who, c.headline, c.connected_at at, c.draft, c.url,
        a.handle account, (c.read_at is null or c.read_at < c.connected_at) unread
      from reach_contacts c left join reach_accounts a on a.id = c.account_id
      where c.connected_at is not null and c.state not in ('opted_out', 'blocked')
        and not exists (select 1 from reach_messages m where m.contact_id = c.id
          and (m.direction = 'in' or m.kind <> 'connect'))
      order by c.connected_at desc limit ${ACTIVITY_ROWS}`,
  );

/** A row's state, as both lists say it. */
const STATES = status({
  new: { label: "New", tone: "warn" },
  waiting: { label: "Waiting on you", tone: "warn" },
  answered: { label: "Answered", tone: "good" },
  dropped: neutral("Dropped"),
  read: neutral("Read"),
  seen: neutral("Seen"),
  left: neutral("Left"),
});

/** Splits a typed id (`dm:5`) into its type and the row's own id. */
const typed = (id: string) => {
  const at = id.indexOf(":");
  return [id.slice(0, at), id.slice(at + 1)] as const;
};

/**
 * What other people sent us, as one list. Ids carry their type (`comment:12`, `dm:5`, `email:4`
 * (a call invite), `reply:6` (a reply with none), `text:8`, `activity:9`); each action reads the
 * id after the colon. `due` orders "Waiting on you": when it came.
 */
export const inboxRecord = defineRecord({
  id: "marketing.inbox",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "inbox item", many: "inbox items" },
  rows: async (db) => {
    const cs = (await commentRecord.rows?.(db)) ?? [];
    const ds = (await dmRecord.rows?.(db)) ?? [];
    const es = await emailRows(db);
    const xs = await textRows(db);
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
        due: c.at,
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
        draft: d.draft,
        account: d.account,
        at: d.last_at,
        due: d.last_at,
        url: null,
      })),
      // A reply with a call invite is answered here or on its replies page, by the invite's id;
      // one with no invite has nothing to answer with and shows unlinked.
      ...es.map((e) => ({
        id: e.invite ? `email:${e.invite}` : `reply:${e.id}`,
        type: "email",
        who: e.who,
        company: e.company,
        platform: null,
        kind: "email",
        channel: null,
        state: e.invite
          ? (INVITE[String(e.invite_state)] ?? "left")
          : (DISPOSITION[String(e.disposition)] ?? "waiting"),
        answer: e.invite_state,
        body: e.words,
        post_title: null,
        draft: e.draft,
        account: null,
        at: e.at,
        due: e.at,
        url: e.invite ? `/inbox/replies/${e.invite}` : null,
      })),
      // Theirs is the last word and nobody read it: waiting. Ours came after: answered.
      ...xs.map((x) => ({
        id: `text:${x.id}`,
        type: "text",
        who: x.who,
        platform: null,
        kind: "text",
        channel: null,
        state: x.answered ? "answered" : x.unread ? "waiting" : "read",
        body: x.words,
        post_title: null,
        draft: null,
        account: null,
        at: x.at,
        due: x.at,
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
        due: a.at,
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
      {
        comment: neutral("Comment"),
        dm: neutral("DM"),
        email: neutral("Email"),
        text: neutral("Text"),
        activity: neutral("Activity"),
      },
      "Type",
    ),
    platform: status(PLATFORM_LABELS, "Site"),
    kind: status(
      {
        post_reply: neutral("On our post"),
        comment_reply: neutral("Under our comment"),
        username_mention: neutral("Mention"),
        dm: neutral("DM"),
        email: neutral("Email reply"),
        text: neutral("Text"),
        ...KIND_LABELS,
      },
      "Kind",
    ),
    channel: status({ reach: neutral("Reach account"), content: neutral("Our post") }, "Where"),
    state: STATES,
    company: text("Company"),
    answer: status(
      {
        needs_you: { label: "Needs you", tone: "bad" },
        proposed: { label: "Draft ready", tone: "warn" },
        booking: neutral("Booking"),
        booked: { label: "Booked", tone: "good" },
        already_booked: { label: "Already booked", tone: "good" },
        sent: { label: "Answered", tone: "good" },
        dropped: neutral("Dropped"),
      },
      "Call invite",
    ),
    body: prose("Their words"),
    postTitle: text("Post"),
    draft: prose("Draft reply"),
    account: text("On"),
    at: date("When"),
    due: date("Due"),
    url: link("Open"),
  },
  views: [
    { id: "waiting", label: "Waiting on you", where: INBOX_WAITING, sort: "due", at: "due" },
    { id: "comments", label: "Comments", where: { type: "comment" }, sort: "-at", at: "at" },
    { id: "dms", label: "DMs", where: { type: "dm" }, sort: "-at", at: "at" },
    { id: "email", label: "Email", where: { type: "email" }, sort: "-at", at: "at" },
    { id: "texts", label: "Texts", where: { type: "text" }, sort: "-at", at: "at" },
    { id: "activity", label: "Activity", where: { type: "activity" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: [
    "marketing.commentAnswer",
    "marketing.commentDm",
    "marketing.commentDrop",
    "marketing.dmReply",
    "marketing.dmRead",
    "marketing.markRead",
    "email.approve",
    "email.drop",
    "marketing.activitySeen",
    "marketing.activityAllSeen",
    "marketing.draftSet",
    "marketing.draftAsk",
    "marketing.draftUndo",
  ],
  /** A DM thread's or a text thread's messages; a draft's Ask Claude thread. */
  load: async (db, id) => {
    const [type, rest] = typed(id);
    if (type === "text") return (await textThreadRecord.load?.(db, rest)) ?? null;
    // An email's words and our drafted answer are the row's own.
    if (["activity", "email", "reply"].includes(type)) return null;
    const ask = { ask: await draftTurns(db, type, rest) };
    return type === "dm" ? { ...(await dmRecord.load?.(db, rest)), ...ask } : ask;
  },
});

/**
 * What we'd send, waiting on William's yes, as one list. Ids carry their type (`draft:3`,
 * `video:2` (rendered, waiting on Approve), `thread:abc`, `invite:7`, `template:4:3` (version 3
 * asked to go live)); each action reads the id after the colon. `due` orders "Waiting on you": a
 * draft's slot, else when it came.
 */
export const approvalRecord = defineRecord({
  id: "marketing.approval",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "item to approve", many: "items to approve" },
  rows: async (db) => {
    const ps = await draftRows(db);
    const vs = await videoRows(db);
    const ts = ((await threadRecord.rows?.(db)) ?? []).filter((t) => t.state === "queued");
    const is = await acceptedRows(db);
    const asks = await waitingAsks(db);
    const ws = await waitingInstalls(db);
    return [
      ...ps.map((p) => ({
        id: `draft:${p.id}`,
        type: "draft",
        who: p.title,
        platform: p.platform,
        kind: "post",
        state: "waiting",
        body: p.text,
        post_title: null,
        draft: null,
        account: null,
        at: p.created,
        due: p.scheduled ?? p.created,
        url: null,
      })),
      ...vs.map((v) => ({
        id: `video:${v.id}`,
        type: "video",
        who: v.title || `Video ${v.id}`,
        platform: "youtube",
        kind: "video",
        state: "waiting",
        body: v.description,
        post_title: null,
        draft: null,
        account: null,
        at: v.at,
        due: v.at,
        url: `/marketing/videos/${v.id}`,
      })),
      ...ts.map((t) => ({
        id: `thread:${t.id}`,
        type: "thread",
        who: t.author,
        platform: "reddit",
        kind: "thread",
        state: "waiting",
        body: t.body || t.title,
        post_title: t.title,
        draft: t.draft,
        account: t.account,
        at: t.posted_at,
        due: t.posted_at,
        url: t.url,
      })),
      ...is.map((i) => ({
        id: `invite:${i.id}`,
        type: "invite",
        who: i.who,
        platform: "linkedin",
        kind: "invite",
        state: i.unread ? "waiting" : "read",
        body: i.headline,
        post_title: null,
        draft: i.draft,
        account: i.account,
        at: i.at,
        due: i.at,
        url: i.url,
      })),
      ...asks.map((a) => ({
        id: approvalId(a.id, a.number),
        type: "template",
        who: refText(a),
        platform: templateAt(a).channel ?? null,
        kind: "template",
        state: "waiting",
        body: a.source,
        post_title: null,
        draft: null,
        account: null,
        at: a.at,
        due: a.at,
        url: null,
      })),
      // A client's workflow from a template: a yes opens its door and starts its parts.
      ...ws.map((w) => ({
        id: installApprovalId(w.id),
        type: "workflow",
        who: `${w.applied.name ?? w.template} for ${w.clientName}`,
        platform: null,
        kind: "workflow",
        state: "waiting",
        body: `${w.askedBy ?? "Someone"} asked to make it live. A yes opens its door and starts its parts.`,
        post_title: null,
        draft: null,
        account: null,
        at: w.askedAt,
        due: w.askedAt,
        url: `/marketplace/catalog/${encodeURIComponent(w.template)}?client=${encodeURIComponent(w.client)}`,
      })),
    ];
  },
  key: "id",
  title: "who",
  subtitle: "body",
  fields: {
    who: name("Item"),
    type: status(
      {
        draft: neutral("Post"),
        video: neutral("Video"),
        thread: neutral("Thread"),
        invite: neutral("Invite"),
        template: neutral("Template"),
        workflow: neutral("Workflow"),
      },
      "Type",
    ),
    platform: status(
      { ...PLATFORM_LABELS, email: neutral("Email"), sms: neutral("Texts") },
      "Site",
    ),
    kind: status(
      {
        post: neutral("Post draft"),
        video: neutral("Video to approve"),
        thread: neutral("Thread to answer"),
        invite: neutral("Accepted your invite"),
        template: neutral("Copy to make live"),
        workflow: neutral("Workflow to make live"),
      },
      "Kind",
    ),
    state: STATES,
    body: prose("Words"),
    postTitle: text("Post"),
    draft: prose("Our draft"),
    account: text("On"),
    at: date("When"),
    due: date("Due"),
    url: link("Open"),
  },
  views: [
    { id: "waiting", label: "Waiting on you", where: INBOX_WAITING, sort: "due", at: "due" },
    { id: "posts", label: "Posts", where: { type: "draft" }, sort: "due", at: "due" },
    { id: "videos", label: "Videos", where: { type: "video" }, sort: "-at", at: "at" },
    { id: "threads", label: "Threads", where: { type: "thread" }, sort: "-at", at: "at" },
    { id: "invites", label: "Invites", where: { type: "invite" }, sort: "-at", at: "at" },
    { id: "templates", label: "Templates", where: { type: "template" }, sort: "-at", at: "at" },
    { id: "workflows", label: "Workflows", where: { type: "workflow" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: [
    "marketing.approveDraft",
    "marketing.redraft",
    "marketing.rejectDraft",
    "marketing.videoApprove",
    "marketing.threadComment",
    "marketing.threadSkip",
    "marketing.inviteMessage",
    "marketing.inviteRead",
    "marketing.draftSet",
    "marketing.draftAsk",
    "marketing.draftUndo",
    "templates.approve",
    "templates.decline",
    "workflows.approve",
    "workflows.decline",
  ],
  // Drafts and videos waiting on a yes: their own handlers, on a row its login may act on.
  calls: { ...DRAFT_CALLS, "ContentDesk/approveVideo": "id" },
  /** An accepted invite's messages; a draft's Ask Claude thread. */
  load: async (db, id) => {
    const [type, rest] = typed(id);
    if (type === "video" || type === "template" || type === "workflow") return null;
    const ask = { ask: await draftTurns(db, type, rest) };
    return type === "invite" ? { ...(await dmRecord.load?.(db, rest)), ...ask } : ask;
  },
});

/** Followers per platform: the newest day kept, and the change from a week before it. */
export const audienceRecord = defineRecord({
  id: "marketing.audience",
  app: "marketing",
  channel: null,
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

export const SOCIAL_RECORDS = [inboxRecord, approvalRecord, activityRecord, audienceRecord];
