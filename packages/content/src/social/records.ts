/**
 * Marketing → Inbox and the Inbox app's "Waiting on you" (designs/2026-10-06-social-inbox.md,
 * 2026-10-06-content-desk.md): everything waiting on William's click in one list
 * (`marketing.inbox`): post drafts, comments, DMs, Reddit threads to answer, accepted invites,
 * email replies, text threads and activity. Activity alone (`marketing.activity`), and
 * followers per platform (`marketing.audience`).
 */

import { threadRecord as textThreadRecord } from "@wren/channel-sms/records";
import { draftTurns } from "@wren/core/ask";
import { broadcastLine, waitingBroadcasts } from "@wren/core/broadcasts";
import { isUrl } from "@wren/core/content";
import { TIKTOK_COPY } from "@wren/core/content/tiktok";
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
import { accountPickFor, type SendAttempt, threadContextOf, unsureSends } from "@wren/outreach";
import {
  COMMENT_FOLD,
  commentRecord,
  dmRecord,
  PLATFORM_LABELS,
  threadRecord,
} from "@wren/outreach/records";
import { money, payApprovalId, waitingPayLinks } from "@wren/payments/store";
import { pageApprovalId, retireApprovalId } from "@wren/sites/console";
import { waitingPages, waitingRetires } from "@wren/sites/store";
import { and, eq, sql } from "drizzle-orm";
import { waitingSwaps } from "../analytics/variants.js";
import { DRAFT_CALLS } from "../draft-calls.js";
import { conversationOf } from "../inbox/conversation.js";
import { queuedReplies, waitingReplies } from "../inbox/send.js";
import { statusOf, threadStates, typed } from "../inbox/threads.js";
import { contentDrafts, type InboxReply } from "../schema.js";
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
export const INBOX_WAITING = { state: ["new", "waiting"] } as const;
/** What waits on the team in the Inbox: open threads (designs/2026-10-07-inbox-reply.md). */
export const INBOX_OPEN = { status: ["open"] } as const;

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

/** Accepted invites nobody wrote to yet: no message either way past the invite. */
const acceptedRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.handle) who, c.headline, c.connected_at at, c.draft, c.url,
        coalesce(da.account, a.account) account,
        (c.read_at is null or c.read_at < c.connected_at) unread
      from reach_contacts c left join reach_accounts a on a.id = c.account_id
      left join draft_accounts da on da.item = 'invite:' || c.id
      where c.connected_at is not null and c.state not in ('opted_out', 'blocked')
        and not exists (select 1 from reach_messages m where m.contact_id = c.id
          and (m.direction = 'in' or m.kind <> 'connect'))
      order by c.connected_at desc limit ${ACTIVITY_ROWS}`,
  );

/** LinkedIn invites the sweep proposed, waiting on his yes: who, and why they were picked. */
const connectRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.handle) who, c.headline, c.fit->>'why' why,
        c.fit->>'company' company, c.url, a.account account, m.created_at at, m.body note
      from reach_messages m join reach_contacts c on c.id = m.contact_id
      left join reach_accounts a on a.id = m.account_id
      where m.kind = 'connect' and m.direction = 'out' and m.state = 'proposed'
      order by m.id limit ${ACTIVITY_ROWS}`,
  );

/** Others' posts (LinkedIn, X, Instagram) with a comment drafted, waiting on his yes. */
const onPostRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select p.id, p.platform, p.author, p.text, p.why, p.draft, p.url,
        coalesce(da.account, p.account) account, coalesce(p.posted_at, p.created_at) at,
        p.queued_at, p.send_at
      from reach_posts p left join draft_accounts da on da.item = 'onpost:' || p.id
      where p.state = 'queued'
      order by p.fit desc nulls last, p.id limit ${ACTIVITY_ROWS}`,
  );

/** Our comments sent on their ground, newest first: Engage's Posted. */
const sentRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select * from (
        select 'thread:' || t.id id, 'thread' type, t.author who, 'reddit' platform,
          coalesce(nullif(t.body, ''), t.title) body, t.title post_title, t.answer draft,
          a.account account, t.posted_at at, t.answered_at sent, t.url, 'r/' || t.subreddit place
        from reddit_threads t left join reach_accounts a on a.id = t.account_id
        where t.answered_at is not null and t.answer_ref is not null
        union all
        select 'onpost:' || id, 'onpost', author, platform, text, null, comment, account,
          coalesce(posted_at, created_at), commented_at, url, null
        from reach_posts where commented_at is not null
      ) s order by sent desc limit ${ACTIVITY_ROWS}`,
  );

