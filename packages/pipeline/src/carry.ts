/**
 * New version, same journeys (designs/2026-10-19-business-map.md): open journeys on an older
 * version move to `toVersion`. Each gets an arrival at the new workflow's node `s_<node>` with
 * the cause `{ kind: "version", ref: <old number> }` and its trail, so its page shows where it
 * crossed and `rebuildJourney` can seed the trail from it. No step runs and nothing fires: the
 * position did not change (or an operator named the new place in `moves`).
 *
 * A journey on a node the new body lacks, and `moves` does not name, stays on its version: a
 * ghost. Its moves follow its own version's edges.
 */
import { events } from "@wren/core/schema";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, lt } from "drizzle-orm";
import type { Crossing } from "./model.js";
import { journeys, shapeVersions } from "./schema.js";
import { shapeFlowId } from "./workflow.js";

/** The `by` of the arrivals carry writes. */
export const CARRY_BY = "carry";

/** `{ oldNode: newNode }`: where journeys on a removed node go. */
export type Moves = Record<string, string>;

/**
 * Move every open journey on a version before `toVersion` whose node is in the new body, or is a
 * key of `moves`, to `toVersion`. The row for `toVersion` must exist (the journey's foreign key).
 * Safe to repeat: a carried journey is no longer on an older version. Gives back how many it moved.
 */
export async function carryJourneys(
  db: Queryable,
  toVersion: number,
  moves: Moves = {},
): Promise<number> {
  return atomic(db, async (tx) => {
    const [target] = await tx
      .select({ body: shapeVersions.body })
      .from(shapeVersions)
      .where(eq(shapeVersions.number, toVersion))
      .limit(1);
    if (!target) return 0;
    const inBody = new Set(target.body.nodes.map((n) => n.id));
    const open = await tx
      .select()
      .from(journeys)
      .where(and(eq(journeys.status, "open"), lt(journeys.version, toVersion)))
      .for("update");
    let moved = 0;
    for (const j of open) {
      if (j.node === null || j.version === null) continue;
      const node = moves[j.node] ?? j.node;
      if (!inBody.has(node)) continue;
      const at = new Date();
      // The operator's move is a crossing the trail should show; a plain carry is not.
      const trail: Crossing[] =
        node === j.node
          ? j.trail
          : [...j.trail, { edge: null, from: j.node, to: node, at: at.toISOString() }];
      // A plain carry sets `version` only: the segments trigger fires on `node`, and nothing moved.
      await tx
        .update(journeys)
        .set(node === j.node ? { version: toVersion } : { version: toVersion, node, trail })
        .where(eq(journeys.id, j.id));
      await tx
        .insert(events)
        .values({
          workflow: shapeFlowId(toVersion),
          node: `s_${node}`,
          port: "in",
          subject: `journey:${j.id}`,
          kind: "journey",
          data: {
            journey: j.id,
            profile: j.profileId,
            version: toVersion,
            from: null,
            to: node,
            edges: [],
            skipped: [],
            trail,
            cause: { kind: "version", ref: String(j.version), at: at.toISOString() },
          },
          by: CARRY_BY,
        })
        .onConflictDoNothing();
      moved++;
    }
    return moved;
  });
}
