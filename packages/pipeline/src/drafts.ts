/**
 * Drafts (designs/2026-10-19-business-map.md, "History like git"): a shape body saved beside the
 * live shape. An agent or a person writes one, proposes it, and a person applies it as the next
 * version or drops it with a reason. Every write holds a lock on the draft's id; `applyDraft`
 * saves through `saveShape`, so a draft meets the same checks as any version.
 */
import { atomic, type Queryable, type Tx } from "@wren/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Moves } from "./carry.js";
import { type DraftState, OPEN_DRAFT_STATES } from "./history.js";
import type { ShapeBody } from "./model.js";
import { type ShapeDraft, type ShapeVersion, shapeDrafts, shapeVersions } from "./schema.js";
import { lock, newestShape, Refused, saveShape } from "./store.js";

const ID_LENGTH = 40;

/**
 * A draft's id from its name: lowercase letters, digits and dashes, starting with a letter, at
 * most 40 characters. A name that starts with a digit gets `d-` in front, so "2027 plan" and
 * "2028 plan" stay two ids. Refused when nothing is left.
 */
export function draftIdOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Refused(["The draft needs a name."]);
  return (/^[a-z]/.test(slug) ? slug : `d-${slug}`).slice(0, ID_LENGTH).replace(/-+$/, "");
}

const isOpen = (state: DraftState): boolean =>
  (OPEN_DRAFT_STATES as readonly string[]).includes(state);

/** One draft, or null. */
export async function draftOf(db: Queryable, id: string): Promise<ShapeDraft | null> {
  const [row] = await db.select().from(shapeDrafts).where(eq(shapeDrafts.id, id));
  return row ?? null;
}

/** Drafts, newest change first. Narrow to some states with `states`. */
export async function draftsOf(
  db: Queryable,
  o: { states?: readonly DraftState[] } = {},
): Promise<ShapeDraft[]> {
  return db
    .select()
    .from(shapeDrafts)
    .where(o.states?.length ? inArray(shapeDrafts.state, [...o.states]) : undefined)
    .orderBy(desc(shapeDrafts.updatedAt), desc(shapeDrafts.id));
}

/** The draft, locked for this transaction. Refused when there is none. */
async function lockedDraft(tx: Tx, id: string) {
  await lock(tx, `shape_draft:${id}`);
  const row = await draftOf(tx, id);
  if (!row) throw new Refused([`There is no draft "${id}".`]);
  return row;
}

/** Refused unless the draft can still change. */
function mustBeOpen(d: ShapeDraft): void {
  if (!isOpen(d.state))
    throw new Refused([`The draft "${d.id}" is ${d.state}. Only an open draft changes.`]);
}

export interface NewDraft {
  name: string;
  body: ShapeBody;
  moves?: Moves;
  /** The version it forks; the newest when left out. */
  base?: number;
  note?: string;
  by: string;
}

/**
 * Save a draft in state `draft`. The body is not checked: a draft may be half done, and apply
 * checks it. Refused when the workspace has no shape, `base` is no version, or any draft, in any
 * state, already holds the id.
 */
export async function newDraft(db: Queryable, input: NewDraft): Promise<ShapeDraft> {
  const id = draftIdOf(input.name);
  return atomic(db, async (tx) => {
    await lock(tx, `shape_draft:${id}`);
    const newest = await newestShape(tx);
    if (!newest) throw new Refused(["Start or import a shape first."]);
    const base = input.base ?? newest.number;
    const [fork] = await tx
      .select({ number: shapeVersions.number })
      .from(shapeVersions)
      .where(eq(shapeVersions.number, base));
    if (!fork) throw new Refused([`There is no shape version ${base}.`]);
    if (await draftOf(tx, id)) throw new Refused([`A draft "${id}" exists. Pick another name.`]);
    const [row] = await tx
      .insert(shapeDrafts)
      .values({
        id,
        name: input.name.trim(),
        body: input.body,
        moves: input.moves ?? {},
        base,
        note: input.note ?? "",
        createdBy: input.by,
      })
      .returning();
    if (!row) throw new Error("draft insert returned nothing");
    return row;
  });
}

export interface DraftUpdate {
  id: string;
  body: ShapeBody;
  /** Replaces the moves; none clears them. */
  moves?: Moves;
  /** Left out keeps the note. */
  note?: string;
  by: string;
}

/** Overwrite a draft's body and moves (and its note when given). Its state stays. */
export async function updateDraft(db: Queryable, input: DraftUpdate): Promise<ShapeDraft> {
  return atomic(db, async (tx) => {
    mustBeOpen(await lockedDraft(tx, input.id));
    const [row] = await tx
      .update(shapeDrafts)
      .set({
        body: input.body,
        moves: input.moves ?? {},
        ...(input.note !== undefined ? { note: input.note } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(shapeDrafts.id, input.id))
      .returning();
    if (!row) throw new Error("draft update returned nothing");
    return row;
  });
}

/** `draft` to `proposed`: it waits for a person to apply or drop it. */
export async function proposeDraft(
  db: Queryable,
  input: { id: string; by: string },
): Promise<ShapeDraft> {
  return atomic(db, async (tx) => {
    const d = await lockedDraft(tx, input.id);
    if (d.state !== "draft")
      throw new Refused([`The draft "${d.id}" is ${d.state}. Only a draft can be proposed.`]);
    const [row] = await tx
      .update(shapeDrafts)
      .set({ state: "proposed", updatedAt: sql`now()` })
      .where(eq(shapeDrafts.id, input.id))
      .returning();
    if (!row) throw new Error("draft update returned nothing");
    return row;
  });
}

/**
 * Make the draft the next version, in one transaction: `saveShape` (its checks, "Nothing
 * changed." and its carry of open journeys all pass through, and the draft stays as it was),
 * then the draft is `applied` with the version, who and when. The version's note is the draft's
 * note, else `Draft <name>`.
 */
export async function applyDraft(
  db: Queryable,
  input: { id: string; by: string; triggers: ReadonlySet<string> },
): Promise<{ draft: ShapeDraft; version: ShapeVersion }> {
  return atomic(db, async (tx) => {
    const d = await lockedDraft(tx, input.id);
    mustBeOpen(d);
    const version = await saveShape(tx, {
      body: d.body,
      moves: d.moves,
      note: d.note || `Draft ${d.name}`,
      by: input.by,
      triggers: input.triggers,
      draft: d.id,
    });
    const [draft] = await tx
      .update(shapeDrafts)
      .set({
        state: "applied",
        appliedVersion: version.number,
        decidedBy: input.by,
        decidedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(shapeDrafts.id, d.id))
      .returning();
    if (!draft) throw new Error("draft update returned nothing");
    return { draft, version };
  });
}

/** `draft` or `proposed` to `dropped`, with who, when and why. */
export async function dropDraft(
  db: Queryable,
  input: { id: string; by: string; reason: string },
): Promise<ShapeDraft> {
  const reason = input.reason.trim();
  if (!reason) throw new Refused(["Say why."]);
  return atomic(db, async (tx) => {
    mustBeOpen(await lockedDraft(tx, input.id));
    const [row] = await tx
      .update(shapeDrafts)
      .set({
        state: "dropped",
        decidedBy: input.by,
        decidedAt: sql`now()`,
        dropReason: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(shapeDrafts.id, input.id))
      .returning();
    if (!row) throw new Error("draft update returned nothing");
    return row;
  });
}
