/**
 * DMs as console records for the Marketing app: each person's thread (`marketing.dm`), each
 * template slot William writes (`marketing.dm_copy`), with what the preview needs to draw them,
 * each comment on our posts (`marketing.comment`), each LinkedIn invite (`marketing.invite`), and
 * the people we can write to from Marketing → People (`marketing.person`).
 */

import { warmupOf } from "@wren/channel-reddit";
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
  type RecordFold,
  score,
  status,
  text,
} from "@wren/core/records";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { accountById, listAccounts, recordAccountsOf, viewOf } from "./accounts.js";
import { personLine } from "./discovery/people.js";
import { movePlace } from "./discovery/places.js";
import { gatesFor, holdsThread } from "./discovery/requirements.js";
import { commentsToday } from "./discovery/threads.js";
import { accountPickFor, pickedAccounts, pickedReachAccount } from "./draft-accounts.js";
import { threadContextOf } from "./follow-ups.js";
import { VANITY } from "./invites.js";
import { DEFAULT_POLICY, type ReachPolicy } from "./policy.js";
import { type DmPlatform, type PlaceJudged, type RedditPerson, redditPeople } from "./schema.js";
import {
  MESSAGE_MAX,
  REACH_SEQUENCES,
  type RenderFields,
  sampleFields,
  slotsOf,
} from "./sequences.js";
import { listTemplates } from "./store.js";
import { getThread, listThreads } from "./threads.js";
import { sentToday } from "./tick.js";

/** ponytail: rows, not a view: reach holds a few hundred threads at most; a view past that. */
const THREAD_ROWS = 500;
const SITES: Record<DmPlatform, string> = {
  reddit: "Reddit",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};
/** Where a template's words go in its message. */
const SLOT = "WRENSLOT";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

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

export const dmRecord = defineRecord({
  id: "marketing.dm",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "DM thread", many: "DM threads" },
  rows: async (db) => {
    const threads = await listThreads(db, { limit: THREAD_ROWS });
    const reddit = threads.flatMap((t) =>
      t.contact.platform === "reddit" ? [t.contact.handle.toLowerCase()] : [],
    );
    // A Reddit contact has no headline; who they are comes from their read profile.
    const about = new Map(
      (reddit.length
        ? await db.select().from(redditPeople).where(inArray(redditPeople.handle, reddit))
        : []
      ).map((p) => [p.handle, personLine(p)]),
    );
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
    waiting: status({ waiting: { label: "Unread", tone: "warn" }, read: neutral("Read") }, "Read"),
    draft: prose("Draft reply"),
  },
  views: [
    {
      id: "waiting",
      label: "Unread",
      where: { waiting: "waiting" },
      sort: "-lastAt",
      at: "lastAt",
    },
    { id: "replied", label: "Replied", where: { state: "replied" }, sort: "-lastAt", at: "lastAt" },
    { id: "all", label: "All", sort: "-lastAt", at: "lastAt" },
  ],
  activity: { view: "draft_activity", by: "contact", seq: "seq" },
  drafts: (id) => draftItemsOf("dm", id),
  actions: [
    "marketing.dmReply",
    "marketing.dmRead",
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
      accounts: await accountPickFor(db, `dm:${id}`),
      ask: await draftTurns(db, "dm", id),
      record: await recordOfPage(db, "dm", id),
    };
  },
});

/** Every platform's names, for a comment from any of them. */
export const PLATFORM_LABELS = cued({
  reddit: neutral("Reddit"),
  linkedin: neutral("LinkedIn"),
  youtube: neutral("YouTube"),
  x: neutral("X"),
  instagram: neutral("Instagram"),
  facebook: neutral("Facebook"),
  tiktok: neutral("TikTok"),
  google_business: neutral("Business Profile"),
});

/**
 * Comments on our posts and under our comments, every platform, newest first: a reach account's
 * inbox (the account that read it) or our own post (`content`, answered by `Content.reply`).
 */
