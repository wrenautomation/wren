/**
 * Comment proofs (designs/2026-10-14-comment-proof.md): what to check for a sent item, and the
 * `comment_proofs` row each check overwrites. Items are the Inbox's ids: `thread:t3_x` (our
 * Reddit comment in a thread), `onpost:9` (ours on someone's post), `comment:4` (our answer to a
 * comment). The check itself is `CommentProof` in core; the schedule is `CommentProofs`.
 */
import type { Proof, ProofTarget } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { learnFromProof } from "./discovery/requirements.js";
import { type CommentProofRow, commentProofs } from "./schema.js";

/** When each check runs after the send: 2 minutes, an hour (filters and mods act late), a day. */
export const PROOF_ROUNDS = [
  { round: 1, delayMs: 2 * 60_000 },
  { round: 2, delayMs: 60 * 60_000 },
  { round: 3, delayMs: 24 * 60 * 60_000 },
] as const;
/** The check whose hidden or missing goes to Discord. */
export const WARN_ROUND = 2;
/** A check run by hand (`wren reach proof <item>`, the backfill). */
export const HAND_ROUND = 0;

const ITEM = /^(thread|onpost|comment):([A-Za-z0-9_]{1,40})$/;

export const isProofItem = (item: string): boolean => ITEM.test(item);

type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>): Promise<Row[]> => {
  const r = (await db.execute(q)) as unknown as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** What `CommentProof.check` reads for a sent item; null when the item was never sent. */
export async function proofTarget(db: Queryable, item: string): Promise<ProofTarget | null> {
  const m = ITEM.exec(item);
  if (!m) return null;
  const [, kind, id] = m as unknown as [string, string, string];
  if (kind === "thread") {
    const [r] = await rowsOf(
      db,
      sql`select t.id, t.target, t.url, t.answer, t.answer_ref, a.account
        from reddit_threads t left join reach_accounts a on a.id = t.account_id
        where t.id = ${id} and t.answered_at is not null`,
    );
    return r
      ? {
          platform: "reddit",
          ref: str(r.answer_ref),
          parent: str(r.target) ?? str(r.id),
          post: str(r.id),
          url: str(r.url),
          text: str(r.answer),
          account: str(r.account),
        }
      : null;
  }
  if (kind === "onpost") {
    if (!/^\d+$/.test(id)) return null;
    const [r] = await rowsOf(
      db,
      sql`select platform, ref, url, comment, account from reach_posts
        where id = ${Number(id)} and commented_at is not null`,
    );
    return r
      ? {
          platform: String(r.platform),
          ref: null,
          parent: str(r.ref),
          post: str(r.ref),
          url: str(r.url),
          text: str(r.comment),
          account: str(r.account),
        }
      : null;
  }
  if (!/^\d+$/.test(id)) return null;
  const [r] = await rowsOf(
    db,
    sql`select c.platform, c.ref, c.post, c.url, c.answer, c.answer_ref, a.account
      from comments c left join reach_accounts a on a.id = c.account_id
      where c.id = ${Number(id)} and c.answered_at is not null`,
  );
  return r
    ? {
        platform: String(r.platform),
        ref: str(r.answer_ref),
        parent: str(r.ref),
        post: str(r.post),
        url: str(r.url),
        text: str(r.answer),
        account: str(r.account),
      }
    : null;
}

/**
 * Keep a check: the row takes its answer, `checks` gets it appended. A check that read nothing
 * (pending) never covers an earlier verdict: the row keeps it and the check is only appended.
 * Answers whether it is the 1-hour check's hidden or missing, which goes to Discord once.
 */
export async function keepProof(
  db: Queryable,
  item: string,
  platform: string,
  proof: Proof,
  round: number,
): Promise<{ warn: boolean }> {
  const line = {
    at: proof.checkedAt,
    state: proof.state,
    note: proof.note,
    shot: proof.shot,
    round,
  };
  const at = new Date(proof.checkedAt);
  const covers = proof.state !== "pending";
  await db
    .insert(commentProofs)
    .values({
      item,
      platform,
      state: proof.state,
      url: proof.url,
      shot: proof.shot,
      note: proof.note,
      checkedAt: at,
      checks: [line],
    })
    .onConflictDoUpdate({
      target: commentProofs.item,
      set: {
        state: covers ? proof.state : sql`${commentProofs.state}`,
        url: sql`coalesce(${proof.url}::text, ${commentProofs.url})`,
        shot: sql`coalesce(${proof.shot}::text, ${commentProofs.shot})`,
        note: covers
          ? proof.note
          : sql`case when ${commentProofs.state} = 'pending' then ${proof.note}::text else ${commentProofs.note} end`,
        checkedAt: at,
        checks: sql`${commentProofs.checks} || ${JSON.stringify([line])}::jsonb`,
      },
    });
  await learnFromProof(db, item, proof);
  return { warn: round === WARN_ROUND && (proof.state === "hidden" || proof.state === "missing") };
}

export const proofOf = async (db: Queryable, item: string): Promise<CommentProofRow | null> =>
  (await db.select().from(commentProofs).where(eq(commentProofs.item, item)))[0] ?? null;

/** Proofs checked since `since`, newest first. */
export const proofsSince = (db: Queryable, since: Date): Promise<CommentProofRow[]> =>
  db
    .select()
    .from(commentProofs)
    .where(gte(commentProofs.checkedAt, since))
    .orderBy(desc(commentProofs.checkedAt));

/** Every item sent since `since`, oldest first: the backfill's list. */
export async function sentSince(db: Queryable, sinceAt: Date): Promise<string[]> {
  const since = sql`${sinceAt.toISOString()}::timestamptz`;
  const rows = await rowsOf(
    db,
    sql`select item from (
        select 'thread:' || id item, answered_at at from reddit_threads
          where answered_at >= ${since} and answer_ref is not null
        union all
        select 'onpost:' || id, commented_at from reach_posts where commented_at >= ${since}
        union all
        select 'comment:' || id, answered_at from comments where answered_at >= ${since}
      ) s order by at`,
  );
  return rows.map((r) => String(r.item));
}

/** The line Discord gets for a 1-hour check that is not live. A pointer: no words of the comment. */
export const warningOf = (item: string, platform: string, proof: Proof) => ({
  title: `Comment ${proof.state} after an hour: ${item}`,
  body: [`${platform}${proof.note ? `: ${proof.note}` : ""}`, proof.url ?? ""]
    .filter(Boolean)
    .join("\n"),
});
