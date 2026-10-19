/**
 * Comments as an event source (designs/2026-10-01-reach-reddit-linkedin.md, Comments). Each
 * account's inbox is read with its DMs; every new comment on our posts or under our comments is a
 * row and one `comment` event on the spine. `comments.sort` reads it: clear words in code for $0,
 * a model for the rest, which also drafts an answer when they asked something. William answers,
 * DMs or drops each one from the Replies queue; nothing goes out without his click.
 */

import { warmupOf } from "@wren/channel-reddit";
import { editsFor } from "@wren/core/ask";
import { llmOf, type RejectReason, recordDraft } from "@wren/core/draft-record";
import { factsBlock, humanBlock } from "@wren/core/facts";
import { guardDraft, recordGuard } from "@wren/core/grounded";
import { isVendorStop } from "@wren/core/metered";
import type { CommentIn, OutreachChannel } from "@wren/core/outreach";
import { modelDrafts } from "@wren/core/reply-drafts";
import { whereSent } from "@wren/core/sent-url";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db, Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, type Outcome } from "@wren/llm";
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { addProspects, contactByHandle } from "./contacts.js";
import { commentsToday } from "./discovery/threads.js";
import { pickedReachAccount } from "./draft-accounts.js";
import { armMeta, guardBy, modelFor } from "./draft-llm.js";
import { COMMENT_KINDS_LEARNED, examplesFor } from "./examples.js";
import { passedOn, passKey } from "./passes.js";
import { ReachRefusal } from "./refusal.js";
import {
  COMMENT_KINDS,
  type Comment,
  type CommentKind,
  type CommentSort,
  comments,
  type ReachAccount,
  reachAccounts,
  reachContacts,
  reachMessages,
} from "./schema.js";
import { queueManual } from "./tick.js";
import { keepTouch, touchFromAnswer, touchFromComment, touchFromMessage } from "./touches.js";

/** The workflow, and the node the reader is in it. */
export const COMMENTS_FLOW = "reach.comments";
export const COMMENTS_FROM = "read.comment";

/** They asked for the thing, or to be written to: settled in code, never misread. */
const ASKED =
  /\b(dm me|pm me|message me|send (it|me|over)|i'?m in|count me in|interested|i'?d love (it|that|this|one|a copy)|please share|share (it|the link))\b/i;

export const askedInWords = (text: string) => ASKED.test(text);

/** Selling at us or asking for follows: never a reader. */
const SPAM =
  /\b(check (out )?my (page|profile|bio|channel|account)|follow (me|back|for follow)|sub(scribe)? (to me|back)|(dm|message) (me )?for (promo|promotion|collab|shoutout)|promot(e|ion) (your|ur) (page|account|post)|telegram|whats ?app|crypto|forex|bitcoin|onlyfans|cash ?app|giveaway)\b/i;
/** Short praise or a nod, the whole comment: nothing a reply would add to. */
const NOD =
  /^(nice|great|cool|wow|amazing|awesome|love (it|this|that)|so true|true|facts|fire|this|first|w|based|agreed|same|well said|saved|following|lol|lmao|ha(ha)+|yes+|yep|100|thanks?( (you|so much|for sharing|for this))?|thank you( so much| for sharing)?|great (post|video|content|stuff|share|tip|point|read)|nice (post|video|one|work)|good (stuff|point|one|video|post)|so (good|helpful|useful))$/i;

/**
 * Why a comment is plainly nothing to answer, or null: spam (even dressed as an ask), else
 * emoji or punctuation only, someone tagging a friend, or a short nod. A question mark or an ask
 * keeps it; a review is never noise (an owner answers every review).
 */
export function noiseInWords(text: string, kind?: string): string | null {
  if (kind === "review") return null;
  if (SPAM.test(text)) return "Spam or a follow ask.";
  if (text.includes("?") || askedInWords(text)) return null;
  const tagged = /(^|\s)@[\w.]+/.test(text);
  const words = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)@[\w.]+/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return tagged ? "Only tags someone." : "Emoji or punctuation only.";
  if (NOD.test(words)) return "A short nod: nothing to answer.";
  return null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Keep what the inbox listed; a re-read keeps nothing twice. Ours are kept and closed. Answers the
 * new comments from other people, oldest first.
 */
