/**
 * What a profile merge does to the pipeline (designs/2026-10-18-journeys.md, "Causes"): the
 * `from` profile's journeys and deals move to `into`. Core must not import `@wren/pipeline`, so
 * this is plain SQL on the `pipeline` schema. Where both hold an open journey in one funnel, the
 * one at the later stage stays open (a tie keeps `into`'s) and the other is dropped with reason
 * `merged`. A database without the schema (no pipeline yet) is left alone.
 */
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export const MERGED_REASON = "merged";

interface OpenRow {
  id: string;
  profile: number;
  funnel: string;
  pos: number;
}

/** Moves `from`'s journeys and deals to `into`. Returns the ids of the journeys it dropped. */
export async function movePipeline(
  db: Queryable,
  into: number,
  from: number,
  at = new Date(),
): Promise<string[]> {
  const has = await db.execute<{ yes: boolean }>(
    sql`select to_regclass('pipeline.journeys') is not null yes`,
  );
  if (!has[0]?.yes) return [];
  return atomic(db, async (tx) => {
    // Locked first, so a move or a drop of either waits for the merge.
    await tx.execute(
      sql`select id from pipeline.journeys where profile_id in (${into}, ${from})
        and status = 'open' for update`,
    );
    const open = (
      await tx.execute<{ id: string; profile: number; funnel: string; pos: number }>(sql`
        select j.id, j.profile_id profile, j.funnel,
          coalesce((select o.ord from pipeline.funnel_versions v,
              jsonb_array_elements(v.body -> 'stages') with ordinality o(s, ord)
            where v.funnel = j.funnel and v.number = j.version and o.s ->> 'key' = j.stage), 0)::int pos
        from pipeline.journeys j
        where j.profile_id in (${into}, ${from}) and j.status = 'open'`)
    ).map((r): OpenRow => ({ ...r, profile: Number(r.profile), pos: Number(r.pos) }));
    const dropped: string[] = [];
    for (const theirs of open.filter((r) => r.profile === from)) {
      const mine = open.find((r) => r.profile === into && r.funnel === theirs.funnel);
      if (!mine) continue;
      dropped.push(theirs.pos > mine.pos ? mine.id : theirs.id);
    }
    if (dropped.length)
      await tx.execute(
        sql`update pipeline.journeys set status = 'dropped', drop_reason = ${MERGED_REASON},
          closed_at = ${at.toISOString()}::timestamptz
          where id in (${sql.join(
            dropped.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
      );
    await tx.execute(
      sql`update pipeline.journeys set profile_id = ${into} where profile_id = ${from}`,
    );
    await tx.execute(
      sql`update pipeline.deals set profile_id = ${into} where profile_id = ${from}`,
    );
    return dropped;
  });
}
