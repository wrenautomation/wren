/**
 * Outbound's rows on the console's lists (designs/2026-11-02-starling.md, R3): comments on our
 * posts and DM threads as the Inbox shows them; queued Reddit threads and others' posts (with
 * their picks), accepted invites and proposed invites as To approve shows them; what we sent,
 * with its proof, for Engage. The lists that hold them are inbound's (`socialRecordsOf`) and
 * take these as `reach`; the app composes.
 */
import type { Queryable } from "@wren/db";
import { type ConsoleRow as Row, withPicks } from "@wren/starling-acts";
import type { MediaHost } from "@wren/starling-core";
import { sql } from "drizzle-orm";
import { invitedSql } from "./invites.js";
import { commentRecord, dmRecord, threadRecord } from "./records.js";

/** ponytail: rows, not a view: a few hundred unseen rows at most; a view past that. */
const LIST_ROWS = 500;

const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

/** A Reddit thread queued for our comment. */
export const threadItem = (t: Row): Row => ({
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
export const onPostItem = (l: Row): Row => ({
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
export const commentItem = (c: Row): Row => ({
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
export const dmItem = (d: Row): Row => ({
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
/** An accepted invite nobody wrote to yet. */
const inviteItem = (i: Row): Row => ({
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
});
/** A LinkedIn invite the sweep proposed. */
const connectItem = (c: Row): Row => ({
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
});

/** Accepted invites nobody wrote to yet: no message either way past the invite. A connection
 * made on the site (no invite of ours) is no invite record. */
const acceptedRows = (db: Queryable) =>
  rowsOf(
    db,
    sql`select c.id, coalesce(c.name, c.handle) who, c.headline, c.connected_at at, c.draft, c.url,
        coalesce(da.account, a.account) account,
        (c.read_at is null or c.read_at < c.connected_at) unread
      from reach_contacts c left join reach_accounts a on a.id = c.account_id
      left join draft_accounts da on da.item = 'invite:' || c.id
      where c.connected_at is not null and c.state not in ('opted_out', 'blocked')
        and ${invitedSql(sql`c.id`)}
        and not exists (select 1 from reach_messages m where m.contact_id = c.id
          and (m.direction = 'in' or m.kind <> 'connect'))
      order by c.connected_at desc limit ${LIST_ROWS}`,
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
      order by m.id limit ${LIST_ROWS}`,
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
      order by p.fit desc nulls last, p.id limit ${LIST_ROWS}`,
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
      ) s order by sent desc limit ${LIST_ROWS}`,
  );

/**
 * Each sent comment's last proof (designs/2026-10-14-comment-proof.md), by item: whether a
 * stranger sees it, when that was read, its permalink and shot (signed by `host`).
 */
async function proofsBy(db: Queryable, host?: MediaHost) {
  const rows = await rowsOf(
    db,
    sql`select item, state, note, url, shot, checked_at from comment_proofs
      order by checked_at desc limit ${LIST_ROWS * 2}`,
  );
  const sign = async (shot: unknown) =>
    typeof shot === "string" && shot && host ? host.host(shot).catch(() => null) : null;
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

/** Queued Reddit threads as rows. */
const queuedThreads = async (db: Queryable) =>
  ((await threadRecord.rows?.(db)) ?? []).filter((t) => t.state === "queued").map(threadItem);

/** Comments on our posts and DM threads, as the Inbox lists them. */
export const reachInboxItems = async (db: Queryable): Promise<Row[]> => [
  ...((await commentRecord.rows?.(db)) ?? []).map(commentItem),
  ...((await dmRecord.rows?.(db)) ?? []).map(dmItem),
];

/**
 * To approve's reach rows: queued threads and others' posts with their picks, accepted invites
 * and proposed invites. A send that may have gone out is the list's to lay over (`unsureOver`).
 */
export const reachApprovalItems = async (db: Queryable): Promise<Row[]> => [
  ...(await withPicks(db, [
    ...(await queuedThreads(db)),
    ...(await onPostRows(db)).map(onPostItem),
  ])),
  ...(await acceptedRows(db)).map(inviteItem),
  ...(await connectRows(db)).map(connectItem),
];

/**
 * Engage's rows: queued threads and posts, our answers under comments and what went out, each
 * sent one with its proof. A send that may have gone out is the list's to drop (`notParked`).
 */
export const reachEngageItems = async (db: Queryable, host?: MediaHost): Promise<Row[]> => {
  const proved = (r: Row) => ({ ...r, ...by.get(String(r.id)) });
  const by = await proofsBy(db, host);
  const answered = ((await commentRecord.rows?.(db)) ?? [])
    .filter((c) => c.state === "answered")
    .map(commentItem);
  return withPicks(db, [
    ...(await queuedThreads(db)),
    ...(await onPostRows(db)).map(onPostItem),
    ...answered.map(proved),
    ...(await sentRows(db)).map((r) =>
      proved({ ...r, id: String(r.id), kind: r.type, state: "sent", due: r.sent }),
    ),
  ]);
};

/** A DM thread's or an accepted invite's own page (its messages); null for any other kind. */
export const reachLoad = async (db: Queryable, id: string): Promise<Row | null> => {
  const at = id.indexOf(":");
  const [type, rest] = [id.slice(0, at), id.slice(at + 1)];
  if (type !== "dm" && type !== "invite") return null;
  return ((await dmRecord.load?.(db, rest)) as Row | null | undefined) ?? null;
};

/** What outbound lays on the console's lists, as inbound's `ReachItems` port takes it. */
export const reachItems = {
  inbox: reachInboxItems,
  approval: reachApprovalItems,
  load: reachLoad,
};