export async function keepComments(
  db: Queryable,
  account: Pick<ReachAccount, "id" | "platform">,
  items: readonly CommentIn[],
  ours: readonly string[],
): Promise<Array<Pick<Comment, "id" | "platform" | "author" | "post">>> {
  if (!items.length) return [];
  const passed = await passedOn(db, account.platform);
  const rows = [...items]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => {
      const mine = ours.some((h) => same(h, c.handle));
      const gone = !mine && passed.has(passKey(null, c.handle));
      return {
        platform: account.platform,
        accountId: account.id,
        ref: c.ref.slice(0, 200),
        post: c.post.slice(0, 200),
        parent: c.parent.slice(0, 200),
        // A type Reddit adds later is filed as a reply; the message itself stays in `raw`.
        kind: (COMMENT_KINDS as readonly string[]).includes(c.kind)
          ? (c.kind as CommentKind)
          : ("comment_reply" as const),
        place: c.place?.slice(0, 200) ?? null,
        postTitle: c.postTitle,
        author: c.handle.slice(0, 120),
        body: c.text,
        url: c.url,
        at: new Date(c.at),
        raw: c.raw,
        ...(mine ? { sort: "ours" as const, state: "dropped" as const, why: "One of ours" } : {}),
        ...(gone ? { state: "dropped" as const, why: "You passed on them" } : {}),
      };
    });
  const kept = await db.insert(comments).values(rows).onConflictDoNothing().returning({
    id: comments.id,
    platform: comments.platform,
    author: comments.author,
    post: comments.post,
    sort: comments.sort,
    state: comments.state,
  });
  const theirs = kept
    .filter((k) => k.sort !== "ours" && k.state !== "dropped")
    .map(({ sort: _, state: __, ...k }) => k)
    .sort((a, b) => a.id - b.id);
  for (const k of theirs) await keepTouch(`c:${k.id}`, () => touchFromComment(db, k.id));
  return theirs;
}

/** One kept comment on the spine. */
export const commentEvent = (c: Pick<Comment, "id" | "platform" | "author" | "post">) =>
  ({
    subject: `comment:${c.id}`,
    kind: "comment",
    data: { commentId: c.id, platform: c.platform, author: c.author, post: c.post },
  }) satisfies SpineEvent;

const NAMES: Record<string, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Business Profile",
};

/**
 * The sort's instructions; `guide` (the platform's playbook and comments SOP) goes after them.
 * `facts`: what is true about us, the only first-person claims an answer may make.
 */
export const systemFor = (platform: string, guide = "", facts: readonly string[] = []) =>
  `You read a comment someone left on our ${NAMES[platform] ?? platform} post or under our comment. We are \
Wren Automation; our posts give something useful and never pitch. Sort it: "asked" = they asked \
for what the post offered, or to be messaged; "question" = they asked us something; "chat" = \
anything else friendly or neutral; "hostile" = an attack, spam or a troll. For asked and question \
only, write the answer we'd post under it: casual and plain, at most 2 short sentences, no links, \
no pitch, no emojis; for asked, say you'll DM them. Otherwise answer "". Answer JSON only: \
{"sort": "asked" | "question" | "chat" | "hostile", "why": "<one short line>", "answer": "<text>"}
${factsBlock(facts)}
${humanBlock()}${guide.trim() ? `\n\nHow we write here; answers follow it:\n${guide.trim()}` : ""}`;

const WHERE: Partial<Record<CommentKind, string>> = {
  comment_reply: "Under our comment",
  thread_reply: "In the thread under our comment, following up",
};

