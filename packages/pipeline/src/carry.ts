/**
 * New version, same journeys (designs/2026-10-18-journeys.md): open journeys on an older version
 * move to `toVersion` at the same stage. Each gets an arrival at the new workflow's stage node
 * with the cause `{ kind: "version", ref: <old number> }`, so its page shows where it crossed.
 * No step runs and nothing fires: the position did not change.
 */
import { events } from "@wren/core/schema";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, lt } from "drizzle-orm";
import { journeys } from "./schema.js";
import { funnelFlowId } from "./workflow.js";

/** The `by` of the arrivals carry writes. */
export const CARRY_BY = "carry";

/**
 * Move every open journey of `funnel` on a version before `toVersion` to it. The row for
 * `toVersion` must exist (the journey's foreign key). Safe to repeat: a carried journey is no
 * longer on an older version. Gives back the journeys it moved.
 */
export async function carryJourneys(
  db: Queryable,
  funnel: string,
  toVersion: number,
): Promise<number> {
  return atomic(db, async (tx) => {
    const open = await tx
      .select()
      .from(journeys)
      .where(
        and(
          eq(journeys.funnel, funnel),
          eq(journeys.status, "open"),
          lt(journeys.version, toVersion),
        ),
      )
      .for("update");
    for (const j of open) {
      await tx.update(journeys).set({ version: toVersion }).where(eq(journeys.id, j.id));
      await tx
        .insert(events)
        .values({
          workflow: funnelFlowId(funnel, toVersion),
          node: `s_${j.stage}`,
          port: "in",
          subject: `journey:${j.id}`,
          kind: "journey",
          data: {
            journey: j.id,
            profile: j.profileId,
            funnel,
            version: toVersion,
            from: null,
            to: j.stage,
            skipped: [],
            cause: { kind: "version", ref: String(j.version), at: new Date().toISOString() },
          },
          by: CARRY_BY,
        })
        .onConflictDoNothing();
    }
    return open.length;
  });
}
