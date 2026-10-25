/**
 * Attach and detach from a focus page (designs/2026-10-23-focus-view.md, F1): one `attach` or
 * `detach` op on the newest body, saved as the next version with a note that says what changed.
 * The console and the CLI share this path. A version, not a side table: an attach merges, diffs,
 * blames and undoes with the rest of the shape.
 */
import { atomic, type Queryable } from "@wren/db";
import type { Attach, MetroBody } from "./metro.js";
import { editMetro } from "./metro-ops.js";
import type { ShapeVersion } from "./schema.js";
import { lock, newestShape, Refused, saveShape, shapeContext } from "./store.js";
import { metroView } from "./stored.js";

type AttachOn = "line" | "station" | "group";

interface AttachInput {
  on: AttachOn;
  id: string;
  /** Exactly one of `add` and `remove` (a ref). */
  add?: Attach | undefined;
  remove?: string | undefined;
  by: string;
  triggers: ReadonlySet<string>;
}

/** Add or remove one attach on a line, station or group, as the next shape version. */
export async function attachShape(db: Queryable, o: AttachInput): Promise<ShapeVersion> {
  if ((o.add == null) === (o.remove == null))
    throw new Refused(["Send exactly one of add or remove."]);
  return atomic(db, async (tx) => {
    await lock(tx, "shape");
    const newest = await newestShape(tx);
    if (!newest) throw new Refused(["There is no shape yet."]);
    const op = o.add
      ? { op: "attach", on: o.on, id: o.id, ref: o.add }
      : { op: "detach", on: o.on, id: o.id, ref: o.remove };
    const edited = editMetro(newest.body, op, await shapeContext(tx, o.triggers));
    return saveShape(tx, {
      body: edited.body,
      note: noteOf(metroView(newest.body), o),
      by: o.by,
      triggers: o.triggers,
    });
  });
}

function noteOf(body: MetroBody, o: Pick<AttachInput, "on" | "id" | "add" | "remove">): string {
  const rows = o.on === "line" ? body.lines : o.on === "station" ? body.stations : body.groups;
  const name = rows.find((r) => r.id === o.id)?.label ?? o.id;
  if (o.add) return `Attach ${o.add.kind} "${o.add.label ?? o.add.ref}" to ${name}.`;
  const gone = rows.find((r) => r.id === o.id)?.attach?.find((a) => a.ref === o.remove);
  return `Detach ${gone?.kind ?? "ref"} "${gone?.label ?? o.remove}" from ${name}.`;
}