export const promptFor = (c: Comment) => {
  const reddit = c.platform === "reddit";
  return (
    `Post: ${c.postTitle ?? "(untitled)"}${c.place ? (reddit ? ` in r/${c.place}` : ` in ${c.place}`) : ""}\n` +
    `${WHERE[c.kind] ?? "On our post"}, ${reddit ? "u/" : ""}${c.author} wrote:\n${c.body}`
  );
};

/** The platform's playbook and comments SOP, read fresh per comment; "" = none. */
export type CommentGuide = (platform: string) => Promise<string>;

const ANSWER = z.object({
  sort: z.enum(["asked", "question", "chat", "hostile"]),
  why: z.string(),
  answer: z.string(),
});

const line = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Sort one comment and draft its answer. Null when there's no such row; a second call answers the
 * first's sort. With no model, or an answer that doesn't read, it waits unsorted: a missed comment
 * costs more than a glance. A provider failure throws, so the step tries again. An answer that
 * makes up a claim or number is asked for once more, then left undrafted for him to write.
 */
export async function sortComment(
  db: Db,
  llm: LlmClient | null,
  id: number,
  guide?: CommentGuide,
  /** What is true about us (`wrenFacts`); left out, an answer claims nothing first-person. */
  facts: readonly string[] = [],
): Promise<CommentSort | null> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) return null;
  if (c.sort || c.state !== "new") return c.sort;
  // Plain noise is kept, closed and never sent to the model.
  const noise = noiseInWords(c.body, c.kind);
  if (noise) {
    await db
      .update(comments)
      .set({ sort: "noise", why: noise, state: "dropped" })
      .where(and(eq(comments.id, id), eq(comments.state, "new")));
    return "noise";
  }
  let sort: CommentSort | null = askedInWords(c.body) ? "asked" : null;
  let why = sort ? "Asked in words" : "No model is set, so it waits unsorted.";
  let draft: string | null = null;
  let out: Outcome<z.infer<typeof ANSWER>> | null = null;
  // The model for this comment: its arm of the draft-model test, or the client's own model.
  const picked = llm ? await modelFor(llm, `comment:${id}`) : null;
  if (llm && picked) {
    // The SOPs, his last 5 edits of comment answers (content desk, 6), then his yeses and nos
    // closest to this comment.
    const [sops, edits, examples] = await Promise.all([
      guide ? guide(c.platform) : "",
      editsFor(db, ["comment"]),
      examplesFor(db, COMMENT_KINDS_LEARNED, `${c.postTitle ?? ""} ${c.body}`),
    ]);
    const prompt = promptFor(c);
    const system = systemFor(
      c.platform,
      [sops.trim(), edits, examples].filter(Boolean).join("\n\n"),
      facts,
    );
    const asked = sort;
    // A client's model gate saying no leaves it to the words, as with no model.
    const g = await guardDraft(
      async (fix) => {
        const r = await completeAndParse(picked.llm, fix ? `${prompt}\n\n${fix}` : prompt, ANSWER, {
          maxTokens: 300,
          system,
          name: "comments.sort",
        });
        const s = asked ?? r.parsed?.sort;
        const answers = s === "asked" || s === "question";
        return { text: answers ? (r.parsed?.answer.trim() ?? "") : "", result: r };
      },
      { facts, sources: [prompt] },
    ).catch((err) => {
      if (!isVendorStop(err)) throw err;
      if (!sort) why = `${err.why}, so it waits unsorted.`;
      return null;
    });
    if (g) await recordGuard(db, "comments.sort", `comment:${id}`, g, guardBy(picked));
    out = g?.result ?? null;
    if (!out) {
      // Kept as the words left it.
    } else if (out.parsed) {
      if (!sort) {
        sort = out.parsed.sort;
        why = line(out.parsed.why);
      }
      // The guard dropped it: no draft, he writes it.
      if (sort === "asked" || sort === "question") draft = g?.text || null;
    } else if (!sort) why = "The model's answer didn't read, so it waits unsorted.";
  }
  // He writes replies himself: the sort stays, the box starts empty.
  if (draft && !(await modelDrafts(db))) draft = null;
  const [kept] = await db
    .update(comments)
    .set({ sort, why, draft, state: "waiting" })
    .where(and(eq(comments.id, id), eq(comments.state, "new")))
    .returning({ id: comments.id });
  if (kept && draft && out?.parsed && picked)
    await recordDraft(db, {
      item: `comment:${id}`,
      kind: "comment",
      platform: c.platform,
      event: "generated",
      via: "model",
      by: picked.llm.name,
      text: draft,
      llm: llmOf(out, "comments.sort", { sort }),
      runId: out.call?.run_id ?? null,
      meta: armMeta(picked.arm),
    });
  return sort;
}

