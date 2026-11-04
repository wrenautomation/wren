/**
 * Outbound's draft item kinds for the act base (`@wren/starling-acts` ItemKinds): Reddit threads
 * and others' posts, with the sub's floor, plus the turn stores' kinds (`turnKinds`) with the
 * Reddit floor laid over `comment`. A DM's "posted" is `markDmPosted`: its sequence moves on,
 * which needs the sequences and the sender.
 */
import { keepSentEdit } from "@wren/core/ask";
import { atomic, type Queryable } from "@wren/db";
import {
  effectiveNeed,
  type ItemKind,
  type ItemKinds,
  type ReachAccount,
  ReachRefusal,
  reachAccounts,
  redditRequirements,
  settleSent,
  shortfall,
  standingOfAccount,
  unsureItem,
} from "@wren/starling-acts";
import { turnKinds } from "@wren/starling-conversations";
import { reachContacts, reachMessages } from "@wren/starling-conversations/schema";
import { eq, sql } from "drizzle-orm";
import { markCommented, skipThread } from "./discovery/threads.js";
import { markPostCommented, skipPost } from "./reach-posts/acts.js";
import { reachPosts, redditThreads } from "./schema.js";
import {
  type Candidate,
  emptyStats,
  recordSent,
  type TickOptions,
  type TickStats,
} from "./tick.js";

type Place = { platform: string; sub: string | null };
const one = async <T>(db: Queryable, q: ReturnType<typeof sql>): Promise<T | null> =>
  ((await db.execute(q)) as unknown as T[])[0] ?? null;
const num = (id: string) => (/^\d+$/.test(id) ? Number(id) : null);

/** The sub's karma and age floor as a judge of each account (Reddit only). */
const redditFloors: ItemKind["floors"] = async (db, sub, now) => {
  const rows = await db
    .select()
    .from(redditRequirements)
    .where(eq(redditRequirements.subreddit, sub));
  const need = effectiveNeed(rows);
  return (a: ReachAccount, label: string) => {
    if (a.platform !== "reddit") return null;
    if (need.hold) return `r/${sub} removed our last comment without saying why`;
    const s = shortfall(need, standingOfAccount(a, now));
    if (!s.needs.length) return null;
    return `r/${sub} needs ${s.needs.join(" and ")}, ${label} has ${s.has.join(" and ")}`;
  };
};

const thread: ItemKind = {
  place: (db, id) =>
    one<Place>(
      db,
      sql`select 'reddit' platform, subreddit sub from reddit_threads where id = ${id}`,
    ),
  // The send's order (`planThreadComment`): the place's account, else the thread's.
  fallback: async (db, id) =>
    (
      await one<{ account: string | null }>(
        db,
        sql`select coalesce(pa.account, ta.account) account
          from reddit_threads t
          left join reddit_places p on p.subreddit = t.subreddit
          left join reach_accounts pa on pa.id = p.account_id
          left join reach_accounts ta on ta.id = t.account_id
          where t.id = ${id}`,
      )
    )?.account ?? null,
  floors: redditFloors,
  async landed(tx, id, o) {
    // CP: no account, no record; a guess would credit the wrong login.
    const [acct] = o.account
      ? await tx
          .select({ id: reachAccounts.id })
          .from(reachAccounts)
          .where(eq(reachAccounts.account, o.account))
      : [];
    if (!acct) throw new ReachRefusal(`no account ${o.account ?? ""} for thread:${id}`);
    const [t] = await tx
      .select({ draft: redditThreads.draft })
      .from(redditThreads)
      .where(eq(redditThreads.id, id));
    await keepSentEdit(tx, {
      record: "thread",
      id,
      by: o.by,
      before: t?.draft ?? null,
      after: o.body,
    });
    await markCommented(tx, id, {
      body: o.body,
      ref: o.ref,
      accountId: acct.id,
      now: o.now,
      by: o.by,
    });
  },
  // Skipped: a rejected draft is kept.
  dropped: (db, id, o) => skipThread(db, id, { by: o.by, note: o.note }),
};

const onpost: ItemKind = {
  place: (db, id) =>
    num(id) === null
      ? Promise.resolve(null)
      : one<Place>(db, sql`select platform, null sub from reach_posts where id = ${Number(id)}`),
  fallback: async (db, id) => {
    const n = num(id);
    if (n === null) return null;
    const r = await one<{ account: string | null }>(
      db,
      sql`select account from reach_posts where id = ${n}`,
    );
    return r?.account ?? null;
  },
  async landed(tx, id, o) {
    const [post] = await tx
      .select()
      .from(reachPosts)
      .where(eq(reachPosts.id, Number(id)));
    if (!post) throw new ReachRefusal(`no post ${id}`);
    await markPostCommented(tx, post, { body: o.body, by: o.by, now: o.now });
  },
  async dropped(db, id, o) {
    await skipPost(db, [Number(id)], { by: o.by, note: o.note });
  },
};

/** The kinds outbound settles: its own and the turn stores', Reddit floors on `comment`. */
export const reachKinds: ItemKinds = {
  ...turnKinds,
  comment: { ...turnKinds.comment, floors: redditFloors },
  thread,
  onpost,
};

/**
 * A person's Mark posted on a DM: its sequence moves on as if it sent (`recordSent`), and its
 * steps come back for the executor. One transaction, the flip first.
 */
export async function markDmPosted(
  outer: Queryable,
  item: string,
  o: Pick<TickOptions, "sequences" | "sender"> & { by: string; now: Date },
): Promise<TickStats> {
  return atomic(outer, async (db) => {
    const a = await unsureItem(db, item);
    const id = Number(item.slice("dm:".length));
    if (!item.startsWith("dm:") || !Number.isFinite(id))
      throw new ReachRefusal(`not a DM: ${item}`);
    if (!(await settleSent(db, item, { ref: a.ref, at: o.now, by: o.by, now: o.now })))
      throw new ReachRefusal("that send is already settled");
    const [row] = await db.select().from(reachMessages).where(eq(reachMessages.id, id));
    if (!row) throw new ReachRefusal(`no message ${id}`);
    const [contact] = await db
      .select()
      .from(reachContacts)
      .where(eq(reachContacts.id, row.contactId));
    const [account] = row.accountId
      ? await db.select().from(reachAccounts).where(eq(reachAccounts.id, row.accountId))
      : [];
    if (!contact || !account) throw new ReachRefusal(`message ${id} has no contact or account`);
    const c: Candidate = { row, contact, account, checkRelationship: false };
    const stats = emptyStats();
    await recordSent(
      db,
      c,
      { ref: a.ref, at: o.now.toISOString(), fetchedWith: "browser" },
      { sequences: o.sequences, sender: o.sender, now: o.now, runId: null },
      stats,
    );
    return stats;
  });
}