export const commentRecord = defineRecord({
  id: "marketing.comment",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "comment", many: "comments" },
  rows: async (db) =>
    (
      (await db.execute(sql`
      select c.id, c.author who, c.platform, c.channel, c.kind, c.place, c.post, c.post_title, c.body,
        c.sort, c.why, c.draft, c.state, c.answer, c.at, c.answered_at, c.url,
        coalesce(da.account, a.account) account,
        c.contact_id, p.read p_read, p.fit p_fit, p.site p_site,
        -- The way into their DMs (dmDoorOf): the button shows only where there is one.
        case when c.account_id is not null then 'reach'
          when c.platform in ('instagram', 'facebook') then 'private_reply' end door
      from comments c left join reach_accounts a on a.id = c.account_id
      left join draft_accounts da on da.item = 'comment:' || c.id
      left join reddit_people p on c.platform = 'reddit' and p.handle = lower(c.author)
      order by c.at desc limit ${THREAD_ROWS}`)) as unknown as Array<Record<string, unknown>>
    ).map(({ p_read, p_fit, p_site, ...r }) => ({
      ...r,
      about: personLine({
        read: p_read as RedditPerson["read"],
        fit: p_fit as number | null,
        site: p_site as string | null,
      }),
    })),
  key: "id",
  title: "who",
  account: "account",
  subtitle: "body",
  fold: COMMENT_FOLD,
  fields: {
    who: name("Who"),
    about: text("Who they are"),
    platform: status(PLATFORM_LABELS, "Site"),
    channel: status(
      cued({ reach: neutral("Reach account"), content: neutral("Our post") }),
      "Where",
    ),
    kind: status(cued(COMMENT_KIND_LABELS), "Kind"),
    door: status(
      { reach: neutral("From the reach account"), private_reply: neutral("Reply to the comment") },
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
    accounts: await accountPickFor(db, `comment:${id}`),
    ask: await draftTurns(db, "comment", id),
    record: await recordOfPage(db, "comment", id),
    context: await threadContextOf(db, Number(id)),
  }),
});

/** The slots and their words; the preview fills `{fields}` with `sender` and sample facts. */
export function dmCopyRecord(sender: string) {
  const slots = slotsOf(REACH_SEQUENCES.values());
  const sample: RenderFields = sampleFields(sender);
  return defineRecord({
    id: "marketing.dm_copy",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "DM template", many: "DM templates" },
    rows: async (db) =>
      (await listTemplates(db, slots, sender)).map((v) => ({
        id: v.key,
        purpose: v.purpose,
        platform: v.platform,
        body: v.body,
        filled: v.body ? "filled" : "empty",
        chars: v.body.length,
        max: v.maxLength,
        fields: `${v.fields.map((f) => `{${f}}`).join(" ")}; {field|fallback} when it may be empty`,
        updated_at: v.updatedAt,
        updated_by: v.updatedBy,
      })),
    key: "id",
    title: "purpose",
    subtitle: "body",
    fields: {
      purpose: text("Slot"),
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
      body: prose("Your words"),
      filled: status(
        { filled: { label: "Written", tone: "good" }, empty: neutral("Empty: never goes") },
        "State",
      ),
      chars: number("Characters"),
      max: number("At most"),
      fields: text("Fields it may use"),
      updatedAt: date("Saved"),
      updatedBy: text("By"),
    },
    // No sort: key order, each platform's slots together.
    views: [
      { id: "all", label: "All" },
      { id: "empty", label: "Empty", where: { filled: "empty" } },
    ],
    actions: ["marketing.dmCopy"],
    /** The whole message around this slot: a subject slot sits on its step's words, and back. */
    load: async (db, id) => {
      const all = await listTemplates(db, slots, sender);
      const slot = all.find((v) => v.key === id);
      if (!slot) return null;
      const subject = id.endsWith(".subject");
      const other = all.find((v) => v.key === (subject ? id.slice(0, -8) : `${id}.subject`));
      const [account] = await listAccounts(db, slot.platform);
      return {
        sample,
        dm: {
          site: SITES[slot.platform],
          from: account?.handle ?? null,
          // A subject's cap is checked on save; the count shown is the message's.
          max: (subject ? other : slot)?.maxLength ?? slot.maxLength,
          frame: subject
            ? { subject: SLOT, body: other?.preview ?? "", slot: SLOT }
            : { subject: other?.preview || null, body: SLOT, slot: SLOT },
        },
      };
    },
  });
}