/**
 * Each sent comment's last proof (designs/2026-10-14-comment-proof.md), by item: whether a
 * stranger sees it, when that was read, its permalink and shot (signed by `signer`).
 */
async function proofsBy(db: Queryable, signer?: VideoSigner) {
  const rows = await rowsOf(
    db,
    sql`select item, state, note, url, shot, checked_at from comment_proofs
      order by checked_at desc limit ${ACTIVITY_ROWS * 2}`,
  );
  const sign = async (shot: unknown) =>
    typeof shot === "string" && shot && signer ? signer.host.host(shot).catch(() => null) : null;
  return new Map(
    await Promise.all(
      rows.map(
        async (r) =>
          [
            String(r.item),
            {
              proof: r.state,
              proof_note: r.note,
              proof_at: r.checked_at,
              proof_url: r.url,
              proof_shot: await sign(r.shot),
            },
          ] as const,
      ),
    ),
  );
}

/** A row with its proof, when its item has one. */
const withProof =
  (by: Awaited<ReturnType<typeof proofsBy>>) =>
  <R extends { id: string }>(r: R) => ({ ...r, ...by.get(r.id) });

/** Whether a stranger sees our sent comment: Live, Hidden (only we see it), Missing, Checking. */
export const PROOF_STATES = {
  live: { label: "Live", tone: "good", about: "Someone signed out sees it" },
  hidden: {
    label: "Hidden",
    tone: "warn",
    about: "We see it, strangers don't: a filter or a mod holds it",
  },
  missing: { label: "Missing", tone: "bad", about: "Gone even for us: removed or deleted" },
  pending: { label: "Checking", tone: "neutral", about: "Not read yet, or the read said nothing" },
} as const;

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

/** A row's state, as both lists say it. */
const STATES = status({
  new: { label: "New", tone: "warn" },
  waiting: { label: "Waiting on you", tone: "warn" },
  scheduled: { label: "Scheduled", tone: "good" },
  answered: { label: "Answered", tone: "good" },
  sent: { label: "Sent", tone: "good" },
  queued: neutral("Queued"),
  held: {
    label: "Held",
    tone: "warn",
    about:
      "The subreddit asks for more karma or an older account than ours has, or removed our last comment without saying why. It stays queued and sends itself once the rule is met.",
  },
  dropped: neutral("Dropped"),
  read: neutral("Read"),
  seen: neutral("Seen"),
  left: neutral("Left"),
});

type Row = Record<string, unknown>;
/** A Reddit thread queued for our comment. */
const threadItem = (t: Row) => ({
  id: `thread:${t.id}`,
  type: "thread",
  who: t.author,
  platform: "reddit",
  kind: "thread",
  // A sub whose karma or age rule we don't meet holds it: queued, never sent, never dropped.
  state: t.held ? "held" : t.send_at ? "scheduled" : "waiting",
  body: t.body || t.title,
  post_title: t.title,
  place: t.place ?? null,
  why: t.angle ?? null,
  held: t.held ?? null,
  draft: t.draft,
  account: t.account,
  at: t.posted_at,
  due: t.held ? t.posted_at : (t.send_at ?? t.posted_at),
  send_at: t.held ? null : (t.send_at ?? null),
  url: t.url,
});
/** Someone else's post with our comment drafted. */
const onPostItem = (l: Row) => ({
  id: `onpost:${l.id}`,
  type: "onpost",
  who: l.author,
  platform: l.platform,
  kind: "onpost",
  state: l.send_at ? "scheduled" : "waiting",
  body: l.text,
  post_title: null,
  why: l.why,
  draft: l.draft,
  account: l.account,
  at: l.at,
  due: l.send_at ?? l.queued_at ?? l.at,
  send_at: l.send_at ?? null,
  url: l.url,
});
/** A comment on our post or under our comment. */
const commentItem = (c: Row) => ({
  id: `comment:${c.id}`,
  type: "comment",
  who: c.who,
  platform: c.platform,
  kind: c.kind,
  channel: c.channel,
  state: c.state,
  body: c.body,
  post: c.post,
  post_title: c.post_title,
  place: c.place ?? null,
  draft: c.draft,
  account: c.account,
  at: c.at,
  due: c.at,
  sent: c.answered_at ?? null,
  url: c.url,
});
/** A DM thread; waiting when theirs is the last word. */
const dmItem = (d: Row) => ({
  id: `dm:${d.id}`,
  type: "dm",
  who: d.who,
  platform: d.platform,
  kind: "dm",
  // Reddit and LinkedIn DMs are reach's; the rest come through a connected account.
  channel: d.platform === "reddit" || d.platform === "linkedin" ? "reach" : "social",
  state: d.waiting === "waiting" ? "waiting" : "read",
  body: d.last_body,
  post_title: null,
  draft: d.draft,
  account: d.account,
  at: d.last_at,
  due: d.last_at,
  url: null,
});

