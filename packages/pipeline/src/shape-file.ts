/**
 * The shape as a YAML file (designs/2026-10-19-business-map.md): the way to read it, diff it in
 * git, and write a whole new version at once. `exportShape` writes a body; `importShape` reads
 * a metro file and saves the next version.
 *
 * A file has `model: metro` at the top (`metro-file.ts`): `lines`, `stations`, `tracks`, `groups`
 * and `frames`, then optional `flows`, and optional `note`, `moves` and `terms`. `exportShape`
 * still writes a graph body as `name`, `nodes` and `edges`, so an old graph version can be read;
 * `parseShape` refuses such a file (HELD, C1 part 4): it needs `wren shape convert` first.
 *
 * `terms` is a list of terms versions (`NewTerms` without `by`). Each is added to its plan unless
 * the plan's newest version already has that body, so an import is safe to repeat.
 */

import { atomic, type Queryable } from "@wren/db";
import type { Terms } from "@wren/offers";
import { parse, stringify } from "yaml";
import type { Moves } from "./carry.js";
import { isMetro, type MetroBody } from "./metro.js";
import { exportMetro, ordered, parseMetroBody } from "./metro-file.js";
import type { ShapeVersion, TermsVersion } from "./schema.js";
import {
  addTerms,
  CONVERT_FIRST,
  canonicalJson,
  type NewTerms,
  newestShape,
  Refused,
  saveShape,
  termsHistory,
} from "./store.js";
import { type StoredBody, sameStored } from "./stored.js";

export type TermsEntry = Omit<NewTerms, "by">;

export interface ShapeFile {
  body: MetroBody;
  note?: string;
  moves?: Moves;
  terms?: TermsEntry[];
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A stored body as YAML text. A graph: name, nodes, edges. A metro body: `exportMetro`. Reads back
 * to the same body.
 */
export function exportShape(body: StoredBody): string {
  if (isMetro(body)) return exportMetro(body);
  return stringify({
    name: body.name,
    nodes: body.nodes.map((n) => ordered({ ...n })),
    edges: body.edges.map((e) => ordered({ ...e })),
  });
}

/** Text to a shape file. Refused, with every reason found, when it is not one. */
export function parseShape(text: string): ShapeFile {
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new Refused([`The file is not valid YAML: ${(e as Error).message.split("\n")[0]}`]);
  }
  if (!isMap(doc))
    throw new Refused(["The file needs model, name, lines and stations at the top."]);
  let body: MetroBody | undefined;
  if (doc.model === "metro") {
    // `note`, `moves` and `terms` are the file's, read below; the rest is the metro body.
    const rest = Object.fromEntries(
      Object.entries(doc).filter(([k]) => !["note", "moves", "terms"].includes(k)),
    );
    try {
      body = parseMetroBody(rest);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      errors.push(...e.errors);
    }
  } else if (doc.model !== undefined) {
    errors.push("model is metro.");
  } else {
    // A graph file: the one way on is `wren shape convert`, which writes a metro file.
    errors.push(CONVERT_FIRST);
  }
  let moves: Moves | undefined;
  if (doc.moves !== undefined) {
    if (!isMap(doc.moves) || Object.values(doc.moves).some((v) => typeof v !== "string"))
      errors.push("moves maps an old node id to a new one.");
    else moves = doc.moves as Moves;
  }
  let terms: TermsEntry[] | undefined;
  if (doc.terms !== undefined) {
    if (!Array.isArray(doc.terms)) errors.push("terms is a list.");
    else {
      terms = [];
      for (const [i, t] of doc.terms.entries()) {
        if (
          !isMap(t) ||
          typeof t.offer !== "string" ||
          typeof t.plan !== "string" ||
          typeof t.from !== "string" ||
          !isMap(t.body) ||
          typeof t.why !== "string"
        )
          errors.push(`Terms ${i + 1} needs offer, plan, from, body and why.`);
        else terms.push({ ...(t as unknown as TermsEntry), body: t.body as unknown as Terms });
      }
    }
  }
  if (doc.note !== undefined && typeof doc.note !== "string") errors.push("note is text.");
  if (errors.length || !body) throw new Refused(errors);
  return {
    body,
    ...(typeof doc.note === "string" ? { note: doc.note } : {}),
    ...(moves ? { moves } : {}),
    ...(terms ? { terms } : {}),
  };
}

export interface Imported {
  /** The new version. Null when the body equals the newest one. */
  shape: ShapeVersion | null;
  /** The terms versions the file added. */
  terms: TermsVersion[];
}

/**
 * Read a shape file and save it: the terms it lists, then the next shape version, in one
 * transaction. The shape's note is the file's `note`, else `o.note`.
 */
export async function importShape(
  db: Queryable,
  text: string,
  o: { by: string; triggers: ReadonlySet<string>; note?: string },
): Promise<Imported> {
  const file = parseShape(text);
  return atomic(db, async (tx) => {
    const terms: TermsVersion[] = [];
    for (const t of file.terms ?? []) {
      const history = await termsHistory(tx, t.offer, t.plan);
      const newest = history[history.length - 1];
      if (newest && canonicalJson(newest.body) === canonicalJson(t.body)) continue;
      terms.push(await addTerms(tx, { ...t, by: o.by }));
    }
    const last = await newestShape(tx);
    if (last && sameStored(last.body, file.body)) return { shape: null, terms };
    const shape = await saveShape(tx, {
      body: file.body,
      note: file.note ?? o.note ?? "",
      by: o.by,
      triggers: o.triggers,
      ...(file.moves ? { moves: file.moves } : {}),
    });
    return { shape, terms };
  });
}
