/**
 * Decide's comment source (designs/2026-10-16-decide.md): drafted comments still waiting on him
 * whose newest model draft has no decision yet, each with what the draft answers. The state never
 * holds a handle or a name: the place, the post's words, the comment answered, the draft.
 */
import type { DecideSource, DecideSubject } from "@wren/core/decide";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>): Promise<Row[]> =>
  (await db.execute(q)) as unknown as Row[];

/** Post and comment words past these are cut: the draft is what is judged. */
const POST_MAX = 1500;
const COMMENT_MAX = 800;
/** Drafts older than this aren't asked about: the thread has moved on. */
const FRESH_DAYS = 14;

const cut = (v: unknown, n: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;
};
const drop = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));

/** One row as the state Jev reads. */
function commentState(r: Row): Record<string, unknown> {
  const item = String(r.item);
  if (item.startsWith("thread:"))
    return drop({
      platform: "reddit",
      where: r.subreddit ? `r/${r.subreddit}` : null,
      post: drop({ title: cut(r.t_title, 300), text: cut(r.t_body, POST_MAX) }),
      comment: String(r.t_target ?? "").startsWith("t1_")
        ? cut(r.t_target_text, COMMENT_MAX)
        : null,
      draft: String(r.draft ?? ""),
    });
  if (item.startsWith("onpost:"))
    return drop({
      platform: r.p_platform ?? null,
      post: drop({ text: cut(r.p_text, POST_MAX) }),
      draft: String(r.draft ?? ""),
    });
  return drop({
    platform: r.c_platform ?? null,
    on: "our own post",
    kind: r.c_kind ?? null,
    stars: r.c_stars ?? null,
    post: drop({ title: cut(r.c_post_title, 300) }),
    comment: cut(r.c_body, COMMENT_MAX),
    draft: String(r.draft ?? ""),
  });
}

/** Each drafted comment's newest model draft with what it answers; `where` filters `g` (the draft). */
async function commentRows(
  db: Queryable,
  gen: ReturnType<typeof sql>,
  where: ReturnType<typeof sql>,
  limit: number,
): Promise<DecideSubject[]> {
  const rows = await rowsOf(
    db,
    sql`
    with gen as (
      select distinct on (e.item) e.item, e.text as draft, e.at
      from draft_events e
      where e.kind in ('comment', 'thread', 'post_comment') and e.event = 'generated'
        and e.text is not null and ${gen}
      order by e.item, e.at desc, e.id desc
    )
    select g.item, g.draft,
      t.subreddit, t.title as t_title, t.body as t_body, t.target as t_target, t.target_text as t_target_text,
      p.platform as p_platform, p.text as p_text,
      c.platform as c_platform, c.kind as c_kind, c.stars as c_stars, c.post_title as c_post_title, c.body as c_body
    from gen g
    left join reddit_threads t on g.item like 'thread:%' and t.id = substr(g.item, 8)
    left join reach_posts p on g.item like 'onpost:%' and p.id::text = substr(g.item, 8)
    left join comments c on g.item like 'comment:%' and c.id::text = substr(g.item, 9)
    where (t.id is not null or p.id is not null or c.id is not null) and ${where}
    order by g.at
    limit ${limit}`,
  );
  return rows.map((r) => ({ subject: String(r.item), state: commentState(r) }));
}

/** Open comment drafts with a model draft newer than their newest decision, oldest first. */
export function commentsDue(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]> {
  const since = new Date(now.getTime() - FRESH_DAYS * 86_400_000).toISOString();
  return commentRows(
    db,
    sql`e.at >= ${since}::timestamptz and (e.ref is null or e.ref not like 'bf:%')`,
    sql`not exists (select 1 from draft_events d where d.item = g.item
        and d.event in ('sent', 'rejected') and d.at >= g.at)
      and not exists (select 1 from decisions x where x.kind = 'comment_quality'
        and x.subject = g.item and x.at >= g.at)`,
    limit,
  );
}

/**
 * Drafts he already called with no decision yet, for a first agreement number: shown as the model
 * wrote them, so the answer is blind to his call.
 */
export function commentsCalled(db: Queryable, limit: number): Promise<DecideSubject[]> {
  return commentRows(
    db,
    sql`true`,
    sql`exists (select 1 from decision_calls k where k.kind = 'comment_quality' and k.subject = g.item)
      and not exists (select 1 from decisions x where x.kind = 'comment_quality' and x.subject = g.item)`,
    limit,
  );
}

export const commentSource: DecideSource = { kind: "comment_quality", due: commentsDue };