/**
 * `comments.sort` on the spine: the comment leaves by its sort's port; unsorted, by `chat`; ours
 * and noise leave by none.
 */
export const sortStep =
  (
    db: Db,
    llm: LlmClient | null,
    guide?: CommentGuide,
    /** A client's comment: its own database, model (metered) and guide. None: Wren's only. */
    forClient?: (
      client: string,
    ) => Promise<{ db: Db; llm: LlmClient | null; guide?: CommentGuide }>,
    /** Wren's facts (`wrenFacts`); a client's answers claim nothing first-person. */
    facts?: () => Promise<readonly string[]>,
  ): Step =>
  async (_port, e, at) => {
    const id = Number(e.data.commentId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept comment`);
    if (at.client && !forClient)
      throw new Error(`comments.sort: no client databases for ${at.client}`);
    const on =
      at.client && forClient
        ? { ...(await forClient(at.client)), facts: [] as readonly string[] }
        : { db, llm, guide, facts: facts ? await facts() : [] };
    const sort = await sortComment(on.db, on.llm, id, on.guide, on.facts);
    return sort === "ours" || sort === "noise" ? [] : [{ port: sort ?? "chat", event: e }];
  };

export async function commentById(db: Queryable, id: number): Promise<Comment> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) throw new ReachRefusal(`no comment ${id}`);
  return c;
}

async function accountOf(db: Queryable, c: Comment): Promise<ReachAccount> {
  if (!c.accountId)
    throw new ReachRefusal(`comment ${c.id} is on our ${c.platform} post, not a reach inbox`);
  const [a] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, c.accountId));
  if (!a) throw new ReachRefusal(`comment ${c.id}: its account is gone`);
  return a;
}

/** Our other accounts' handles on the platform: never two of ours in one thread. */
async function othersOf(db: Queryable, a: ReachAccount): Promise<string[]> {
  const rows = await db
    .select({ handle: reachAccounts.handle })
    .from(reachAccounts)
    .where(and(eq(reachAccounts.platform, a.platform), ne(reachAccounts.id, a.id)));
  return rows.flatMap((r) => (r.handle ? [r.handle] : []));
}

/** `account` null = a content comment: answered through `Content.reply`, no reach caps. */
export interface AnswerPlan {
  comment: Comment;
  account: ReachAccount | null;
  others: string[];
}

/** Everything that refuses an answer before the platform is asked. */
export async function planAnswer(db: Queryable, id: number, now: Date): Promise<AnswerPlan> {
  const comment = await commentById(db, id);
  if (comment.state === "answered") throw new ReachRefusal("already answered");
  if (comment.sort === "ours") throw new ReachRefusal("that one is ours");
  if (comment.channel === "content") return { comment, account: null, others: [] };
  // A person's pick on the draft, else the account they spoke to.
  const account = (await pickedReachAccount(db, `comment:${id}`)) ?? (await accountOf(db, comment));
  if (account.state === "paused" || account.state === "retired")
    throw new ReachRefusal(`${account.account} is ${account.state}`);
  if (account.platform === "reddit" && account.health) {
    const w = warmupOf(account.health as Parameters<typeof warmupOf>[0], now);
    if (w.frozen) throw new ReachRefusal(`${account.account}: ${w.frozen}`);
    if ((await commentsToday(db, account.id, now)) >= w.caps.comments)
      throw new ReachRefusal(
        `${account.account} is at ${w.stage}: ${w.caps.comments} comments a day${w.next ? ` (${w.next})` : ""}`,
      );
  }
  return { comment, account, others: await othersOf(db, account) };
}

/** Refuses when another of our accounts already wrote in the thread. */
export function checkThread(authors: readonly string[], others: readonly string[]) {
  const met = others.find((o) => authors.some((a) => same(a, o)));
  if (met) throw new ReachRefusal(`u/${met} already wrote in this thread; ours never meet in one`);
}

export async function markAnswered(
  db: Queryable,
  id: number,
  r: { body: string; ref: string | null; now: Date; by?: string; via?: "person" | "wren" },
) {
  const [c] = await db
    .update(comments)
    .set({ state: "answered", answer: r.body, answerRef: r.ref, answeredAt: r.now })
    .where(eq(comments.id, id))
    .returning({
      platform: comments.platform,
      url: comments.url,
      post: comments.post,
      author: comments.author,
      channel: comments.channel,
      accountId: comments.accountId,
      at: comments.at,
    });
  await keepTouch(`ca:${id}`, () => touchFromAnswer(db, id));
  // Their earlier messages in the thread waited on the same answer: it covers them too, so the
  // person's row stops waiting. A later one stays open (designs/2026-10-15-engage-threads.md).
  if (c)
    await db
      .update(comments)
      .set({ state: "answered", answer: r.body, answerRef: r.ref, answeredAt: r.now })
      .where(
        and(
          eq(comments.platform, c.platform),
          eq(comments.post, c.post),
          eq(comments.channel, c.channel),
          sql`lower(${comments.author}) = lower(${c.author})`,
          sql`${comments.accountId} is not distinct from ${c.accountId}`,
          inArray(comments.state, ["new", "waiting"]),
          lte(comments.at, c.at),
          ne(comments.id, id),
        ),
      );
  if (c)
    await recordDraft(db, {
      item: `comment:${id}`,
      kind: "comment",
      platform: c.platform,
      event: "sent",
      via: r.via ?? "person",
      by: r.by ?? null,
      text: r.body,
      externalId: r.ref,
      url: whereSent(c.platform, c.url, r.ref),
      ref: `sent:comment:${id}`,
    });
}

/** Sites where only a top-level comment takes a reply: one under a reply goes under its parent. */
const ONE_LEVEL = new Set(["instagram", "youtube", "facebook", "linkedin"]);
/** Of those, the ones whose own reply box names the person replied to, as `@handle `. */
const NAMES_REPLIED = new Set(["instagram", "youtube"]);

/**
 * Where an answer on our own post goes, and its words. A reply to a reply on a one-level site goes
 * under the top comment, naming the person as the site's own reply box would.
 */
export function answerFor(
  c: Pick<Comment, "platform" | "ref" | "post" | "parent" | "author">,
  body: string,
): { target: string; text: string } {
  if (!ONE_LEVEL.has(c.platform) || !c.parent || c.parent === c.post)
    return { target: c.ref, text: body };
  const handle = c.author.replace(/^@/, "");
  const named = new RegExp(`(^|\\s)@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const text = NAMES_REPLIED.has(c.platform) && !named.test(body) ? `@${handle} ${body}` : body;
  return { target: c.parent, text };
}

/** The answer, end to end, for the CLI and tests; the desk journals the same steps one by one. */
export async function answerComment(
  db: Queryable,
  ch: OutreachChannel,
  req: { id: number; body: string; now: Date },
): Promise<{ ref: string | null }> {
  const body = req.body.trim();
  if (!body) throw new ReachRefusal("the answer is empty");
  const plan = await planAnswer(db, req.id, req.now);
  if (!plan.account) throw new ReachRefusal("a content comment is answered through Content.reply");
  if (!ch.comment) throw new ReachRefusal(`${plan.account.platform} can't answer comments`);
  checkThread((await ch.threadAuthors?.(plan.comment.post)) ?? [], plan.others);
  const sent = await ch.comment(plan.comment.ref, body);
  await markAnswered(db, req.id, { body, ref: sent.ref, now: req.now });
  return { ref: sent.ref };
}

/** A Reddit account still warming up may not DM yet, or is frozen: refused with why. */
export function checkCanDm(account: ReachAccount, now: Date) {
  if (account.platform !== "reddit" || !account.health) return;
  const w = warmupOf(account.health as Parameters<typeof warmupOf>[0], now);
  if (w.frozen) throw new ReachRefusal(`${account.account}: ${w.frozen}`);
  if (w.caps.messages === 0)
    throw new ReachRefusal(`${account.account} can't DM yet: ${w.next || w.stage}`);
}

/**
 * A DM to the comment's author from the account that read it, queued for the sender. Once per
 * person: after that, only their reply opens the thread again, and it's answered there.
 */
export async function dmCommenter(
  db: Queryable,
  req: { id: number; body: string; subject?: string | null; now: Date },
): Promise<{ contactId: number; messageId: number }> {
  const body = req.body.trim();
  if (!body) throw new ReachRefusal("the message is empty");
  const c = await commentById(db, req.id);
  if (c.sort === "ours") throw new ReachRefusal("that one is ours");
  const account = await accountOf(db, c);
  checkCanDm(account, req.now);
  await addProspects(db, account.platform, [
    {
      handle: c.author,
      url: `https://www.reddit.com/user/${c.author}`,
      name: null,
      headline: null,
      foundIn: c.place ? `r/${c.place}` : "comment",
    },
  ]);
  const contact = await contactByHandle(db, account.platform, c.author);
  if (["opted_out", "blocked"].includes(contact.state))
    throw new ReachRefusal(`u/${c.author} asked us to stop`);
  const [prior] = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.contactId, contact.id),
        eq(reachMessages.direction, "out"),
        inArray(reachMessages.state, ["queued", "sending", "sent", "unknown"]),
      ),
    )
    .limit(1);
  if (prior) throw new ReachRefusal(`u/${c.author} has a DM from us; answer in their thread`);
  if (!contact.accountId)
    await db
      .update(reachContacts)
      .set({ accountId: account.id })
      .where(eq(reachContacts.id, contact.id));
  const msg = await queueManual(db, {
    contact: { ...contact, accountId: contact.accountId ?? account.id },
    body,
    subject: req.subject ?? c.postTitle?.slice(0, 100) ?? null,
    now: req.now,
  });
  await db.update(comments).set({ contactId: contact.id }).where(eq(comments.id, c.id));
  return { contactId: contact.id, messageId: msg.id };
}