const yesNo = (b: unknown) => (b === true ? "yes" : b === false ? "no" : "?");

/** Subreddits found for Reddit discovery, as judged, with what a post needs there. */
export const placeRecord = defineRecord({
  id: "marketing.place",
  app: "marketing",
  channel: "reddit",
  name: { one: "place", many: "places" },
  rows: async (db) => {
    const gates = await gatesFor(db, null, new Date());
    return (
      (await db.execute(sql`
      select p.subreddit id, 'r/' || p.name place, p.fit, p.judged, p.subscribers, p.found_by,
        p.state, a.account account, p.read_at, p.raw->>'error' error,
        count(t.*) filter (where t.state = 'commented') commented,
        round(avg(t.score) filter (where t.score is not null), 1) avg_score
      from reddit_places p
      left join reach_accounts a on a.id = p.account_id
      left join reddit_threads t on t.subreddit = p.subreddit
      group by p.subreddit, a.account
      order by p.fit desc nulls last, p.subscribers desc nulls last
      limit ${THREAD_ROWS}`)) as unknown as Array<Record<string, unknown>>
    ).map(({ judged, ...r }) => {
      const j = judged as Partial<PlaceJudged> | null;
      const gate = gates.get(String(r.id));
      return {
        ...r,
        // Held: no account of ours meets the sub's karma or age rule yet.
        gate: gate && !gate.ok ? gate.reason : null,
        gated: gate && !gate.ok ? "held" : null,
        why: j?.why ?? r.error ?? null,
        rules: j?.rules ?? null,
        allows: j
          ? `Comments ${yesNo(j.mayComment)} · posts ${yesNo(j.mayPost)}${j.linkOnly ? " · links in profile only" : ""}${j.karmaMin ? ` · ${j.karmaMin} karma` : ""}${j.ageMinDays ? ` · ${j.ageMinDays}-day-old account` : ""}`
          : null,
        pace: j ? `${j.postsADay} posts a day, ${j.medianComments} comments each` : null,
        url: `https://www.reddit.com/${String(r.place)}/`,
      };
    });
  },
  key: "id",
  title: "place",
  account: "account",
  subtitle: "why",
  fields: {
    place: text("Subreddit"),
    fit: score("Fit", { max: 10 }),
    why: text("Why"),
    allows: text("Allows"),
    gated: status(
      {
        held: {
          label: "Held",
          tone: "warn",
          about:
            "No account of ours meets this subreddit's karma or age rule yet. Its comments stay queued and send once one does.",
        },
      },
      "Gate",
    ),
    gate: text("Held because"),
    rules: prose("Rules"),
    pace: text("Pace"),
    subscribers: number("Members"),
    state: status({
      found: { label: "Found", tone: "warn" },
      watching: { label: "Watching", tone: "good" },
      skipped: neutral("Skipped"),
    }),
    account: accountField("Account", { platforms: ["reddit"] }),
    commented: number("Our comments"),
    avgScore: number("Avg score"),
    foundBy: text("Found by"),
    readAt: date("Read"),
    url: link("Open"),
  },
  views: [
    { id: "found", label: "To pick", where: { state: "found" }, sort: "-fit" },
    { id: "watching", label: "Watching", where: { state: "watching" }, sort: "-fit" },
    // Subreddits whose karma or age rule we don't meet: the comments queue, none sends.
    { id: "held", label: "Held", where: { gated: "held" }, sort: "-fit" },
    { id: "all", label: "All", sort: "-fit" },
  ],
  actions: [
    "marketing.placeWatch",
    "marketing.placeSkip",
    "marketing.placeMove",
    "marketing.discoveryRead",
  ],
  // Reassign: pick another of our Reddit accounts in place; its threads go out from that one.
  edits: {
    fields: ["account"],
    patch: z
      .object({ account: z.string().trim().min(1).max(120) })
      .partial()
      .strict(),
    about: "which of our Reddit accounts comments in this subreddit",
    read: async (db, id) => {
      const [r] = (await db.execute(sql`
        select a.account from reddit_places p left join reach_accounts a on a.id = p.account_id
        where p.subreddit = ${id}`)) as unknown as Array<{ account: string | null }>;
      return r ? { account: r.account ?? "" } : null;
    },
    check: async (patch, _now, db) => {
      if (patch.account === undefined) return null;
      const a = (await listAccounts(db, "reddit")).find((x) => x.account === patch.account);
      if (!a) return `${String(patch.account)} is not one of our Reddit accounts`;
      return a.state === "retired" ? `${a.account} is retired` : null;
    },
    write: async (db, id, patch) => {
      if (patch.account !== undefined) await movePlace(db, id, String(patch.account));
    },
  },
});

