/**
 * The shape as a YAML file (designs/2026-10-19-business-map.md): the way to read it, diff it in
 * git, and write a whole new version at once. `exportShape` writes a body; `importShape` reads
 * `{ name, nodes, edges, note?, moves?, terms? }` and saves the next version.
 *
 * An edge needs no `id` (it defaults to `<from>_to_<to>`) and no `kind` (it defaults to `flow`).
 * `terms` is a list of terms versions (`NewTerms` without `by`). Each is added to its plan unless
 * the plan's newest version already has that body, so an import is safe to repeat.
 */

import { atomic, type Queryable } from "@wren/db";
import type { Terms } from "@wren/offers";
import { parse, stringify } from "yaml";
import type { Moves } from "./carry.js";
import { edgeIdOf, type ShapeBody, type ShapeEdge, type ShapeNode } from "./model.js";
import type { ShapeVersion, TermsVersion } from "./schema.js";
import {
  addTerms,
  canonicalJson,
  type NewTerms,
  newestShape,
  Refused,
  saveShape,
  termsHistory,
} from "./store.js";

export type TermsEntry = Omit<NewTerms, "by">;

export interface ShapeFile {
  body: ShapeBody;
  note?: string;
  moves?: Moves;
  terms?: TermsEntry[];
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Keys a reader wants first, in this order. Others follow in the order they were set. */
const FIRST = ["id", "kind", "name", "from", "to", "label"];

const ordered = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(o).sort(([a], [b]) => {
      const x = FIRST.indexOf(a);
      const y = FIRST.indexOf(b);
      return (x < 0 ? FIRST.length : x) - (y < 0 ? FIRST.length : y);
    }),
  );

/** A shape body as YAML text: name, nodes, edges. Reads back to the same body. */
export function exportShape(body: ShapeBody): string {
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
  if (!isMap(doc)) throw new Refused(["The file needs name, nodes and edges at the top."]);
  if (typeof doc.name !== "string" || !doc.name.trim()) errors.push("The shape needs a name.");
  if (!Array.isArray(doc.nodes)) errors.push("nodes is a list.");
  if (doc.edges !== undefined && !Array.isArray(doc.edges)) errors.push("edges is a list.");
  const nodes: ShapeNode[] = [];
  for (const [i, n] of (Array.isArray(doc.nodes) ? doc.nodes : []).entries()) {
    if (!isMap(n) || typeof n.id !== "string") errors.push(`Node ${i + 1} needs an id.`);
    else nodes.push(n as unknown as ShapeNode);
  }
  const edges: ShapeEdge[] = [];
  for (const [i, e] of (Array.isArray(doc.edges) ? doc.edges : []).entries()) {
    if (!isMap(e) || typeof e.from !== "string" || typeof e.to !== "string")
      errors.push(`Edge ${i + 1} needs from and to.`);
    else
      edges.push({
        ...e,
        id: typeof e.id === "string" ? e.id : edgeIdOf(e.from, e.to),
        kind: e.kind === undefined ? "flow" : e.kind,
      } as ShapeEdge);
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
  if (errors.length) throw new Refused(errors);
  return {
    body: { name: String(doc.name), nodes, edges },
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
    if (last && canonicalJson(last.body) === canonicalJson(file.body))
      return { shape: null, terms };
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