/**
 * A send that may have gone out and no read could tell (designs/2026-10-16-maybe-sent.md): its
 * own row, over the queued one it came from (`thread:`, `onpost:`), which nothing sends meanwhile.
 */
const unsureItem = (u: SendAttempt, from: Row | undefined) => ({
  ...(from ?? {}),
  id: `unsure:${u.item}`,
  type: "unsure",
  who: from?.who ?? u.target,
  platform: u.platform,
  kind: "unsure",
  state: "waiting",
  body: u.words,
  draft: null,
  unsure: u.why,
  account: u.account,
  at: u.updatedAt,
  due: u.updatedAt,
  send_at: null,
  on_site: u.url,
});
/** Rows an unsure send stands in for leave the list; its own row takes their place. */
const unsureOver = (us: SendAttempt[], rows: Row[]): Row[] => {
  const by = new Map(rows.map((r) => [String(r.id), r]));
  return us.map((u) => unsureItem(u, by.get(u.item)));
};
const notParked = (us: SendAttempt[]) => {
  const parked = new Set(us.map((u) => u.item));
  return (r: Row) => !parked.has(String(r.id));
};

/**
 * What other people sent us, as one list. Ids carry their type (`comment:12`, `dm:5`, `email:4`
 * (a call invite), `reply:6` (a reply with none), `text:8`, `chat:3`, `activity:9`); each action reads the
 * id after the colon. `due` orders "Waiting on you": when it came.
 */
/** Our own post as a context view heads it: its words, link and picture when it is a link. */
const ourPostOf = (db: Queryable) => async (platform: string, post: string) => {
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
    const ms = await mailRows(db);
    const hs = await chatRows(db);
    const kept = await threadStates(db);
    const now = new Date();
    // The team's state on each: who has it, open, waiting, closed or snoozed.
    const team = (r: Record<string, unknown>) => {
      const k = kept.get(String(r.id));
      return {
        ...r,
        status: statusOf({ state: r.state, at: r.at }, k, now),
        assignee: k?.assignee ?? null,
        snooze: k?.snoozeUntil && k.snoozeUntil > now ? k.snoozeUntil : null,
      };
    };
    const all: Record<string, unknown>[] = [
      ...cs.map(commentItem),
      ...ds.map(dmItem),
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
    return all.map(team);
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
    assignee: actor("Assignee"),
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
    platform: status(PLATFORM_LABELS, "Site"),
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
    account: accountField("On"),
    mailbox: text("Mailbox"),
    at: date("When"),
    due: date("Due"),
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
    if (["activity", "email", "reply", "mail", "outbound"].includes(type)) return { conversation };
    const ask = {
      ask: await draftTurns(db, type, rest),
      record: await recordOfPage(db, type, rest),
      accounts: await accountPickFor(db, id),
      conversation,
      // The post and every reply under it, nested (designs/2026-10-15-engage-threads.md).
      ...(type === "comment"
        ? { context: await threadContextOf(db, Number(rest), ourPostOf(db)) }
        : {}),
    };
    return type === "dm" ? { ...(await dmRecord.load?.(db, rest)), ...ask } : ask;
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
  url: r.thread.startsWith("outbound:") ? null : `/inbox/waiting/${encodeURIComponent(r.thread)}`,
});

