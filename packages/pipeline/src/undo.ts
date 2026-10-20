/**
 * Undo one change of a past diff (designs/2026-10-19-business-map.md, "Undo one change"): the
 * console and the CLI plan and save it here, one path. `undoChange` (`edit.ts`) is the pure
 * inverse; this reads the versions, adds the checks that need the database (the whole result
 * through `checkShape`, open journeys on a node the undo would remove) and saves the result as the
 * next version with the note `Undo: <line>`.
 */
import { atomic, type Queryable } from "@wren/db";
import { canonicalJson, changeLine, diffShapes, parseChangeKey, type ShapeDiff } from "./diff.js";
import { openOn, undoChange } from "./edit.js";
import { checkShape, type ShapeBody } from "./model.js";
import type { ShapeVersion } from "./schema.js";
import { lock, Refused, saveShape, shapeContext, shapeVersionsOf } from "./store.js";

export interface UndoPlan {
  /** The change as `changeLine` says it. */
  line: string;
  /** The note the undo saves with. */
  note: string;
  /** The newest version: what the undo applies to. */
  newest: ShapeVersion;
  /** The newest body after the undo. */
  result: ShapeBody;
  /** From the newest body to the result. */
  diff: ShapeDiff;
}

/**
 * What undoing `change` of the diff from version `a` to `b` would do to the newest version.
 * Refused with every reason: a key that names no change, a missing version, `undoChange`'s own
 * refusal, a result `checkShape` fails, open journeys on a node the undo removes.
 */
export async function planUndo(
  db: Queryable,
  o: { a: number; b: number; change: string; triggers: ReadonlySet<string> },
): Promise<UndoPlan> {
  const change = parseChangeKey(o.change);
  if (!change)
    throw new Refused([
      `"${o.change}" names no change. Use a key from the diff, like node:<id>:added.`,
    ]);
  const all = await shapeVersionsOf(db);
  const newest = all[all.length - 1];
  const [a, b] = [o.a, o.b].map((n) => all.find((v) => v.number === Number(n)));
  const missing = [o.a, o.b].filter((n) => !all.some((v) => v.number === Number(n)));
  if (!newest || !a || !b)
    throw new Refused(
      missing.length
        ? missing.map((n) => `There is no shape version ${n}.`)
        : ["The workspace has no shape yet."],
    );
  const errors: string[] = [];
  let result: ShapeBody | null = null;
  try {
    result = undoChange(newest.body, a.body, b.body, change);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    errors.push(...e.errors);
  }
  if (change.on === "node" && change.how === "added") {
    const open = await openOn(db, change.id);
    if (open > 0)
      errors.push(
        `${open} open ${open === 1 ? "journey sits" : "journeys sit"} on ${change.id}. Move them first.`,
      );
  }
  if (result) {
    if (canonicalJson(result) === canonicalJson(newest.body)) errors.push("Nothing changed.");
    errors.push(...checkShape(result, await shapeContext(db, o.triggers)));
  }
  if (errors.length || !result) throw new Refused(errors);
  const line = changeLine(a.body, b.body, change);
  return {
    line,
    note: `Undo: ${line}`,
    newest,
    result,
    diff: diffShapes(newest.body, result),
  };
}

/**
 * Save the undo as the next version, planned and written under the shape's lock, so a version
 * that lands meanwhile is never overwritten.
 */
export async function undoShape(
  db: Queryable,
  o: { a: number; b: number; change: string; by: string; triggers: ReadonlySet<string> },
): Promise<ShapeVersion> {
  return atomic(db, async (tx) => {
    await lock(tx, "shape");
    const plan = await planUndo(tx, o);
    return saveShape(tx, {
      body: plan.result,
      note: plan.note,
      by: o.by,
      triggers: o.triggers,
    });
  });
}
