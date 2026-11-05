/**
 * Marketing → Inbox and the Inbox app's "Waiting on you" (designs/2026-10-06-social-inbox.md,
 * 2026-10-06-content-desk.md): everything waiting on William's click in one list
 * (`marketing.inbox`): post drafts, comments, DMs, Reddit threads to answer, accepted invites,
 * email replies, text threads and activity. Activity alone (`marketing.activity`), and
 * followers per platform (`marketing.audience`).
 */

import { draftTurns } from "@wren/core/ask";
import { broadcastLine, waitingBroadcasts } from "@wren/core/broadcasts";
import { draftItemsOf, recordOfPage } from "@wren/core/draft-record";
import {
  accountField,
  actor,
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
import { refText, waitingAsks } from "@wren/core/templates";
import { approvalId, templateAt } from "@wren/core/templates/console";
import { installApprovalId, waitingInstalls } from "@wren/core/templates/install";
import type { Queryable } from "@wren/db";
import { creditsList } from "@wren/delivery/billing";
import { creditApprovalId } from "@wren/delivery/billing/console";
import { KIND_NAME } from "@wren/documents/lines";
import { docApprovalId, waitingDocs } from "@wren/documents/store";
import { money, payApprovalId, waitingPayLinks } from "@wren/payments/store";
import { pageApprovalId, retireApprovalId } from "@wren/sites/console";
import { waitingPages, waitingRetires } from "@wren/sites/store";
import {
  accountPickFor,
  ITEM_STATES,
  type ItemKinds,
  notParked,
  PICK_FIELD,
  type ConsoleRow as Row,
  unsureOver,
  unsureSends,
  withPicks,
} from "@wren/starling-acts";
import { threadContextOf } from "@wren/starling-conversations";
import {
  conversationOf,
  queuedReplies,
  statusOf,
  threadStates,
  typed,
  waitingReplies,
} from "@wren/starling-conversations/inbox";
import { COMMENT_FOLD } from "@wren/starling-conversations/records";
import type { InboxReply, InboxThread } from "@wren/starling-conversations/schema";
import { isUrl } from "@wren/starling-core";
import { PLATFORM_CUES } from "@wren/starling-core/platform-cues";
import { TIKTOK_COPY } from "@wren/starling-core/tiktok";
import { threadRecord as textThreadRecord } from "@wren/starling-sms/records";
import { and, eq, sql } from "drizzle-orm";
import { waitingSwaps } from "../analytics/variants.js";
import { DRAFT_CALLS } from "../draft-calls.js";
import { contentDrafts } from "../schema.js";
import { shapeView } from "../shape-view.js";
import { mixedThumbs } from "../thumbs.js";
import type { VideoSigner } from "../video.js";
import { adFormatRecord } from "./ad-formats.js";
import { doneRecord } from "./done-record.js";
import { keywordHitRecord, keywordRecord } from "./keywords.js";
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
  (await db.execute(q)) as unknown as Row[];

/**
 * What outbound lays on the Inbox and To approve (designs/2026-11-02-starling.md, R3): rows
 * shaped as the lists show them, and a reach item's own page. Outbound's `reachItems` fills it;
 * the app composes. Inbound never reads a reach column.
 */
export interface ReachItems {
  /** Comments on our posts and DM threads, as the Inbox lists them. */
  inbox(db: Queryable): Promise<Row[]>;
  /** Queued threads and posts (with picks), accepted and proposed invites: To approve's. */
  approval(db: Queryable): Promise<Row[]>;
  /** A DM thread's or an accepted invite's own page (its messages); null for other kinds. */
  load(db: Queryable, id: string): Promise<Row | null>;
}
/** No reach rows: a test of inbound's own rows, or a console with no outbound. */
export const bareReach: ReachItems = {
  inbox: async () => [],
  approval: async () => [],
  load: async () => null,
};

export interface ConsoleDeps {
  reach: ReachItems;
  /** Every kind a draft box shows: the account picked for an item. */
  kinds: ItemKinds;
  /** Signs a draft's stored files (thumbnail, cover) for its page. */
  signer?: VideoSigner;
}

export const activityRecord = defineRecord({
  id: "marketing.activity",
  app: "campaigns",
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
    platform: status(PLATFORM_CUES, "Site"),
    kind: status(cued(KIND_LABELS), "Kind"),
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

/** What waits on William in To approve: unread, unsorted or waiting. */
const INBOX_WAITING = { state: ["new", "waiting"] } as const;
/** What waits on the team in the Inbox: open threads (designs/2026-10-07-inbox-reply.md). */
const INBOX_OPEN = { status: ["open"] } as const;

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

/**
 * Text threads they wrote in: their last word, and whether ours came after or it's unread. Read
 * from their texts (`ix_sms_messages_in`), never per contact: most contacts never wrote.
 */
const textRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.e164) who, i.body words, i.at,
        exists (select 1 from sms_messages o where o.contact_id = c.id and o.direction = 'out'
          and o.state <> 'skipped' and o.created_at > i.at) answered,
        (c.read_at is null or c.read_at < i.at) unread
      from (select distinct on (contact_id) contact_id, body, received_at at from sms_messages
        where direction = 'in' order by contact_id, received_at desc nulls last) i
      join sms_contacts c on c.id = i.contact_id
      order by i.at desc limit ${ACTIVITY_ROWS}`,
  );

/** Site chats (designs/2026-10-09-site-chat.md): their last word, and the page they wrote from. */
const chatRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select t.id, coalesce(t.name, t.email, t.phone, 'Site visitor') who, t.page, i.body words,
        i.at,
        exists (select 1 from chat_messages o where o.thread_id = t.id and o.direction = 'out'
          and o.at > i.at) answered,
        (t.read_at is null or t.read_at < i.at) unread
      from chat_threads t
      join lateral (select body, at from chat_messages
        where thread_id = t.id and direction = 'in'
        order by at desc, id desc limit 1) i on true
      order by i.at desc limit ${ACTIVITY_ROWS}`,
  );

/**
 * Mail a client's connected mailboxes brought in (designs/2026-10-07-mail-access.md), as triage
 * left it. Only the `mail` reader's: William's own mail is the Inbox app's "Your mail".
 */
const mailRows = async (db: Queryable) => {
  // Before a deploy grants the client's login the `watch` schema, there's none to read.
  const [can] = await rowsOf(
    db,
    sql`select has_table_privilege(current_user, 'watch.mail', 'SELECT') ok`,
  );
  if (!can?.ok) return [];
  // One row per thread: its newest mail, waiting while any mail in it waits.
  return rowsOf(
    db,
    sql`select * from (
        select m.id, coalesce(nullif(m.from_name, ''), m.from_address) who, m.mailbox,
          m.subject, coalesce(m.summary, m.subject) words, m.verdict, m.done_at, m.at, r.open,
          row_number() over t rn, count(*) over t mails,
          bool_or(m.done_at is null and (m.verdict is null or m.verdict = 'show')) over t waits
        from watch.mail m join watch.mail_records r on r.id = m.id
        where m.reader = 'mail'
        window t as (partition by m.mailbox, m.thread_id order by m.at desc, m.id desc
          rows between unbounded preceding and unbounded following)
      ) x where rn = 1
      order by at desc limit ${ACTIVITY_ROWS}`,
  );
};

/** A client's thread by its verdicts: one shown mail not done makes it wait on them. */
const mailState = (m: Record<string, unknown>) =>
  m.waits
    ? "waiting"
    : m.done_at
      ? "read"
      : m.verdict === "drop"
        ? "dropped"
        : m.verdict === "hold"
          ? "seen"
          : "read";

/** Post drafts waiting on a yes, with the slot each holds. */
const draftRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select id, platform, title, text, format, missing, scheduled, created, version, account
      from marketing_draft_records
      where state = 'draft' order by created desc limit ${ACTIVITY_ROWS}`,
  );

/** Rendered videos waiting on his Approve (Marketing → Videos). */
const videoRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select id, title, description, updated_at at from video_edits
      where state = 'rendered' order by updated_at desc limit ${ACTIVITY_ROWS}`,
  );