/**
 * What we'd send, waiting on William's yes, as one list. Ids carry their type (`draft:3`,
 * `video:2` (rendered, waiting on Approve), `thread:abc`, `invite:7` (accepted), `connect:7` (a
 * proposed invite, by contact), `onpost:9` (a comment drafted on someone else's post),
 * `template:4:3` (version 3 asked to go live)); each action reads the id after the colon. `due` orders "Waiting on you": a
 * draft's slot, else when it came.
 */
/** To approve; a post draft's fields come with it, its stored files signed by `signer`. */
export const approvalRecordOf = (signer?: VideoSigner) =>
  defineRecord({
    id: "marketing.approval",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "item to approve", many: "items to approve" },
    rows: async (db) => {
      const ps = await draftRows(db);
      const vs = await videoRows(db);
      const ts = ((await threadRecord.rows?.(db)) ?? []).filter((t) => t.state === "queued");
      const is = await acceptedRows(db);
      const cs = await connectRows(db);
      const ls = await onPostRows(db);
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
      const sends = [...ts.map(threadItem), ...ls.map(onPostItem)];
      return [
        // A send that may have gone out: he checks the site, marks it posted or sends it again.
        ...unsureOver(uss, sends),
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
          url: `/marketing/videos/${v.id}`,
        })),
        ...ts.map(threadItem).filter(notParked(uss)),
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
        ...ls.map(onPostItem).filter(notParked(uss)),
        ...cs.map((c) => ({
          id: `connect:${c.id}`,
          type: "connect",
          who: c.who,
          platform: "linkedin",
          kind: "connect",
          state: "waiting",
          body: c.why ?? c.headline,
          post_title: c.company,
          why: c.why,
          // Its note: drafted while the month's free notes last; empty sends it bare.
          draft: c.note || null,
          account: c.account,
          at: c.at,
          due: c.at,
          url: c.url,
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
          url: `/sites/pages/${p.id}`,
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
          url: `/sites/pages/${p.id}`,
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
          url: `/payments/links/${p.id}?client=${encodeURIComponent(p.client)}`,
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
          url: `/documents/all/${d.id}?client=${encodeURIComponent(d.client)}`,
        })),
        // Money in by bank transfer that BillingWatch wouldn't put on an invoice by itself.
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
          url: `/money/payments-in/${c.id}`,
        })),
      ];
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
        cued({ ...PLATFORM_LABELS, email: neutral("Email"), sms: neutral("Texts") }),
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
      state: STATES,
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
      account: accountField("On"),
      askedBy: text("Asked by"),
      unsure: text("Why we're unsure"),
      at: date("When"),
      due: date("Due"),
      url: link("Open"),
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
    }, signer),
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
        accounts: await accountPickFor(db, id),
      };
      if (type === "draft") return { shape: await shapeView(db, rest, signer), ...ask };
      return type === "invite" ? { ...(await dmRecord.load?.(db, rest)), ...ask } : ask;
    },
  });
export const approvalRecord = approvalRecordOf();

/**
 * Marketing → Engage: every reply he might write, in one queue. Reddit threads and others' posts
 * with our comment drafted (as To approve has them), comments on ours and DMs (as the Inbox has
 * them). Each row keeps its own page's actions; links he pastes land here too (`ReachDesk.paste`).
 */