/** New posts in watched places: ranked, the day's best queued with a draft. */
export const threadRecord = defineRecord({
  id: "marketing.thread",
  app: "marketing",
  channel: "reddit",
  name: { one: "thread", many: "threads" },
  rows: async (db) => {
    const gates = await gatesFor(db, null, new Date());
    return (
      (await db.execute(sql`
      select t.id, t.subreddit, 'r/' || t.subreddit place, t.title, t.body, t.author, t.kind, t.fit, t.angle,
        t.target_text, t.draft, t.sources, t.state, t.dropped, t.answer, t.score, t.comments,
        t.posted_at, t.send_at, t.url, coalesce(da.account, a.account) account, da.account is not null picked, p.read op_read, p.fit op_fit, p.site op_site
      from reddit_threads t
      left join reach_accounts a on a.id = t.account_id
      left join draft_accounts da on da.item = 'thread:' || t.id
      left join reddit_people p on p.handle = lower(t.author)
      where t.state <> 'dropped' or t.created_at > now() - interval '2 days'
      order by t.posted_at desc limit ${THREAD_ROWS}`)) as unknown as Array<Record<string, unknown>>
    ).map(({ op_read, op_fit, op_site, sources, subreddit, picked, ...r }) => {
      // Queued behind the sub's karma or age rule: the reason, and no slot. A picked account
      // sends anyway; the picker warned of its shortfall.
      const gate = r.state === "queued" ? gates.get(String(subreddit)) : undefined;
      const held = holdsThread(gate, Boolean(picked)) ? (gate?.reason ?? null) : null;
      return {
        ...r,
        held,
        ...(held ? { send_at: null } : {}),
        op: personLine({
          read: op_read as RedditPerson["read"],
          fit: op_fit as number | null,
          site: op_site as string | null,
        }),
        sources: Array.isArray(sources)
          ? (sources as { label: string; text: string }[])
              .map((s) => `${s.label}: ${s.text}`)
              .join("\n\n")
          : null,
      };
    });
  },
  key: "id",
  title: "title",
  account: "account",
  subtitle: "angle",
  fields: {
    place: text("Subreddit"),
    title: text("Post"),
    body: prose("Their words"),
    author: name("OP"),
    op: text("Who they are"),
    kind: status(
      {
        help: { label: "Asks for help", tone: "good" },
        tools: { label: "Asks for tools", tone: "good" },
        story: neutral("Story"),
        venting: neutral("Venting"),
        hiring: neutral("Hiring"),
        other: neutral("Other"),
      },
      "Kind",
    ),
    fit: score("Fit", { max: 10 }),
    angle: text("Angle"),
    targetText: prose("Answering"),
    draft: prose("Draft"),
    sources: prose("Read for the draft"),
    state: status({
      new: neutral("New"),
      ranked: neutral("Ranked"),
      queued: { label: "To answer", tone: "warn" },
      commented: { label: "Commented", tone: "good" },
      skipped: neutral("Skipped"),
      dropped: neutral("Dropped"),
    }),
    dropped: text("Dropped because"),
    held: text("Held because"),
    answer: prose("Our comment"),
    score: number("Score"),
    comments: number("Comments"),
    account: accountField("From", { platforms: ["reddit"] }),
    postedAt: date("Posted"),
    url: link("Open"),
  },
  views: [
    { id: "queued", label: "To answer", where: { state: "queued" }, sort: "-fit", at: "postedAt" },
    {
      id: "commented",
      label: "Commented",
      where: { state: "commented" },
      sort: "-postedAt",
      at: "postedAt",
    },
    { id: "all", label: "All", sort: "-postedAt", at: "postedAt" },
  ],
  activity: { view: "draft_activity", by: "thread", seq: "seq" },
  drafts: (id) => [`thread:${id}`],
  actions: [
    "marketing.threadComment",
    "marketing.threadSkip",
    "marketing.draftSet",
    "marketing.draftAsk",
    "marketing.draftUndo",
    "marketing.discoveryRead",
  ],
  /** Ask Claude's thread on the draft comment. */
  load: async (db, id) => ({
    accounts: await accountPickFor(db, `thread:${id}`),
    ask: await draftTurns(db, "thread", id),
    record: await recordOfPage(db, "thread", id),
  }),
});

