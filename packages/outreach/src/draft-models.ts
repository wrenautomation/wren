/**
 * The draft-model scorecard (designs/2026-10-14-draft-models.md): for each model that wrote a
 * reach draft since a date, how its drafts ended. Read from the training record
 * (`draft_events`), the guard's runs, comment proofs and the answers back; nothing is written.
 */
import {
  draftArms,
  type GuardHit,
  REACH_DRAFT_KINDS,
  REACH_GUARD_STAGES,
  type Scorecard,
  type ScoredDraft,
  scoreArms,
  verdict,
} from "@wren/core/draft-models";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>): Promise<Row[]> => {
  const r = (await db.execute(q)) as unknown as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
};

const list = (xs: readonly string[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

/** A day count ("7d"), a date ("2026-10-10") or an instant; null when it reads as none. */
export function parseSince(v: string, now: Date): Date | null {
  const d = /^(\d{1,3})d$/.exec(v.trim());
  if (d) return new Date(now.getTime() - Number(d[1]) * 86_400_000);
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

interface Step {
  event: string;
  via: string;
  by: string | null;
  text: string | null;
  arm: string | null;
}

/** One draft's steps, oldest first, as a scored draft; null when no model wrote it. */
export function scoredFrom(
  item: string,
  steps: readonly Step[],
): Omit<ScoredDraft, "proof" | "replies"> | null {
  let at = -1;
  steps.forEach((s, i) => {
    if (s.event === "generated" && s.via === "model" && s.by && s.text !== null) at = i;
  });
  const written = steps[at];
  if (!written?.by || written.text === null) return null;
  const after = steps.slice(at + 1);
  const decision = [...after]
    .reverse()
    .find((s) => ["sent", "approved", "rejected"].includes(s.event));
  const head = { item, by: written.by, armed: written.arm !== null, written: written.text };
  if (!decision) return { ...head, end: { is: "open" } };
  if (decision.event === "rejected") return { ...head, end: { is: "rejected" } };
  const went =
    decision.text ??
    [...after].reverse().find((s) => s.event === "edited" && s.text !== null)?.text ??
    written.text;
  return { ...head, end: { is: "approved", text: went } };
}

/** Every model's reach drafts since `since`, scored, with the verdict. */
export async function draftScorecard(db: Queryable, since: Date): Promise<Scorecard> {
  const at = since.toISOString();
  const window = sql`select g.item, g.round from draft_events g
    where g.event = 'generated' and g.via = 'model' and g.kind in (${list(REACH_DRAFT_KINDS)})
      and g.at >= ${at}::timestamptz`;
  const steps = await rowsOf(
    db,
    sql`select e.item, e.round, e.event, e.via, e.by, e.text, e.meta->>'arm' arm from draft_events e
      join (${window}) w on w.item = e.item and w.round = e.round
      order by e.item, e.round, e.at, e.id`,
  );
  const proofs = new Map(
    (
      await rowsOf(
        db,
        sql`select p.item, p.state from comment_proofs p
          where p.item in (select g.item from (${window}) g)`,
      )
    ).map((r) => [String(r.item), String(r.state)]),
  );
  // Answers back are read for threads and comment answers only: a DM contact's messages back
  // are not tied to one draft.
  const replies = new Map(
    (
      await rowsOf(
        db,
        sql`select o.item, jsonb_array_length(o.replies) n from draft_outcomes o
          where (o.item like 'thread:%' or o.item like 'comment:%')
            and o.item in (select g.item from (${window}) g)`,
      )
    ).map((r) => [String(r.item), Number(r.n)]),
  );
  const byDraft = new Map<string, { item: string; steps: Step[] }>();
  for (const r of steps) {
    const key = `${String(r.item)}#${String(r.round)}`;
    const d = byDraft.get(key) ?? { item: String(r.item), steps: [] };
    d.steps.push({
      event: String(r.event),
      via: String(r.via),
      by: typeof r.by === "string" ? r.by : null,
      text: typeof r.text === "string" ? r.text : null,
      arm: typeof r.arm === "string" ? r.arm : null,
    });
    byDraft.set(key, d);
  }
  const drafts: ScoredDraft[] = [];
  for (const { item, steps: s } of byDraft.values()) {
    const d = scoredFrom(item, s);
    if (!d) continue;
    drafts.push({
      ...d,
      proof: proofs.get(item) ?? null,
      replies: replies.get(item) ?? null,
    });
  }
  const guard: GuardHit[] = (
    await rowsOf(
      db,
      sql`select r.model, r.stats->>'outcome' outcome from runs r
        where r.command = 'guard' and r.model is not null and r.started_at >= ${at}::timestamptz
          and r.stats->>'outcome' in ('dropped', 'redrafted')
          and (r.argv->>'stage' in (${list(REACH_GUARD_STAGES)}) or r.argv->>'stage' like '%.comment_draft')`,
    )
  ).map((r) => ({
    by: String(r.model),
    outcome: r.outcome === "dropped" ? "dropped" : "redrafted",
  }));
  const rows = scoreArms(drafts, guard);
  return { since: at, arms: await draftArms(db), rows, verdict: verdict(rows) };
}