/** Engage; a sent comment's shot signed by `signer`. */
export const engageRecordOf = (signer?: VideoSigner) =>
  defineRecord({
    id: "marketing.engage",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "reply", many: "replies" },
    rows: async (db) => {
      const ts = ((await threadRecord.rows?.(db)) ?? []).filter((t) => t.state === "queued");
      const ls = await onPostRows(db);
      const cs = (await commentRecord.rows?.(db)) ?? [];
      const ds = (await dmRecord.rows?.(db)) ?? [];
      const ss = await sentRows(db);
      const proved = withProof(await proofsBy(db, signer));
      // A send that may have gone out waits in To approve, not here.
      const parked = notParked(await unsureSends(db));
      return [
        ...ts.map(threadItem).filter(parked),
        ...ls.map(onPostItem).filter(parked),
        ...cs.map(commentItem).map(proved),
        ...ds.map(dmItem),
        ...ss.map((r) =>
          proved({ ...r, id: String(r.id), kind: r.type, state: "sent", due: r.sent }),
        ),
      ];
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
          dm: neutral("DM"),
        }),
        "Type",
      ),
      platform: status(PLATFORM_LABELS, "Site"),
      state: STATES,
      body: prose("Their words"),
      postTitle: text("Post"),
      place: text("Where"),
      why: text("Picked for"),
      held: text("Held because"),
      draft: prose("Our draft"),
      account: accountField("On"),
      at: date("When"),
      due: date("Due"),
      sendAt: date("Sends"),
      sent: date("Sent"),
      proof: status(PROOF_STATES, "Proof"),
      proofNote: text("Proof note"),
      proofAt: date("Checked"),
      proofUrl: link("Permalink", { listed: false }),
      proofShot: link("Screenshot", { listed: false }),
      url: link("Open"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: INBOX_WAITING,
        sort: "due",
        at: "due",
        hint: "Everything with a reply, comment or DM drafted for your yes, most overdue first",
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
      // People talking to us: comments on our posts and DMs.
      {
        id: "inbound",
        label: "Replies + DMs",
        where: { type: ["comment", "dm"] },
        sort: "-at",
        at: "at",
        hint: "Comments on our posts and DMs, newest first",
      },
      // What we write on others' ground: Reddit threads and their posts.
      {
        id: "outbound",
        label: "Our comments",
        where: { type: ["thread", "onpost"], state: ["waiting", "scheduled", "held"] },
        sort: "due",
        at: "due",
        hint: "Comments we write on Reddit threads and on other people's posts, due soonest first",
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
      {
        id: "ours",
        label: "On our posts",
        where: { type: "comment" },
        sort: "-at",
        at: "at",
        hint: "Comments people left on our posts, newest first",
      },
      {
        id: "dms",
        label: "DMs",
        where: { type: "dm" },
        sort: "-at",
        at: "at",
        hint: "Direct messages to and from us, newest first",
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
      "marketing.commentAnswer",
      "marketing.threadReply",
      "marketing.threadRead",
      "marketing.commentDm",
      "marketing.commentDrop",
      "marketing.dmReply",
      "marketing.dmRead",
      "marketing.messageFrom",
      "marketing.pass",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
    ],
    /** Comments and DMs as the Inbox opens them; threads and posts as To approve does. */
    load: async (db, id) => {
      const [type] = typed(id);
      const from = type === "comment" || type === "dm" ? inboxRecord : approvalRecord;
      return (await from.load?.(db, id)) ?? null;
    },
  });
export const engageRecord = engageRecordOf();

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
const EXPLORE_ROWS = 150;

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
    platform: status(PLATFORM_LABELS, "Site"),
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
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "reply to approve", many: "replies to approve" },
  rows: async (db) => [
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
      url: `/marketing/inbox/${encodeURIComponent(r.thread)}`,
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
      }),
      "Reply by",
    ),
    state: STATES,
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
  ],
  calls: { "InboxDesk/approve": "id", "InboxDesk/drop": "id" },
  /** The conversation it answers. */
  load: async (db, id) => {
    const [type, rest] = typed(id);
    if (type === "broadcast") return null;
    const [r] = (await db.execute(
      sql`select thread from inbox_replies where id = ${Number(rest)}`,
    )) as unknown as Array<{ thread: string }>;
    return r ? { conversation: await conversationOf(db, r.thread) } : null;
  },
});

/** Followers per platform: the newest day kept, and the change from a week before it. */
export const audienceRecord = defineRecord({
  id: "marketing.audience",
  app: "marketing",
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
export const socialRecords = (signer?: VideoSigner) => [
  inboxRecord,
  approvalRecordOf(signer),
  engageRecordOf(signer),
  exploreRecord,
  doneRecord,
  adFormatRecord,
  keywordRecord,
  keywordHitRecord,
  activityRecord,
  audienceRecord,
];
export const SOCIAL_RECORDS = socialRecords();