/**
 * LinkedIn invites, one per contact: proposed (waiting on his yes), queued, pending, accepted,
 * withdrawn (`reach_invites`).
 */
export const inviteRecord = defineRecord({
  id: "marketing.invite",
  app: "marketing",
  channel: "linkedin",
  name: { one: "invite", many: "invites" },
  rows: async (db) =>
    (
      (await db.execute(sql`
      select i.contact_id id, coalesce(i.name, i.handle) who, i.headline, i.niche, i.status,
        i.state_reason, i.note, coalesce(da.account, a.account) account, i.queued_at, i.sent_at, i.connected_at, i.withdrawn_at,
        i.url, extract(day from coalesce(i.connected_at, i.withdrawn_at, now()) - i.sent_at)::int days,
        c.draft, i.fit->>'why' why, i.fit->>'company' company, i.fit->>'size' size
      from reach_invites i
      join reach_contacts c on c.id = i.contact_id
      left join reach_accounts a on a.id = i.account_id
      left join draft_accounts da on da.item = 'invite:' || i.contact_id
      order by coalesce(i.connected_at, i.withdrawn_at, i.sent_at, i.queued_at) desc
      limit ${THREAD_ROWS}`)) as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      ...r,
      days: r.sent_at ? r.days : null,
      // The campaign as the views name it (0072): "recruiting" is "Recruiting".
      niche: r.niche
        ? String(r.niche).charAt(0).toUpperCase() + String(r.niche).slice(1).replaceAll("_", " ")
        : null,
    })),
  key: "id",
  title: "who",
  account: "account",
  subtitle: "headline",
  fields: {
    who: name("Who"),
    headline: text(),
    niche: text("Campaign"),
    status: status({
      proposed: { label: "To approve", tone: "warn" },
      queued: neutral("To send"),
      pending: { label: "Pending", tone: "warn" },
      accepted: { label: "Accepted", tone: "good" },
      withdrawn: neutral("Withdrawn"),
      ended: neutral("Ended"),
      failed: { label: "Failed", tone: "bad" },
      unknown: { label: "Unknown", tone: "bad" },
      skipped: neutral("Skipped"),
    }),
    why: text("Picked for"),
    company: text("Company"),
    size: text("People"),
    stateReason: text("Why"),
    note: prose("Note"),
    account: accountField("From", { platforms: ["linkedin"] }),
    days: number("Days pending"),
    queuedAt: date("Queued"),
    sentAt: date("Sent"),
    connectedAt: date("Accepted"),
    withdrawnAt: date("Withdrawn"),
    url: link("On LinkedIn"),
    draft: prose("Draft message"),
  },
  views: [
    { id: "proposed", label: "To approve", where: { status: "proposed" }, sort: "queuedAt" },
    { id: "queued", label: "To send", where: { status: "queued" }, sort: "queuedAt" },
    { id: "pending", label: "Pending", where: { status: "pending" }, sort: "sentAt", at: "sentAt" },
    {
      id: "accepted",
      label: "Accepted",
      where: { status: "accepted" },
      sort: "-connectedAt",
      at: "connectedAt",
    },
    {
      id: "withdrawn",
      label: "Withdrawn",
      where: { status: ["withdrawn", "ended"] },
      sort: "-withdrawnAt",
    },
    { id: "all", label: "All", sort: "-queuedAt", at: "queuedAt" },
  ],
  activity: { view: "draft_activity", by: "contact", seq: "seq" },
  drafts: (id) => draftItemsOf("invite", id),
  actions: [
    "marketing.connectApprove",
    "marketing.connectSkip",
    "marketing.inviteMessage",
    "marketing.inviteRead",
    "marketing.inviteWithdraw",
    "marketing.draftSet",
    "marketing.draftAsk",
    "marketing.draftUndo",
  ],
  load: async (db, id) => ({
    accounts: await accountPickFor(db, `invite:${id}`),
    ask: await draftTurns(db, "invite", id),
    record: await recordOfPage(db, "invite", id),
  }),
});

