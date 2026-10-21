/**
 * The starter shape (designs/2026-10-19-business-map.md, "Seeds"): kinds only, no account, amount
 * or terms. An empty database starts here; a database that has a shape never does. The file sits
 * beside this module, and the bundles that carry it copy it beside them (`app/starter.yaml`).
 */
import { readFileSync } from "node:fs";
import type { Queryable } from "@wren/db";
import { isMetro } from "./metro.js";
import type { ShapeBody } from "./model.js";
import type { ShapeVersion } from "./schema.js";
import { importShape, parseShape, type ShapeFile } from "./shape-file.js";
import { newestShape } from "./store.js";

/** The note the first version carries. */
export const STARTER_NOTE = "Starter";

const starterText = (): string => readFileSync(new URL("./starter.yaml", import.meta.url), "utf8");

/** The starter as a shape file. Read on each call, so a caller may change what it gets. */
export const starterShape = (): ShapeFile & { body: ShapeBody } => {
  const file = parseShape(starterText());
  if (isMetro(file.body)) throw new Error("The starter file must be a graph.");
  return { ...file, body: file.body };
};

/**
 * Save the starter as the next version, with the note "Starter". Null, and nothing written, when
 * the database already has a shape. Saved as any import is: checked, in one transaction.
 */
export async function startShape(
  db: Queryable,
  o: { by: string; triggers: ReadonlySet<string> },
): Promise<ShapeVersion | null> {
  if (await newestShape(db)) return null;
  return (await importShape(db, starterText(), { ...o, note: STARTER_NOTE })).shape;
}