/**
 * The way into a commenter's DMs (designs/2026-10-11-dm-door.md). `reach`: the reach account
 * that read it DMs them; `private_reply`: Meta's one DM from the comment, through our Page; null:
 * no door, and `how` says what to do instead.
 */
export type DmDoor = { door: "reach" | "private_reply" | null; how: string };
const NO_DOOR: Record<string, string> = {
  x: "X DMs need their DMs open to us: answer in public and ask them to DM us.",
  linkedin:
    "LinkedIn has no DM from a comment: answer in public; a connect with a note is the way in.",
  youtube: "YouTube has no DMs: answer in public with the link.",
  tiktok: "TikTok has no DM API: answer in public with the link.",
  reddit: "A Reddit DM goes from a reach account; this one was read on our own post.",
};
/** Meta takes a DM from a comment only this long after it. */
export const PRIVATE_REPLY_MS = 7 * 86_400_000;

export function dmDoorOf(c: Pick<Comment, "platform" | "accountId">): DmDoor {
  if (c.accountId) return { door: "reach", how: "A DM from the reach account that read it." };
  if (c.platform === "instagram" || c.platform === "facebook")
    return {
      door: "private_reply",
      how: "One DM as a reply to their comment, within 7 days of it.",
    };
  return {
    door: null,
    how: NO_DOOR[c.platform] ?? `No DM door on ${c.platform}: answer in public.`,
  };
}

