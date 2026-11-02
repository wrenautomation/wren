/**
 * New version, same journeys (designs/2026-10-19-business-map.md): open journeys on an older
 * version move to `toVersion`. Each gets an arrival at the new workflow's node `s_<node>` with
 * the cause `{ kind: "version", ref: <old number> }` and its trail, so its page shows where it
 * crossed and `rebuildJourney` can seed the trail from it. No step runs and nothing fires: the
 * position did not change (or an operator named the new place in `moves`).
 *
 * A journey on a node the new body lacks, and `moves` does not name, stays on its version: a
 * ghost. Its moves follow its own version's edges. With branches (designs/2026-11-02-campaigns.md,
 * phase 4) every branch must land, a waiting one on its split and track. A branch before a race,
 * in the old or the new version, keeps the journey a ghost too: carry sets no clock, so the old
 * one rings in its own version, and a later carry takes the journey once a move took it on.
 *
 * `moves` also sends the open deals made at a moved node to the new node (`remapDeals`), so a
 * deal stays on a node the shape still has.
 */
import { events } from "@wren/core/schema";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { type Branch, branchesOf, MAIN, racesAfter, storedOf } from "./branches.js";
import { type Crossing, gateOf, type ShapeBody } from "./model.js";
import { instances, pipelineDeals, shapeVersions } from "./schema.js";
import { runOf } from "./stored.js";
import { shapeFlowId } from "./workflow.js";

/** The `by` of the arrivals carry writes. */
const CARRY_BY = "carry";

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
    const body = runOf(target.body);
    const inBody = new Set(body.nodes.map((n) => n.id));
    // A waiting branch lands on the same split and track.
    const lands = (b: Branch) =>
      b.pin
        ? gateOf(body, b.node)?.kind === "split" &&
          body.edges.some((e) => e.id === b.pin && e.from === b.node)
        : inBody.has(b.node);
    const olds = new Map<number, ShapeBody | null>();
    const oldOf = async (v: number) => {
      if (!olds.has(v)) {
        const [r] = await tx
          .select({ body: shapeVersions.body })
          .from(shapeVersions)
          .where(eq(shapeVersions.number, v))
          .limit(1);
        olds.set(v, r ? runOf(r.body) : null);
      }
      return olds.get(v) ?? null;
    };
    const open = await tx
      .select()
      .from(instances)
      .where(and(eq(instances.status, "open"), lt(instances.version, toVersion)))
      .for("update");
    let moved = 0;
    for (const j of open) {
      const was = branchesOf(j.branches, j.node);
      const old = await oldOf(j.version);
      if (old && was.some((b) => !b.pin && racesAfter(old, b.node).length > 0)) continue;
      const bs = was.map((b) => (b.pin ? b : { ...b, node: moves[b.node] ?? b.node }));
      if (!bs.every(lands)) continue;
      // Carry sets no clock: a station before a race is reached by a move only.
      if (bs.some((b) => !b.pin && racesAfter(body, b.node).length > 0)) continue;
      const node = moves[j.node] ?? j.node;
      const at = new Date();
      // The operator's move is a crossing the trail should show; a plain carry is not.
      const trail: Crossing[] = [
        ...j.trail,
        ...bs.flatMap((b, i) =>
          b.node === was[i]?.node
            ? []
            : [
                {
                  edge: null,
                  from: was[i]?.node ?? null,
                  to: b.node,
                  at: at.toISOString(),
                  ...(b.key === MAIN ? {} : { branch: b.key }),
                },
              ],
        ),
      ];
      const branches = storedOf(bs);
      // A plain carry sets `version` only: the segments trigger fires on `node`, and nothing moved.
      await tx
        .update(instances)
        .set(
          trail.length === j.trail.length
            ? { version: toVersion }
            : { version: toVersion, node, trail, branches },
        )
        .where(eq(instances.id, j.id));
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
            branches,
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

/**
 * Send every open deal made at a node that is a key of `moves` to the key's new node, as one
 * step per deal (`{ a: b, b: c }` sends a deal at `a` to `b`, not to `c`). A deal stays put when
 * its journey already has a deal at the new node: a journey holds one deal per node. Won and lost
 * deals stay where they were made. Gives back how many it moved.
 */
export async function remapDeals(db: Queryable, moves: Moves): Promise<number> {
  const from = Object.keys(moves).filter((k) => moves[k] !== k);
  if (from.length === 0) return 0;
  return atomic(db, async (tx) => {
    const open = await tx
      .select({ id: pipelineDeals.id, journey: pipelineDeals.journey, node: pipelineDeals.node })
      .from(pipelineDeals)
      .where(and(eq(pipelineDeals.status, "open"), inArray(pipelineDeals.node, from)))
      .for("update");
    if (open.length === 0) return 0;
    const held = await tx
      .select({ journey: pipelineDeals.journey, node: pipelineDeals.node })
      .from(pipelineDeals)
      .where(
        inArray(
          pipelineDeals.journey,
          open.map((d) => d.journey),
        ),
      );
    const taken = new Set(held.map((d) => `${d.journey}/${d.node}`));
    let moved = 0;
    for (const d of open) {
      const to = d.node === null ? undefined : moves[d.node];
      if (to === undefined || taken.has(`${d.journey}/${to}`)) continue;
      await tx.update(pipelineDeals).set({ node: to }).where(eq(pipelineDeals.id, d.id));
      taken.add(`${d.journey}/${to}`);
      moved++;
    }
    return moved;
  });
}