/** ponytail: rows, not a view: the newest 1,000 of each; a view with search past that. */
const PEOPLE_ROWS = 1000;

/**
 * People we can write to without the platform: ours with a LinkedIn page (`li:<people.id>`),
 * Reddit people we read (`reddit:<handle>`), and anyone else a touch met (`<platform>:<handle>`,
 * designs/2026-10-07-touches.md). `can` says what's open: Message once a LinkedIn invite is
 * accepted (any Reddit user), Invite before. Touches lists every touch with them, newest first.
 */
export const personRecord = defineRecord({
  id: "marketing.person",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "person", many: "people" },
  rows: async (db) =>
    (await db.execute(sql`
      with tl as (select person, count(*)::int n, max(at) last from person_touch_lines group by person)
      (select 'li:' || p.id id, 'linkedin' platform, p.full_name who, p.title headline,
        co.name company, p.linkedin_url url, rc.state contact, rc.draft, p.created_at at,
        case when rc.state in ('opted_out', 'blocked') then 'stopped'
          when rc.connected_at is not null then 'message'
          when rc.id is null or rc.state = 'new' then 'invite' else 'invited' end can,
        coalesce(tl.n, 0) touches, tl.last touched,
        (select '/people/people/' || pk.profile_id from profile_keys pk
          where pk.kind = 'person' and pk.value = p.id::text) profile
      from people p
      join companies co on co.id = p.company_id
      left join reach_contacts rc on rc.platform = 'linkedin' and lower(rc.handle) = ${VANITY}
      left join tl on tl.person = 'li:' || p.id
      where p.linkedin_url ~* 'linkedin\\.com/in/[^/?#]+'
      order by p.id desc limit ${PEOPLE_ROWS})
      union all
      (select 'reddit:' || rp.handle, 'reddit', rp.name, rp.read #>> '{role,value}',
        rp.read #>> '{business,value}', 'https://www.reddit.com/user/' || rp.handle, rc.state,
        rc.draft, rp.read_at,
        case when rc.state in ('opted_out', 'blocked') then 'stopped' else 'message' end,
        coalesce(tl.n, 0), tl.last,
        (select '/people/people/' || pk.profile_id from profile_keys pk
          where pk.kind = 'handle:reddit' and pk.value = rp.handle)
      from reddit_people rp
      left join reach_contacts rc on rc.platform = 'reddit' and lower(rc.handle) = rp.handle
      left join tl on tl.person = 'reddit:' || rp.handle
      order by rp.read_at desc limit ${PEOPLE_ROWS})
      union all
      (select h.platform || ':' || h.handle, h.platform, coalesce(p.full_name, h.name, h.handle),
        p.title, co.name, h.url, rc.state, rc.draft, h.created_at,
        case when rc.state in ('opted_out', 'blocked') then 'stopped'
          when h.platform = 'reddit' then 'message'
          when h.platform <> 'linkedin' or h.handle like '%:%' then null
          when rc.connected_at is not null then 'message'
          when rc.id is null or rc.state = 'new' then 'invite' else 'invited' end,
        coalesce(tl.n, 0), tl.last,
        (select '/people/people/' || pk.profile_id from profile_keys pk
          where (pk.kind, pk.value) in (('person', h.person_id::text),
            ('handle:' || h.platform, h.handle)) limit 1)
      from social_handles h
      left join people p on p.id = h.person_id
      left join companies co on co.id = p.company_id
      left join reach_contacts rc on rc.platform = h.platform and lower(rc.handle) = h.handle
      left join tl on tl.person = h.platform || ':' || h.handle
      where not (h.platform = 'reddit'
          and exists (select 1 from reddit_people rp where rp.handle = h.handle))
        and not (p.linkedin_url is not null and p.linkedin_url ~* 'linkedin\\.com/in/[^/?#]+')
      order by h.created_at desc limit ${PEOPLE_ROWS})`)) as unknown as Array<
      Record<string, unknown>
    >,
  key: "id",
  title: "who",
  subtitle: "headline",
  fields: {
    who: name("Who"),
    headline: text(),
    company: text("Company"),
    platform: status(
      cued({
        reddit: neutral("Reddit"),
        linkedin: neutral("LinkedIn"),
        x: neutral("X"),
        instagram: neutral("Instagram"),
        youtube: neutral("YouTube"),
        facebook: neutral("Facebook"),
        tiktok: neutral("TikTok"),
        google_business: neutral("Business Profile"),
      }),
      "Site",
    ),
    can: status(
      {
        message: { label: "Can message", tone: "good" },
        invite: neutral("Can invite"),
        invited: neutral("Invited"),
        stopped: { label: "Asked to stop", tone: "warn" },
      },
      "Open to",
    ),
    contact: text("In reach"),
    draft: prose("Draft message"),
    touches: number("Touches"),
    touched: date("Last touch"),
    at: date("Added"),
    url: link("Their page"),
    profile: link("Profile"),
  },
  views: [
    { id: "message", label: "Can message", where: { can: "message" }, sort: "-at", at: "at" },
    { id: "invite", label: "Can invite", where: { can: "invite" }, sort: "-at", at: "at" },
    {
      id: "touched",
      label: "Touched",
      where: { touches: { gte: 1 } },
      sort: "-touched",
      at: "touched",
    },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  activity: {
    view: "person_touch_lines",
    by: "person",
    seq: "seq",
    label: "Touches",
    empty: "Follows, invites, comments, replies and DMs with them, on every site, show here.",
  },
  actions: [
    "marketing.personDraft",
    "marketing.personMessage",
    "marketing.personInvite",
    "marketing.personFollow",
  ],
});