/** Everything that refuses a DM from a comment on our own post, before Meta is asked. */
export async function planPrivateReply(db: Queryable, id: number, now: Date): Promise<Comment> {
  const c = await commentById(db, id);
  if (c.sort === "ours") throw new ReachRefusal("that one is ours");
  const d = dmDoorOf(c);
  if (d.door !== "private_reply") throw new ReachRefusal(d.how);
  if (c.contactId) throw new ReachRefusal(`${c.author} has a DM from us; answer in their thread`);
  if (now.getTime() - c.at.getTime() > PRIVATE_REPLY_MS)
    throw new ReachRefusal("Meta takes a DM from a comment only within 7 days of it");
  const [contact] = await db
    .select({ state: reachContacts.state })
    .from(reachContacts)
    .where(
      and(
        eq(reachContacts.platform, c.platform as "instagram" | "facebook"),
        eq(reachContacts.handle, c.author),
      ),
    );
  if (contact && ["opted_out", "blocked"].includes(contact.state))
    throw new ReachRefusal(`${c.author} asked us to stop`);
  return c;
}

/**
 * Sent by Meta: their contact (their reply lands on it), the message as sent, the comment tied
 * to it, the touch.
 */
export async function privateReplied(
  db: Queryable,
  c: Comment,
  o: { body: string; ref: string | null; now: Date; by?: string | null; via?: "person" | "wren" },
): Promise<{ contactId: number; messageId: number }> {
  const url = c.platform === "instagram" ? `https://www.instagram.com/${c.author}/` : c.url;
  const [contact] = await db
    .insert(reachContacts)
    .values({
      platform: c.platform as "instagram" | "facebook",
      handle: c.author,
      url,
      name: null,
      headline: null,
      foundIn: `comment on ${c.postTitle?.slice(0, 120) ?? "our post"}`,
    })
    .onConflictDoUpdate({
      target: [reachContacts.platform, reachContacts.handle],
      set: { handle: c.author },
    })
    .returning({ id: reachContacts.id });
  if (!contact) throw new Error("dm: the contact didn't save");
  const [msg] = await db
    .insert(reachMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "manual",
      body: o.body,
      state: "sent",
      dueAt: o.now,
      sentAt: o.now,
      ref: o.ref,
    })
    .returning({ id: reachMessages.id });
  if (!msg) throw new Error("dm: the message didn't save");
  await db.update(comments).set({ contactId: contact.id }).where(eq(comments.id, c.id));
  await keepTouch(`rm:${msg.id}`, () => touchFromMessage(db, msg.id));
  await recordDraft(db, {
    item: `dm:${contact.id}`,
    kind: "dm",
    platform: c.platform,
    event: "sent",
    via: o.via ?? "person",
    by: o.by ?? null,
    text: o.body,
    externalId: o.ref,
    url,
    meta: { message: msg.id, comment: c.id },
    ref: `sent:dm:${msg.id}`,
  });
  return { contactId: contact.id, messageId: msg.id };
}

export async function dropComment(
  db: Queryable,
  id: number,
  o: { by?: string; reason?: RejectReason | null; note?: string | null } = {},
): Promise<void> {
  const [c] = await db
    .update(comments)
    .set({ state: "dropped" })
    .where(and(eq(comments.id, id), ne(comments.state, "answered"), ne(comments.state, "dropped")))
    .returning({ platform: comments.platform, draft: comments.draft });
  // Only a drafted answer is a no to words; a plain dismiss teaches nothing.
  if (c?.draft)
    await recordDraft(db, {
      item: `comment:${id}`,
      kind: "comment",
      platform: c.platform,
      event: "rejected",
      via: "person",
      by: o.by ?? null,
      text: c.draft,
      reason: o.reason ?? null,
      note: o.note ?? null,
    });
}