/** What a draft goes out as: one post, an X thread, or a slide set (`marketing_draft_records`). */
export const FORMATS = {
  post: neutral("Post"),
  thread: neutral("Thread"),
  carousel: neutral("Carousel"),
};

/** What a person must pick before a post's yes (`marketing_draft_records.missing`). */
export const MISSING_PICKS = {
  privacy: { label: "Who can see it", tone: "warn" as const },
  disclosure: { label: TIKTOK_COPY.pickOne, tone: "warn" as const },
};

/**
 * What other people sent us, as one list. Ids carry their type (`comment:12`, `dm:5`, `email:4`
 * (a call invite), `reply:6` (a reply with none), `text:8`, `chat:3`, `activity:9`); each action reads the
 * id after the colon. `due` orders "Waiting on you": when it came.
 */
/** Our own post as a context view heads it: its words, link and picture when it is a link. */
export const ourPostOf = (db: Queryable) => async (platform: string, post: string) => {
  const [d] = await db
    .select({
      title: contentDrafts.title,
      text: contentDrafts.text,
      url: contentDrafts.url,
      media: contentDrafts.media,
      at: contentDrafts.publishedAt,
    })
    .from(contentDrafts)
    .where(and(sql`${contentDrafts.platform} = ${platform}`, eq(contentDrafts.publishedId, post)))
    .limit(1);
  if (!d) return null;
  const pic = d.media?.kind === "image" && isUrl(d.media.source) ? d.media.source : null;
  return {
    title: d.title,
    text: d.text,
    url: d.url,
    media: pic,
    author: null,
    place: null,
    at: d.at?.toISOString() ?? null,
  };
};