const ACCOUNT_STATES = {
  active: { label: "Active", tone: "good" as const },
  warming: { label: "Warming up", tone: "warn" as const },
  paused: { label: "Paused", tone: "bad" as const },
  retired: neutral("Retired"),
  // A login we post or read with that has no reach row (`x@wren` on others' posts).
  login: neutral("Posting login"),
};
const HEALTH_STATES = {
  ok: { label: "Fine", tone: "good" as const },
  frozen: { label: "Frozen", tone: "bad" as const },
  suspended: { label: "Suspended", tone: "bad" as const },
  unread: { label: "Not read yet", tone: "warn" as const },
};

/**
 * Every account we speak as, one place (designs/2026-10-15-accounts-first-class.md): its state,
 * health and warm-up, karma and age, what it sent today against its caps, the subreddits it
 * comments in and when it last sent. Read from the database only: health is the last stored
 * read, never a platform call. Its places, threads and replies open from the record.
 */
export const accountRecordOf = (policy: ReachPolicy = DEFAULT_POLICY) =>
  defineRecord({
    id: "marketing.account",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "account", many: "accounts" },
    rows: async (db) => {
      const now = new Date();
      const reach = await listAccounts(db);
      const all = await recordAccountsOf(db);
      const ids = reach.map((a) => a.id);
      const today = ids.length ? await sentToday(db, ids, now) : new Map();
      const places = (await db.execute(sql`
        select a.account, string_agg('r/' || p.name, ', ' order by p.name) places,
          count(*)::int n
        from reddit_places p join reach_accounts a on a.id = p.account_id
        where p.state = 'watching' group by a.account`)) as unknown as Array<{
        account: string;
        places: string;
        n: number;
      }>;
      const placeBy = new Map(places.map((p) => [p.account, p]));
      const last = (await db.execute(sql`
        select account, max(at) at from (
          select a.account, m.sent_at at from reach_messages m
            join reach_accounts a on a.id = m.account_id
            where m.direction = 'out' and m.sent_at is not null
          union all select a.account, c.answered_at from comments c
            join reach_accounts a on a.id = c.account_id where c.answered_at is not null
          union all select a.account, t.answered_at from reddit_threads t
            join reach_accounts a on a.id = t.account_id where t.answered_at is not null
          union all select account, commented_at from reach_posts where commented_at is not null
        ) s group by account`)) as unknown as Array<{ account: string; at: Date | string }>;
      const lastBy = new Map(last.map((r) => [r.account, new Date(r.at).toISOString()]));
      const byKey = new Map(reach.map((a) => [a.account, a]));
      return await Promise.all(
        all.map(async (k) => {
          const a = byKey.get(k.key);
          const base = {
            id: k.key,
            name: k.label,
            account: k.key,
            platform: k.platform,
            places: placeBy.get(k.key)?.places ?? null,
            placeCount: placeBy.get(k.key)?.n ?? 0,
            lastSent: lastBy.get(k.key) ?? null,
          };
          if (!a) return { ...base, state: "login" };
          const v = viewOf(a, policy, now);
          const h = v.health;
          const w = a.platform === "reddit" && h ? warmupOf(h, now) : null;
          const sent = today.get(a.id) ?? { connects: 0, messages: 0 };
          const used =
            a.platform === "reddit"
              ? `${await commentsToday(db, a.id, now)} of ${w?.caps.comments ?? 0} comments · ${sent.messages} of ${v.standing.caps.messages} DMs`
              : `${sent.connects} of ${v.standing.caps.connects} invites · ${sent.messages} of ${v.standing.caps.messages} messages`;
          return {
            ...base,
            reachId: a.id,
            state: a.state,
            why: a.pausedReason ?? null,
            // Only Reddit's standing is read; elsewhere there is nothing to say.
            health: h?.suspended
              ? "suspended"
              : v.standing.frozen && h
                ? "frozen"
                : h
                  ? "ok"
                  : a.platform === "reddit"
                    ? "unread"
                    : null,
            stage: v.standing.frozen
              ? `${v.standing.stage}: ${v.standing.frozen}`
              : v.standing.stage,
            karma: h?.karma ?? null,
            ageDays: w?.ageDays ?? null,
            today: used,
            healthAt: h?.asOf ?? null,
            since: a.startedOn,
          };
        }),
      );
    },
    key: "id",
    title: "name",
    account: "account",
    subtitle: "stage",
    fields: {
      name: name("Account"),
      // The login's key, drawn as its badge: the Account filter's field.
      account: accountField("Login", { listed: false }),
      platform: status(PLATFORM_LABELS, "Site"),
      state: status(ACCOUNT_STATES, "State"),
      health: status(HEALTH_STATES, "Health"),
      stage: text("Warm-up"),
      karma: number("Karma"),
      ageDays: number("Age in days"),
      today: text("Sent today"),
      placeCount: number("Places"),
      places: text("Subreddits"),
      lastSent: date("Last sent"),
      healthAt: date("Health read"),
      why: text("Paused because"),
      since: text("Started", { listed: false }),
      reachId: text("Reach id", { listed: false }),
    },
    views: [
      {
        id: "live",
        label: "In use",
        where: { state: ["active", "warming", "paused"] },
        sort: "platform",
      },
      { id: "all", label: "All", sort: "platform" },
    ],
    // Its places (reassigned there, in place), its threads and its replies, filtered to it.
    related: [
      { record: "marketing.place", by: "account" },
      { record: "marketing.thread", by: "account" },
      { record: "marketing.engage", by: "account" },
    ],
  });
export const accountRecord = accountRecordOf();
