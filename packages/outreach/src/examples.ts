/**
 * His comment decisions as few-shot examples (designs/2026-10-07-content-funnel.md, part c). Each
 * comment draft he sent or turned down is in `draft_events`, with the post it answered and, on a
 * no, the reason and note. The drafting prompts read the ones closest to the post at hand: most
 * shared words first, then the newest, a few at most, with a no among them when there is one.
 */
import type { DraftRecordKind } from "@wren/core/draft-record";
import { REJECT_LABELS, type RejectReason } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { comments, linkedinPosts, redditThreads } from "./schema.js";

/** The kinds that are comments: answers on our posts, Reddit threads, others' LinkedIn posts. */
export const COMMENT_KINDS_LEARNED = [
  "comment",
  "thread",
  "linkedin_comment",
] as const satisfies readonly DraftRecordKind[];
export type LearnedKind = (typeof COMMENT_KINDS_LEARNED)[number];

/** How far back, how many read, how many shown. */
const DAYS = 90;
const POOL = 200;
export const EXAMPLES_MAX = 6;
/** Each side of an example in a prompt: enough to show the move. */
const CHARS = 300;

export interface CommentExample {
  item: string;
  kind: LearnedKind;
  platform: string | null;
  /** Approved or sent (his yes, as it went) or rejected. */
  yes: boolean;
  /** The words that went out, or the draft he turned down. */
  text: string;
  reason: RejectReason | null;
  note: string | null;
  /** What it answered: the comment, the thread or the post. */
  about: string;
  at: Date;
}

const STOP = new Set(
  "a an and are as at be but by do for from has have i if in is it its me my not of on or our so that the their them then there they this to was we what when with you your".split(
    " ",
  ),
);
/** The words worth matching on: lowercase, 3+ letters, not a stop word. */
export function termsOf(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).filter((w) => !STOP.has(w)),
  );
}

/** Ranked: most words shared with `about`, ties to the newest; at least one no when any. */
export function pickExamples(
  pool: readonly CommentExample[],
  about: string,
  limit = EXAMPLES_MAX,
): CommentExample[] {
  const want = termsOf(about);
  const score = (e: CommentExample) => {
    let n = 0;
    for (const w of termsOf(`${e.about} ${e.text}`)) if (want.has(w)) n += 1;
    return n;
  };
  const ranked = pool
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s || b.e.at.getTime() - a.e.at.getTime())
    .map((x) => x.e);
  const top = ranked.slice(0, limit);
  if (top.length === limit && !top.some((e) => !e.yes)) {
    const no = ranked.find((e) => !e.yes);
    if (no) top[limit - 1] = no;
  }
  return top;
}

/** Each item's last decision of these kinds in the window, newest first, with what it answered. */
export async function commentDecisions(
  db: Queryable,
  kinds: readonly LearnedKind[] = COMMENT_KINDS_LEARNED,
  now = new Date(),
): Promise<CommentExample[]> {
  if (!kinds.length) return [];
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const rows = await db.execute<{
    item: string;
    kind: LearnedKind;
    platform: string | null;
    event: string;
    text: string;
    reason: RejectReason | null;
    note: string | null;
    about: string | null;
    at: string | Date;
  }>(sql`
    select d.item, d.kind, d.platform, d.event, d.text, d.reason, d.note, d.at,
      coalesce(c.body, t.title || chr(10) || t.body, p.text) about
    from (
      select distinct on (e.item) e.item, e.kind, e.platform, e.event, e.text, e.reason, e.note, e.at
      from draft_events e
      where e.kind in (${sql.join(
        kinds.map((k) => sql`${k}`),
        sql`, `,
      )})
        and e.event in ('approved', 'sent', 'rejected') and e.text is not null and e.at >= ${since.toISOString()}::timestamptz
      order by e.item, e.at desc, e.id desc
    ) d
    left join ${comments} c on d.kind = 'comment'
      and c.id = case when d.kind = 'comment' then split_part(d.item, ':', 2)::int end
    left join ${redditThreads} t on d.kind = 'thread' and t.id = split_part(d.item, ':', 2)
    left join ${linkedinPosts} p on d.kind = 'linkedin_comment'
      and p.id = case when d.kind = 'linkedin_comment' then split_part(d.item, ':', 2)::int end
    order by d.at desc
    limit ${POOL}`);
  return rows.map((r) => ({
    item: r.item,
    kind: r.kind,
    platform: r.platform,
    yes: r.event !== "rejected",
    text: r.text,
    reason: r.reason,
    note: r.note,
    about: r.about ?? "",
    at: new Date(r.at),
  }));
}

/** The examples for one draft: his decisions on these kinds, closest to `about` first. */
export async function commentExamples(
  db: Queryable,
  o: { kinds?: readonly LearnedKind[]; about: string; limit?: number; now?: Date },
): Promise<CommentExample[]> {
  return pickExamples(await commentDecisions(db, o.kinds, o.now), o.about, o.limit ?? EXAMPLES_MAX);
}

const cut = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > CHARS ? `${one.slice(0, CHARS)}…` : one;
};

/** The examples as a prompt block; "" with none. */
export function examplesBlock(examples: readonly CommentExample[]): string {
  if (!examples.length) return "";
  const lines = examples.map((e, i) => {
    const why = e.yes
      ? "He sent it."
      : `He turned it down${e.reason ? `: ${REJECT_LABELS[e.reason]}` : ""}${e.note ? ` ("${cut(e.note)}")` : ""}.`;
    return `${i + 1}. Answering: "${cut(e.about) || "-"}"\nDraft: "${cut(e.text)}"\n${why}`;
  });
  return `His past decisions on comment drafts (write like the ones he sent, avoid what he turned down):\n${lines.join("\n")}`;
}

/** The block for one draft, for the drafting prompts; "" with none. */
export const examplesFor = async (
  db: Queryable,
  kinds: readonly LearnedKind[],
  about: string,
): Promise<string> => examplesBlock(await commentExamples(db, { kinds, about }));