export const inboxRecordOf = (deps: ConsoleDeps) =>
  defineRecord({
    id: "marketing.inbox",
    app: "inbox",
    channel: { field: "platform" },
    // Table | By Type: comment, DM, email, mail, text, chat, activity.
    by: "type",
    name: { one: "inbox item", many: "inbox items" },
    rows: async (db) => {
      const reach = await deps.reach.inbox(db);
      const cs = reach.filter((r) => r.type === "comment");
      const es = await emailRows(db);
      const xs = await textRows(db);
      const as = (await activityRecord.rows?.(db)) ?? [];
      const ms = await mailRows(db);
      const hs = await chatRows(db);
      const kept = await threadStates(db);
      const now = new Date();
      // The team's state on each: who has it, open, waiting, closed or snoozed. One person's
      // comments under one post fold into one row, so its state is the group's: a follow-up
      // without its own takes the newest any of them has (a new word still reopens it).
      const byGroup = new Map<string, InboxThread>();
      for (const c of cs) {
        const g = COMMENT_FOLD.by(c);
        const k = g === null ? undefined : kept.get(String(c.id));
        if (g === null || !k) continue;
        const had = byGroup.get(g);
        if (!had || k.updatedAt > had.updatedAt) byGroup.set(g, k);
      }
      const team = (r: Record<string, unknown>) => {
        const g = COMMENT_FOLD.by(r);
        const k = kept.get(String(r.id)) ?? (g === null ? undefined : byGroup.get(g));
        return {
          ...r,
          status: statusOf({ state: r.state, at: r.at }, k, now),
          assignee: k?.assignee ?? null,
          snooze: k?.snoozeUntil && k.snoozeUntil > now ? k.snoozeUntil : null,
        };
      };
      const all: Row[] = [
        ...reach,
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
          url: e.invite ? `/today/replies/${e.invite}` : null,
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
        // Site chats: answered in the bubble, as texts are.
        ...hs.map((h) => ({
          id: `chat:${h.id}`,
          type: "chat",
          who: h.who,
          platform: null,
          kind: "chat",
          channel: null,
          state: h.answered ? "answered" : h.unread ? "waiting" : "read",
          body: h.words,
          post_title: h.page,
          draft: null,
          account: null,
          at: h.at,
          due: h.at,
          url: null,
        })),
        // Mail to the client's own mailboxes: opened in Gmail or Outlook, Done when dealt with.
        ...ms.map((m) => ({
          id: `mail:${m.id}`,
          type: "mail",
          who: Number(m.mails) > 1 ? `${m.who} (${m.mails})` : m.who,
          platform: null,
          kind: "mail",
          channel: null,
          state: mailState(m),
          body: m.words,
          post_title: m.subject,
          draft: null,
          account: null,
          mailbox: m.mailbox,
          at: m.at,
          due: m.at,
          url: m.open,
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
      return withPicks(db, all.map(team));
    },
    key: "id",
    title: "who",
    account: "account",
    subtitle: "body",
    fold: COMMENT_FOLD,
    fields: {
      who: name("Who"),
      messages: text("Their messages", { listed: false }),
      status: status(
        {
          open: { label: "Open", tone: "warn" },
          waiting: neutral("Waiting on them"),
          snoozed: neutral("Snoozed"),
          closed: neutral("Closed"),
        },
        "Status",
      ),
      snooze: date("Snoozed until"),
      type: status(
        cued({
          comment: neutral("Comment"),
          dm: neutral("DM"),
          email: neutral("Email"),
          mail: neutral("Mail"),
          text: neutral("Text"),
          chat: neutral("Site chat"),
          activity: neutral("Activity"),
        }),
        "Type",
      ),
      platform: status(PLATFORM_CUES, "Site"),
      assignee: actor("Assignee"),
      kind: status(
        cued({
          post_reply: neutral("On our post"),
          comment_reply: neutral("Under our comment"),
          thread_reply: neutral("Follow-up in the thread"),
          username_mention: neutral("Mention"),
          dm: neutral("DM"),
          email: neutral("Email reply"),
          mail: neutral("To your mailbox"),
          text: neutral("Text"),
          chat: neutral("Site chat"),
          ...KIND_LABELS,
        }),
        "Kind",
      ),
      channel: status(
        cued({
          reach: neutral("Reach account"),
          social: neutral("Connected account"),
          content: neutral("Our post"),
        }),
        "Where",
      ),
      state: ITEM_STATES,
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
      pick: PICK_FIELD(),
      account: accountField("On"),
      mailbox: text("Mailbox"),
      at: date("When"),
      due: date("Waiting since"),
      url: link("Open"),
    },
    views: [
      { id: "waiting", label: "Waiting on you", where: INBOX_OPEN, sort: "due", at: "due" },
      {
        id: "mine",
        label: "Mine",
        where: { status: ["open", "waiting", "snoozed"] },
        mine: "assignee",
        sort: "due",
        at: "due",
      },
      {
        id: "unassigned",
        label: "Unassigned",
        where: { ...INBOX_OPEN, assignee: { empty: true } },
        sort: "due",
        at: "due",
      },
      { id: "snoozed", label: "Snoozed", where: { status: "snoozed" }, sort: "snooze", at: "due" },
      { id: "comments", label: "Comments", where: { type: "comment" }, sort: "-at", at: "at" },
      { id: "dms", label: "DMs", where: { type: "dm" }, sort: "-at", at: "at" },
      { id: "email", label: "Email", where: { type: "email" }, sort: "-at", at: "at" },
      { id: "mail", label: "Mail", where: { type: "mail" }, sort: "-at", at: "at" },
      { id: "texts", label: "Texts", where: { type: "text" }, sort: "-at", at: "at" },
      { id: "chats", label: "Site chat", where: { type: "chat" }, sort: "-at", at: "at" },
      { id: "activity", label: "Activity", where: { type: "activity" }, sort: "-at", at: "at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    activity: { view: "draft_activity", by: "item", seq: "seq" },
    drafts: (id) => draftItemsOf(id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)),
    actions: [
      "marketing.commentAnswer",
      "marketing.threadReply",
      "marketing.threadRead",
      "marketing.commentDm",
      "marketing.commentDrop",
      "marketing.dmReply",
      "marketing.dmRead",
      "marketing.markRead",
      "email.approve",
      "email.drop",
      "mail.done",
      "marketing.activitySeen",
      "marketing.activityAllSeen",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
      "inbox.reply",
      "inbox.ask",
      "inbox.suggest",
      "inbox.note",
      "inbox.assign",
      "inbox.take",
      "inbox.open",
      "inbox.close",
      "inbox.snooze",
      "inbox.wake",
    ],
    // The Inbox's handlers on one thread: a login limited to a channel may call them on its rows.
    calls: Object.fromEntries(
      ["reply", "ask", "suggest", "note", "assign", "take", "status", "snooze"].map((h) => [
        `InboxDesk/${h}`,
        "thread",
      ]),
    ),
    /**
     * The whole conversation with the person (every channel, touches, notes) and where a reply can
     * go; a DM thread's or a text thread's own messages; a draft's Ask Claude thread.
     */
    load: async (db, id) => {
      const [type, rest] = typed(id);
      const conversation = await conversationOf(db, id);
      if (type === "text")
        return { ...((await textThreadRecord.load?.(db, rest)) ?? {}), conversation };
      // An email's words and our drafted answer are the row's own.
      if (["activity", "email", "reply", "mail", "outbound"].includes(type))
        return { conversation };
      const ask = {
        ask: await draftTurns(db, type, rest),
        record: await recordOfPage(db, type, rest),
        accounts: await accountPickFor(db, id, deps.kinds),
        conversation,
        // The post and every reply under it, nested (designs/2026-10-15-engage-threads.md).
        ...(type === "comment"
          ? { context: await threadContextOf(db, Number(rest), ourPostOf(db)) }
          : {}),
      };
      return type === "dm" ? { ...(await deps.reach.load(db, id)), ...ask } : ask;
    },
  });

/**
 * An asked reply as To approve's row: waiting on a yes, or queued after one (`send_at`, and why the
 * cap holds it as `held`).
 */
const replyItem = (r: InboxReply) => ({
  id: `reply:${r.id}`,
  type: "reply",
  who: r.who ?? r.thread,
  platform: r.channel === "text" ? "sms" : r.channel === "email" ? "email" : null,
  kind: "reply",
  state: r.state === "queued" ? "queued" : "waiting",
  body: r.body,
  post_title: null,
  why: r.why,
  held: r.state === "queued" ? r.detail : null,
  send_at: r.state === "queued" ? r.sendAt : null,
  draft: null,
  account: null,
  asked_by: r.askedBy,
  at: r.state === "queued" ? (r.decidedAt ?? r.askedAt) : r.askedAt,
  due: r.state === "queued" ? (r.sendAt ?? r.askedAt) : r.askedAt,
  // Our email thread they never answered has no Inbox row to open.
  url: r.thread.startsWith("outbound:") ? null : `/today/messages/${encodeURIComponent(r.thread)}`,
});

/**
 * Where an outbound item lives in Engage (designs/2026-10-16-outreach-app.md): a comment to
 * write in Engage, an invite in Invites; null for the rest.
 */
function outreachOf(id: string): string | null {
  const [type, rest] = typed(id);
  if (type === "thread" || type === "onpost") return `/campaigns/engage/${encodeURIComponent(id)}`;
  if (type === "invite" || type === "connect")
    return `/campaigns/invites/${encodeURIComponent(rest)}`;
  return null;
}

/**
 * What we'd send, waiting on William's yes, as one list. Ids carry their type (`draft:3`,
 * `video:2` (rendered, waiting on Approve), `thread:abc`, `invite:7` (accepted), `connect:7` (a
 * proposed invite, by contact), `onpost:9` (a comment drafted on someone else's post),
 * `template:4:3` (version 3 asked to go live)); each action reads the id after the colon. `due` orders "Waiting on you": a
 * draft's slot, else when it came.
 */
/** To approve; a post draft's fields come with it, its stored files signed by `deps.signer`. */
export const approvalRecordOf = (deps: ConsoleDeps) =>
  defineRecord({
    id: "marketing.approval",
    app: "inbox",
    channel: { field: "platform" },
    name: { one: "item to approve", many: "items to approve" },
    rows: async (db) => {
      const ps = await draftRows(db);
      const vs = await videoRows(db);
      const reach = await deps.reach.approval(db);
      const asks = await waitingAsks(db);
      const ws = await waitingInstalls(db);
      const pgs = await waitingPages(db);
      const outs = await waitingRetires(db);
      const rs = await waitingReplies(db, ACTIVITY_ROWS);
      const qs = await queuedReplies(db, ACTIVITY_ROWS);
      const pays = await waitingPayLinks(db);
      const dcs = await waitingDocs(db);
      const sws = await waitingSwaps(db);
      const bcs = await waitingBroadcasts(db);
      const crs = await creditsList(db, { status: ["review"], limit: 200 });
      const uss = await unsureSends(db);
      const rows: Row[] = [
        // A send that may have gone out: he checks the site, marks it posted or sends it again.
        ...unsureOver(uss, reach),
        // A broadcast to a segment (People → Broadcasts): a yes schedules it; nothing sends before.
        ...bcs.map(broadcastItem),
        // A reply typed in the Inbox that waits on a yes: Approve sends it on its channel.
        ...rs.map(replyItem),
        // One he said yes to that the frequency cap holds: it sends itself at `send_at`.
        ...qs.map(replyItem),
        ...ps.map((p) => ({
          id: `draft:${p.id}`,
          type: "draft",
          who: p.title,
          platform: p.platform,
          kind: "post",
          format: p.format,
          missing: p.missing,
          // Its words hashed: Approve sends the one on screen, so a change since refuses it.
          version: p.version,
          state: "waiting",
          body: p.text,
          post_title: null,
          draft: null,
          account: p.account,
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
          url: `/campaigns/videos/${v.id}`,
        })),
        // Queued threads and posts, accepted and proposed invites: outbound's, with their picks.
        ...reach.filter(notParked(uss)),
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
        // A page's copy asked to go live (Sites): a yes puts that version at its URL.
        ...pgs.map((p) => ({
          id: pageApprovalId(p.id, p.number ?? 0),
          type: "page",
          who: p.title,
          platform: null,
          kind: "page",
          state: "waiting",
          body: `${p.by ?? "Someone"} asked to make version ${p.number} live at /o/${p.slug}${p.client ? ` for ${p.client}` : ""}.`,
          post_title: p.offer,
          draft: null,
          account: null,
          at: p.at,
          due: p.at,
          url: `/campaigns/pages/${p.id}`,
        })),
        // A stopped split's page asked to come down (Sites): a yes answers gone at its URL.
        ...outs.map((p) => ({
          id: retireApprovalId(p.id),
          type: "retire",
          who: p.title,
          platform: null,
          kind: "retire",
          state: "waiting",
          body: `${p.by ?? "Someone"} asked to take /o/${p.slug} down${p.client ? ` for ${p.client}` : ""}. Its numbers stay.`,
          post_title: p.offer,
          draft: null,
          account: null,
          at: p.at,
          due: p.at,
          url: `/campaigns/pages/${p.id}`,
        })),
        // A new title, thumbnail or hook for a live post: a yes changes it on the platform.
        ...sws.map((w) => ({
          id: `swap:${w.id}`,
          type: "swap",
          who: w.title ?? `Post ${w.draftId.slice(0, 8)}`,
          platform: w.platform,
          kind: "swap",
          state: "waiting",
          body: `New ${w.field}: ${w.value}`,
          post_title: w.live ? `Now: ${w.live}` : null,
          why: w.why,
          draft: null,
          account: null,
          asked_by: w.by,
          at: w.at,
          due: w.at,
          url: w.url,
        })),
        // A pay link someone without the yes made (Payments): a yes makes it on Stripe and sends it.
        ...pays.map((p) => ({
          id: payApprovalId(p.id),
          type: "pay",
          who: `${p.name ?? p.email ?? "A text thread"}: ${money(p.cents * p.quantity, p.currency)}`,
          platform: p.channel,
          kind: "pay",
          state: "waiting",
          body: `${p.by} asked to send a pay link for ${p.quantity > 1 ? `${p.quantity} x ` : ""}${p.description}${p.clientName ? ` (${p.clientName})` : ""}.`,
          post_title: p.description,
          draft: null,
          account: null,
          at: p.at,
          due: p.at,
          url: `/office/pay-links/${p.id}?client=${encodeURIComponent(p.client)}`,
        })),
        // A document someone without the yes asked to send (Payments): a yes sends it to be signed.
        ...dcs.map((d) => ({
          id: docApprovalId(d.id),
          type: "doc",
          who: `${d.name ?? d.email ?? "A text thread"}: ${money(d.total, d.currency)}`,
          platform: d.channel,
          kind: "doc",
          state: "waiting",
          body: `${d.by} asked to send ${KIND_NAME[d.kind as keyof typeof KIND_NAME] ?? "a document"} ${d.number}, ${d.title}${d.clientName ? ` (${d.clientName})` : ""}.`,
          post_title: d.title,
          draft: null,
          account: null,
          at: d.at,
          due: d.at,
          url: `/office/documents/${d.id}?client=${encodeURIComponent(d.client)}`,
        })),
        // Money in by bank transfer that ClientInvoicing wouldn't put on an invoice by itself.
        ...crs.map((c) => ({
          id: creditApprovalId(c.id),
          type: "credit",
          who: `${c.payer ?? "Unknown payer"}: ${money(c.cents + c.feeCents, c.currency)}`,
          platform: null,
          kind: "credit",
          state: "waiting",
          body: `${c.why ?? "No invoice fits"}.${c.invoice ? ` Likely ${c.invoice}${c.clientName ? ` (${c.clientName})` : ""}.` : ""}${c.memo ? ` Memo: ${c.memo}` : ""}`,
          post_title: c.invoice,
          draft: null,
          account: null,
          at: c.at,
          due: c.at,
          url: `/office/payments-in/${c.id}`,
        })),
      ];
      return rows.map((r) => ({ ...r, outreach: outreachOf(String(r.id)) }));
    },
    key: "id",
    title: "who",
    account: "account",
    subtitle: "body",
    fields: {
      who: name("Item"),
      type: status(
        cued({
          draft: neutral("Post"),
          video: neutral("Video"),
          thread: neutral("Thread"),
          invite: neutral("Invite"),
          connect: neutral("Invite"),
          onpost: neutral("Comment"),
          template: neutral("Template"),
          workflow: neutral("Workflow"),
          page: neutral("Page"),
          retire: neutral("Page"),
          reply: neutral("Reply"),
          pay: neutral("Payment"),
          doc: neutral("Document"),
          credit: neutral("Payment in"),
          swap: neutral("Swap"),
          broadcast: neutral("Broadcast"),
          unsure: neutral("Check"),
        }),
        "Type",
      ),
      platform: status(
        cued({ ...PLATFORM_CUES, email: neutral("Email"), sms: neutral("Texts") }),
        "Site",
      ),
      kind: status(
        cued({
          post: neutral("Post draft"),
          video: neutral("Video to approve"),
          thread: neutral("Thread to answer"),
          invite: neutral("Accepted your invite"),
          connect: neutral("Invite to send"),
          onpost: neutral("Comment to post"),
          template: neutral("Copy to make live"),
          workflow: neutral("Workflow to make live"),
          page: neutral("Page to make live"),
          retire: neutral("Page to take down"),
          reply: neutral("Reply to send"),
          pay: neutral("Pay link to send"),
          doc: neutral("Document to send"),
          credit: neutral("Payment to match"),
          swap: neutral("Swap on a live post"),
          broadcast: neutral("Broadcast to send"),
          unsure: neutral("May have gone out"),
        }),
        "Kind",
      ),
      state: ITEM_STATES,
      format: status(FORMATS, "Format", { listed: false }),
      missing: status(MISSING_PICKS, "Pick first", { listed: false }),
      version: text("Version", { listed: false }),
      body: prose("Words"),
      postTitle: text("Post"),
      place: text("Where"),
      why: text("Picked for"),
      held: text("Held because"),
      sendAt: date("Sends at"),
      draft: prose("Our draft"),
      pick: PICK_FIELD(),
      account: accountField("On"),
      askedBy: text("Asked by"),
      unsure: text("Why we're unsure"),
      at: date("When"),
      due: date("Waiting since"),
      url: link("Open"),
      outreach: link("In Outreach"),
      onSite: link("Open on site"),
    },
    views: [
      { id: "waiting", label: "Waiting on you", where: INBOX_WAITING, sort: "due", at: "due" },
      {
        id: "unsure",
        label: "May have gone out",
        where: { type: "unsure" },
        sort: "-at",
        at: "at",
      },
      // Said yes to, held by the frequency cap: each sends itself at its time.
      // Also the comments a subreddit's rules hold back: each says which rule.
      {
        id: "queued",
        label: "Queued",
        where: { state: ["queued", "held"] },
        sort: "due",
        at: "due",
      },
      { id: "posts", label: "Posts", where: { type: "draft" }, sort: "due", at: "due" },
      { id: "videos", label: "Videos", where: { type: "video" }, sort: "-at", at: "at" },
      { id: "threads", label: "Thread replies", where: { type: "thread" }, sort: "-at", at: "at" },
      { id: "comments", label: "Comments", where: { type: "onpost" }, sort: "due", at: "due" },
      {
        id: "invites",
        label: "Invites",
        where: { type: ["invite", "connect"] },
        sort: "-at",
        at: "at",
      },
      { id: "templates", label: "Templates", where: { type: "template" }, sort: "-at", at: "at" },
      { id: "workflows", label: "Workflows", where: { type: "workflow" }, sort: "-at", at: "at" },
      {
        id: "pages",
        label: "Pages",
        where: { type: ["page", "retire"] },
        sort: "-at",
        at: "at",
      },
      { id: "replies", label: "Replies", where: { type: "reply" }, sort: "-at", at: "at" },
      {
        id: "broadcasts",
        label: "Broadcasts",
        where: { type: "broadcast" },
        sort: "due",
        at: "due",
      },
      {
        id: "payments",
        label: "Payments",
        where: { type: ["pay", "doc", "credit"] },
        sort: "-at",
        at: "at",
      },
      { id: "swaps", label: "Swaps", where: { type: "swap" }, sort: "-at", at: "at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    activity: { view: "draft_activity", by: "item", seq: "seq" },
    // An unsure send's history is its item's (`unsure:thread:9` is `thread:9`).
    drafts: (id) => {
      const [type, rest] = typed(id.startsWith("unsure:") ? id.slice("unsure:".length) : id);
      return draftItemsOf(type, rest);
    },
    actions: [
      "marketing.approveDraft",
      "marketing.redraft",
      "marketing.rejectDraft",
      "marketing.videoApprove",
      "marketing.threadComment",
      "marketing.threadSkip",
      "marketing.inviteMessage",
      "marketing.inviteRead",
      "marketing.connectApprove",
      "marketing.connectSkip",
      "marketing.onpostComment",
      "marketing.onpostLike",
      "marketing.onpostFollow",
      "marketing.onpostSkip",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
      "marketing.draftFields",
      "marketing.draftFunnel",
      "marketing.draftUpload",
      "marketing.draftAttach",
      "marketing.draftSlides",
      "templates.approve",
      "templates.decline",
      "workflows.approve",
      "workflows.decline",
      "sites.approve",
      "sites.decline",
      "sites.retireApprove",
      "sites.retireDecline",
      "inbox.replyApprove",
      "inbox.replyDrop",
      "payments.approve",
      "payments.decline",
      "documents.approve",
      "documents.decline",
      "billing.match",
      "billing.dismiss",
      "marketing.swapApprove",
      "marketing.swapSkip",
      "people.broadcastApprove",
      "people.broadcastDecline",
      "marketing.sendPosted",
      "marketing.sendAgain",
      "marketing.sendDrop",
    ],
    // Drafts and videos waiting on a yes: their own handlers, on a row its login may act on.
    calls: {
      ...DRAFT_CALLS,
      "ContentDesk/approveVideo": "id",
      "InboxDesk/approve": "id",
      "InboxDesk/drop": "id",
    },
    thumbs: mixedThumbs((id) => {
      const [type, rest] = typed(id);
      return type === "draft" ? { draft: rest } : type === "video" ? { video: rest } : null;
    }, deps.signer),
    /** An accepted invite's messages; a draft's Ask Claude thread. */
    load: async (db, id) => {
      const [type, rest] = typed(id);
      if (
        type === "video" ||
        type === "template" ||
        type === "workflow" ||
        type === "page" ||
        type === "retire" ||
        type === "pay" ||
        type === "doc" ||
        type === "credit" ||
        type === "swap" ||
        type === "broadcast" ||
        type === "unsure"
      )
        return null;
      // An asked reply: the conversation it answers.
      if (type === "reply") {
        const [r] = (await db.execute(
          sql`select thread from inbox_replies where id = ${Number(rest)}`,
        )) as unknown as Array<{ thread: string }>;
        return r ? { conversation: await conversationOf(db, r.thread) } : null;
      }
      const ask = {
        ask: await draftTurns(db, type, rest),
        record: await recordOfPage(db, type, rest),
        accounts: await accountPickFor(db, id, deps.kinds),
      };
      if (type === "draft") return { shape: await shapeView(db, rest, deps.signer), ...ask };
      return type === "invite" ? { ...(await deps.reach.load(db, id)), ...ask } : ask;
    },
  });

/** An asked reply's access channel: texts are `sms`, email `email`; a DM's or comment's, none here. */
const askedVia = (channel: string) =>
  channel === "text" ? "sms" : channel === "email" ? "email" : null;

/**
 * A client's To approve for its Inbox (designs/2026-10-07-inbox-reply.md): replies typed there
 * that wait on a yes, `reply:<id>`. Approve sends it on its channel, from whoever the client's
 * approver setting names. Wren's own wait in `marketing.approval`.
 */
/** A broadcast waiting on a yes, as To approve lists it: Wren's and a client's alike. */
function broadcastItem(b: Awaited<ReturnType<typeof waitingBroadcasts>>[number]) {
  return {
    id: `broadcast:${b.id}`,
    type: "broadcast",
    who: b.name,
    platform: b.channel,
    kind: "broadcast",
    state: "waiting",
    body: `${broadcastLine(b)}\n\n${b.subject ? `Subject: ${b.subject}\n\n` : ""}${b.body}`,
    post_title: b.subject,
    draft: null,
    account: null,
    asked_by: b.by,
    at: b.askedAt,
    due: b.sendAt ?? b.askedAt,
    send_at: b.sendAt,
    url: `/people/broadcasts/${b.id}`,
  };
}

export const askedReplyRecord = defineRecord({
  id: "marketing.asked_reply",
  app: "inbox",
  channel: { field: "platform" },
  name: { one: "reply to approve", many: "replies to approve" },
  rows: async (db) => [
    // A send of its own that may have gone out (designs/2026-10-16-maybe-sent.md): its approver
    // checks the site, then marks it posted or sends it again.
    ...(await unsureSends(db)).map((u) => ({
      id: `unsure:${u.item}`,
      type: "unsure",
      who: u.target,
      platform: null,
      kind: "unsure",
      state: "waiting",
      body: u.words,
      why: u.why,
      at: u.updatedAt,
      url: u.url,
    })),
    // A broadcast to a segment (People → Broadcasts): a yes schedules it.
    ...(await waitingBroadcasts(db)).map(broadcastItem),
    ...[
      ...(await waitingReplies(db, ACTIVITY_ROWS)),
      // Said yes to and held by the frequency cap: it sends itself at `send_at`.
      ...(await queuedReplies(db, ACTIVITY_ROWS)),
    ].map((r) => ({
      id: `reply:${r.id}`,
      who: r.who ?? r.thread,
      platform: askedVia(r.channel),
      kind: r.channel,
      state: r.state === "queued" ? "queued" : "waiting",
      body: r.body,
      why: r.why,
      held: r.state === "queued" ? r.detail : null,
      send_at: r.state === "queued" ? r.sendAt : null,
      asked_by: r.askedBy,
      at: r.state === "queued" ? (r.decidedAt ?? r.askedAt) : r.askedAt,
      url: `/today/messages/${encodeURIComponent(r.thread)}`,
    })),
  ],
  key: "id",
  title: "who",
  subtitle: "body",
  fields: {
    who: name("To"),
    platform: status(cued({ email: neutral("Email"), sms: neutral("Texts") }), "Site"),
    kind: status(
      cued({
        email: neutral("Email"),
        text: neutral("Text"),
        dm: neutral("DM"),
        comment: neutral("Comment"),
        broadcast: neutral("Broadcast"),
        unsure: neutral("May have gone out"),
      }),
      "Reply by",
    ),
    state: ITEM_STATES,
    body: prose("Words"),
    why: text("Why it waits"),
    held: text("Held because"),
    sendAt: date("Sends at"),
    askedBy: text("Asked by"),
    at: date("When"),
    url: link("Open the thread"),
  },
  views: [
    { id: "waiting", label: "Waiting on a yes", where: INBOX_WAITING, sort: "-at", at: "at" },
    { id: "queued", label: "Queued", where: { state: "queued" }, sort: "sendAt", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: [
    "inbox.replyApprove",
    "inbox.replyDrop",
    "people.broadcastApprove",
    "people.broadcastDecline",
    "marketing.sendPosted",
    "marketing.sendAgain",
    "marketing.sendDrop",
  ],
  calls: { "InboxDesk/approve": "id", "InboxDesk/drop": "id" },
  /** The conversation it answers. */
  load: async (db, id) => {
    const [type, rest] = typed(id);
    if (type === "broadcast" || type === "unsure") return null;
    const [r] = (await db.execute(
      sql`select thread from inbox_replies where id = ${Number(rest)}`,
    )) as unknown as Array<{ thread: string }>;
    return r ? { conversation: await conversationOf(db, r.thread) } : null;
  },
});

/** Followers per platform: the newest day kept, and the change from a week before it. */
export const audienceRecord = defineRecord({
  id: "marketing.audience",
  app: "people",
  channel: null,
  name: { one: "platform", many: "platforms" },
  // Followers from social_days; the account's own last 7 days from account_metric_days.
  rows: async (db) =>
    (
      await rowsOf(
        db,
        sql`select distinct on (d.platform) d.platform id, d.platform, d.followers, d.day,
          d.followers - (select w.followers from social_days w
            where w.platform = d.platform and w.day <= d.day - 7 order by w.day desc limit 1) week,
          a.reach, a.visits, a.links, a.gained, a.lost, l.viewers, l.search
        from social_days d
        left join lateral (select
            sum(m.value) filter (where m.metric = 'reach')::int reach,
            sum(m.value) filter (where m.metric = 'profile_visits' and m.platform <> 'linkedin')::int visits,
            sum(m.value) filter (where m.metric = 'link_clicks')::int links,
            sum(m.value) filter (where m.metric = 'follows')::int gained,
            sum(m.value) filter (where m.metric = 'unfollows')::int lost
          from account_metric_days m where m.platform = d.platform and m.key = ''
            and m.day > current_date - 7) a on true
        -- LinkedIn's dashboard: window totals on the day read, so the latest, not a sum.
        left join lateral (select
            (select v.value from account_metric_days v where v.platform = d.platform
              and v.metric = 'profile_visits' and v.key = '' order by v.day desc limit 1)::int viewers,
            (select v.value from account_metric_days v where v.platform = d.platform
              and v.metric = 'search_appearances' and v.key = '' order by v.day desc limit 1)::int search
          where d.platform = 'linkedin') l on true
        order by d.platform, d.day desc`,
      )
    ).map((r) => ({ ...r, site: PLATFORM_NAMES[r.platform as keyof typeof PLATFORM_NAMES] })),
  key: "id",
  title: "site",
  fields: {
    site: name("Platform"),
    followers: number("Followers"),
    week: number("Change in 7 days"),
    gained: number("Gained in 7 days", { listed: false }),
    lost: number("Lost in 7 days", { listed: false }),
    reach: number("Reach in 7 days"),
    visits: number("Profile visits in 7 days"),
    links: number("Link clicks in 7 days"),
    viewers: number("Profile viewers, LinkedIn's 90 days"),
    search: number("Search appearances, LinkedIn's last week"),
    day: date("As of"),
  },
  views: [{ id: "all", label: "All", sort: "-followers", at: "day" }],
  actions: ["marketing.audienceRead"],
});

/** The social records; the worker's sign a draft's stored files. */
/** Marketing's lists over every channel; Engage and Explore are outbound's, the app adds them. */
export const socialRecordsOf = (deps: ConsoleDeps) => [
  inboxRecordOf(deps),
  approvalRecordOf(deps),
  doneRecord,
  adFormatRecord,
  keywordRecord,
  keywordHitRecord,
  activityRecord,
  audienceRecord,
];
