/**
 * What a profile merge does to the pipeline (designs/2026-10-18-journeys.md, "Causes"): the
 * `from` profile's journeys and deals move to `into`. Core must not import `@wren/pipeline`, so
 * this is plain SQL on the `pipeline` schema. A person has one open journey, so when both
 * profiles hold one, the one at the deeper node stays open (a tie keeps `into`'s) and the other is
 * dropped with reason `merged`. Depth is the `depths` of the shape version the journey sits on
 * (`pipeline.shape_versions`). A database without the schema (no pipeline yet) is left alone.
 */
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

const MERGED_REASON = "merged";

interface OpenRow {
  id: string;
  profile: number;
  depth: number;
}

/** Moves `from`'s journeys and deals to `into`. Returns the ids of the journeys it dropped. */
export async function movePipeline(
  db: Queryable,
  into: number,
  from: number,
  at = new Date(),
): Promise<string[]> {
  const has = await db.execute<{ yes: boolean }>(
    sql`select to_regclass('pipeline.instances') is not null
      and to_regclass('pipeline.shape_versions') is not null yes`,
  );
  if (!has[0]?.yes) return [];
  return atomic(db, async (tx) => {
    // The same lock every open path takes (`lockPerson` in @wren/pipeline), in id order so two
    // merges of the same pair cannot deadlock. Then the open rows are locked: a move or a drop
    // of either waits for the merge.
    for (const p of [into, from].sort((a, b) => a - b))
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`journey:${p}`}))`);
    await tx.execute(
      sql`select id from pipeline.instances where profile_id in (${into}, ${from})
        and status = 'open' for update`,
    );
    const open = (
      await tx.execute<{ id: string; profile: number; depth: number }>(sql`
        select j.id, j.profile_id profile,
          coalesce((select (v.depths ->> j.node)::int from pipeline.shape_versions v
            where v.number = j.version), 0)::int depth
        from pipeline.instances j
        where j.profile_id in (${into}, ${from}) and j.status = 'open'
        order by j.opened_at desc`)
    ).map((r): OpenRow => ({ ...r, profile: Number(r.profile), depth: Number(r.depth) }));
    // The survivor: the deepest; on a tie `into`'s; then the newest (the list is newest first).
    const keep = [...open].sort(
      (a, b) => b.depth - a.depth || Number(b.profile === into) - Number(a.profile === into),
    )[0];
    const dropped = open.filter((r) => r.id !== keep?.id).map((r) => r.id);
    if (dropped.length)
      await tx.execute(
        sql`update pipeline.instances set status = 'dropped', drop_reason = ${MERGED_REASON},
          closed_at = ${at.toISOString()}::timestamptz
          where id in (${sql.join(
            dropped.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
      );
    await tx.execute(
      sql`update pipeline.instances set profile_id = ${into} where profile_id = ${from}`,
    );
    await tx.execute(
      sql`update pipeline.deals set profile_id = ${into} where profile_id = ${from}`,
    );
    return dropped;
  });
}
