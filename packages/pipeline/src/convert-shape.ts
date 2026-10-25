/**
 * Move the shape from the graph model to the metro model (designs/2026-10-20-design-language.md,
 * area C1). `convertPlan` draws the newest body and proves the draw loses nothing. `convertShape`
 * saves it as the next version, only when every proof holds. The CLI shows the same report with
 * and without `--write`.
 *
 * The proofs, on the metro body `metroOf` draws:
 * - `checkStored` passes (the body is valid and lowers),
 * - `graphOf` of it is the newest graph, byte for byte after `canonicalJson`, less the stray
 *   fields the notes name (a field on a node or an edge that the graph model does not hold),
 * - `shapeWorkflow` of both is the same workflow, in both scopes.
 * Any miss refuses with the reason. So a convert never changes what the runtime runs.
 *
 * The deal rule is a separate fact the report states and the proofs do not test: a deal still
 * opens at the deal station (today's offer node). The map's rule would open it at the first
 * station of the offer line. The report shows, per offer line, where the two differ and how many
 * journeys are open on the stations between them.
 */
import { atomic, type Queryable } from "@wren/db";
import { graphOf, isStrayNote, metroOf, withoutStrayFields } from "./convert.js";
import { canonicalJson } from "./diff.js";
import { isMetro, type MetroBody, placesOf } from "./metro.js";
import type { ShapeBody, ShapeCheckContext } from "./model.js";
import { openNowOf } from "./numbers.js";
import { Refused } from "./refused.js";
import type { ShapeVersion } from "./schema.js";
import { lock, newestShape, saveShape, shapeContext } from "./store.js";
import { checkStored, type StoredBody } from "./stored.js";
import { shapeWorkflow } from "./workflow.js";

/** Where the deal opens on one offer line, and where the map's rule would open it. */
interface DealRule {
  /** The offer line (its id is the offer node's id). */
  line: string;
  /** The line's first station: the lowest place on the line, ties by body order. */
  first: string;
  /** The deal station: today's offer node. */
  deal: string;
  /**
   * The line's stations placed before the deal station, the first station included, in place
   * order, each with the journeys open on it now. Empty when the first station is the deal station.
   */
  between: { station: string; open: number }[];
}

export interface ConvertReport {
  /** What the metro model cannot keep (`metroOf` notes), a stray field included. */
  notes: string[];
  /** Why `checkStored` refuses the metro body. Empty when it passes. */
  checks: string[];
  /**
   * `graphOf` of the metro body is the newest graph. A stray field (a field the model does not
   * hold, noted in `notes`) is left out of the newest graph first. Nothing else is.
   */
  graphEqual: boolean;
  /** `shapeWorkflow` of both is the same, in both scopes. */
  workflowEqual: boolean;
  /** One entry per offer line. */
  deals: DealRule[];
}

/** What `convertPlan` makes of a stored body: the metro body, and its report unless it was metro. */
export type ConvertPlan =
  | { already: true; body: MetroBody }
  | { already: false; body: MetroBody; report: ConvertReport };

const SCOPES = ["wren", "client"] as const;

/** The two graphs run as the same workflow in both scopes. A body that will not generate is a miss. */
function sameWorkflow(number: number, a: ShapeBody, b: ShapeBody): boolean {
  try {
    return SCOPES.every(
      (scope) =>
        canonicalJson(shapeWorkflow(number, a, scope)) ===
        canonicalJson(shapeWorkflow(number, b, scope)),
    );
  } catch {
    return false;
  }
}

/** The deal rule of each offer line of a metro body. Pure. `open` maps a station id to its open journeys. */
export function dealRulesOf(metro: MetroBody, open: ReadonlyMap<string, number>): DealRule[] {
  const place = placesOf(metro);
  const at = (id: string) => place[id] ?? 0;
  const rules: DealRule[] = [];
  for (const line of metro.lines) {
    if (line.tier !== "core") continue;
    const mine = metro.stations.filter((s) => s.line === line.id);
    const deal = mine.find((s) => s.deal);
    if (!deal) continue;
    // `sort` is stable: equal places keep body order.
    const order = [...mine].sort((a, b) => at(a.id) - at(b.id));
    const first = order[0] ?? deal;
    rules.push({
      line: line.id,
      first: first.id,
      deal: deal.id,
      between:
        first.id === deal.id
          ? []
          : order
              .filter((s) => at(s.id) < at(deal.id))
              .map((s) => ({ station: s.id, open: open.get(s.id) ?? 0 })),
    });
  }
  return rules;
}

/** Every reason the convert must stop. Empty: all proofs hold. Pure. */
export function refusalsOf(r: ConvertReport): string[] {
  const out = r.checks.map((c) => `The metro body fails a check: ${c}`);
  if (!r.graphEqual) {
    out.push("The metro body does not give the same graph back.");
    // A stray field is noted but does not break the proof, so it is not a reason.
    const lost = r.notes.filter((n) => !isStrayNote(n));
    out.push(...lost.map((n) => `The convert drops: ${n}`));
    // No other note and still not equal: the same parts in another order (nodes or edges).
    if (!lost.length)
      out.push(
        "The graph lists its nodes or edges in another order than the metro model gives back.",
      );
  }
  if (!r.workflowEqual) out.push("The metro body does not run as the same workflow.");
  return out;
}

/**
 * The report as lines: notes, checks, graph equal, workflow equal, then the deal rule of each
 * offer line. Pure.
 */
export function reportLines(r: ConvertReport): string[] {
  const lines = [
    ...(r.notes.length ? r.notes.map((n) => `note: ${n}`) : ["notes: none"]),
    ...(r.checks.length ? r.checks.map((c) => `check: ${c}`) : ["checks: ok"]),
    `graph equal: ${r.graphEqual ? "yes" : "no"}`,
    `workflow equal: ${r.workflowEqual ? "yes" : "no"}`,
  ];
  for (const d of r.deals) {
    if (d.first === d.deal) {
      lines.push(`deal rule ${d.line}: first station ${d.first} is the deal station`);
      continue;
    }
    const total = d.between.reduce((n, s) => n + s.open, 0);
    const where = d.between.filter((s) => s.open > 0).map((s) => `${s.station} ${s.open}`);
    lines.push(
      `deal rule ${d.line}: first station ${d.first}, deal station ${d.deal}, ` +
        `open before the deal station: ${total}${where.length ? ` (${where.join(", ")})` : ""}`,
    );
  }
  return lines;
}

/**
 * Draw a stored body on the metro model and prove the draw. Pure: `ctx` is what `checkShape`
 * needs of the workspace and `open` maps a node id to its open journeys. Refused, with every
 * reason, when the graph cannot be drawn (`metroOf`). A body already on the metro model comes back
 * as it is. `number` is the version the body is (the workflow of both sides is generated for it).
 */
export function planConvert(
  stored: StoredBody,
  number: number,
  ctx: ShapeCheckContext,
  open: ReadonlyMap<string, number>,
): ConvertPlan {
  if (isMetro(stored)) return { already: true, body: stored };
  const drawn = metroOf(stored);
  if (!drawn.ok) throw new Refused(drawn.errors);
  const back = graphOf(drawn.body);
  return {
    already: false,
    body: drawn.body,
    report: {
      notes: drawn.notes,
      checks: checkStored(drawn.body, ctx),
      graphEqual: canonicalJson(back) === canonicalJson(withoutStrayFields(stored)),
      workflowEqual: sameWorkflow(number, back, stored),
      deals: dealRulesOf(drawn.body, open),
    },
  };
}

/** `planConvert` with the workspace read from the database. Reads only. */
async function convertPlan(
  db: Queryable,
  stored: StoredBody,
  number: number,
  triggers: ReadonlySet<string>,
): Promise<ConvertPlan> {
  if (isMetro(stored)) return { already: true, body: stored };
  return planConvert(stored, number, await shapeContext(db, triggers), await openNowOf(db));
}

/**
 * Save the newest graph version as a metro version, in one transaction under the shape lock.
 * Refused when there is no shape, when it is on the metro model already, or with every reason of
 * `refusalsOf` when a proof misses (nothing is saved). Open journeys carry as for any save: the
 * ids are the same, so none moves.
 */
export async function convertShape(
  db: Queryable,
  o: { note: string; by: string; triggers: ReadonlySet<string> },
): Promise<{ version: ShapeVersion; report: ConvertReport }> {
  return atomic(db, async (tx) => {
    await lock(tx, "shape");
    const newest = await newestShape(tx);
    if (!newest) throw new Refused(["The workspace has no shape yet."]);
    const plan = await convertPlan(tx, newest.body, newest.number, o.triggers);
    if (plan.already) throw new Refused(["The shape is on the metro model already."]);
    const why = refusalsOf(plan.report);
    if (why.length) throw new Refused(why);
    const version = await saveShape(tx, {
      body: plan.body,
      note: o.note,
      by: o.by,
      triggers: o.triggers,
    });
    return { version, report: plan.report };
  });
}
