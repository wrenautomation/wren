/**
 * Drafts (designs/2026-10-19-business-map.md, "History like git"): a shape body saved beside the
 * live shape. An agent or a person writes one, proposes it, and a person applies it as the next
 * version or drops it with a reason. Every write holds a lock on the draft's id; `applyDraft`
 * saves through `saveShape`, so a draft meets the same checks as any version.
 */
import { atomic, type Queryable, snapshot, type Tx } from "@wren/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Moves } from "./carry.js";
import { type DraftState, OPEN_DRAFT_STATES, type ShapeRef } from "./history.js";
import { isMetro } from "./metro.js";
import { type Conflict, conflictLine, mergeMetro } from "./metro-merge.js";
import { editMetro } from "./metro-ops.js";
import { type ShapeDraft, type ShapeVersion, shapeDrafts, shapeVersions } from "./schema.js";
import { lock, newestShape, Refused, saveShape, shapeContext } from "./store.js";
import { diffStored, metroView, type StoredBody, storedChangeLines } from "./stored.js";

const ID_LENGTH = 40;

/**
 * A draft's id from its name: lowercase letters, digits and dashes, starting with a letter, at
 * most 40 characters. A name that starts with a digit gets `d-` in front, so "2027 plan" and
 * "2028 plan" stay two ids. Refused when nothing is left.
 */
export function draftIdOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
  /** A graph body or a metro body. Left out: the body of `base`, as stored. */
  body?: StoredBody;
  moves?: Moves;
  /** The version it forks; the newest when left out. */
  base?: number;
  note?: string;
  by: string;
}

/**
 * Save a draft in state `draft`. The body is not checked: a draft may be half done, and apply
 * checks it. Without a `body` the draft forks `base` as it is stored: a graph stays a graph until
 * the first edit. Refused when the workspace has no shape, `base` is no version, or any draft, in
 * any state, already holds the id.
 */
export async function newDraft(db: Queryable, input: NewDraft): Promise<ShapeDraft> {
  const id = draftIdOf(input.name);
  return atomic(db, async (tx) => {
    await lock(tx, `shape_draft:${id}`);
    const newest = await newestShape(tx);
    if (!newest) throw new Refused(["Start or import a shape first."]);
    const base = input.base ?? newest.number;
    const [fork] = await tx
      .select({ number: shapeVersions.number, body: shapeVersions.body })
      .from(shapeVersions)
      .where(eq(shapeVersions.number, base));
    if (!fork) throw new Refused([`There is no shape version ${base}.`]);
    if (await draftOf(tx, id)) throw new Refused([`A draft "${id}" exists. Pick another name.`]);
    const [row] = await tx
      .insert(shapeDrafts)
      .values({
        id,
        name: input.name.trim(),
        body: input.body ?? fork.body,
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
  /** A graph body or a metro body. */
  body: StoredBody;
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

export interface DraftEdit {
  id: string;
  /** One op or a list of ops (`metro-ops.ts`). */
  ops: unknown;
  /** Who edits. The author stays `created_by`: a draft has one head and no edit log. */
  by: string;
  triggers: ReadonlySet<string>;
}

/**
 * Edit a draft with ops, all or nothing, in one transaction. The draft becomes a metro body (a
 * graph is drawn first). A batch is refused only when the result is not a metro body in
 * structure; what `checkMetro` and `lowerable` find comes back as `warnings`. `lines` say what
 * the batch changed. A refused batch leaves the draft as it was.
 */
export async function editDraft(
  db: Queryable,
  input: DraftEdit,
): Promise<{ draft: ShapeDraft; lines: string[]; warnings: string[] }> {
  return atomic(db, async (tx) => {
    const d = await lockedDraft(tx, input.id);
    mustBeOpen(d);
    const edited = editMetro(d.body, input.ops, await shapeContext(tx, input.triggers));
    const [draft] = await tx
      .update(shapeDrafts)
      .set({ body: edited.body, updatedAt: sql`now()` })
      .where(eq(shapeDrafts.id, input.id))
      .returning();
    if (!draft) throw new Error("draft update returned nothing");
    return { draft, lines: edited.lines, warnings: edited.warnings };
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

/** What apply would do with a draft. */
export interface ApplyPlan {
  draft: ShapeDraft;
  base: number;
  live: number;
  /** True when live moved since the draft's base. */
  moved: boolean;
  conflicts: Conflict[];
  conflictLines: string[];
  /** The body apply would save: the draft, merged with live when live moved. Always metro. */
  body: StoredBody;
  /** What the body changes in live, a line each. */
  lines: string[];
  /** Why apply would refuse before it looks at conflicts. Set when live is a graph. */
  refused?: string;
}

/** Apply needs a metro live. The convert is William's call. */
export const GRAPH_LIVE = "Live is a graph. Run `wren shape convert` first.";

/**
 * What applying the draft would do, without doing it. Reads the draft, its base version and the
 * newest, in one snapshot. The body is the draft as a metro body. When live moved, it merges by
 * id, three way (`mergeMetro`): one field changed on both sides to different values is a
 * conflict. When live is a graph, `refused` says so; the rest of the plan still answers.
 */
export async function planApply(db: Queryable, id: string): Promise<ApplyPlan> {
  return snapshot(db, async (tx) => {
    const draft = await draftOf(tx, id);
    if (!draft) throw new Refused([`There is no draft "${id}".`]);
    const live = await newestShape(tx);
    if (!live) throw new Refused(["Start or import a shape first."]);
    const [base] = await tx
      .select()
      .from(shapeVersions)
      .where(eq(shapeVersions.number, draft.base));
    if (!base) throw new Refused([`There is no shape version ${draft.base}.`]);
    const moved = live.number !== draft.base;
    const mine = metroView(draft.body);
    let body = mine;
    let conflicts: Conflict[] = [];
    let conflictLines: string[] = [];
    if (moved) {
      const [was, now] = [metroView(base.body), metroView(live.body)];
      const m = mergeMetro(was, now, mine);
      body = m.body;
      conflicts = m.conflicts;
      conflictLines = m.conflicts.map((c) => conflictLine(c, [now, mine, was]));
    }
    return {
      draft,
      base: base.number,
      live: live.number,
      moved,
      conflicts,
      conflictLines,
      body,
      lines: storedChangeLines(live.body, body, diffStored(live.body, body)),
      ...(isMetro(live.body) ? {} : { refused: GRAPH_LIVE }),
    };
  });
}

/**
 * Make the draft the next version, in one transaction: `planApply` (the merge), then `saveShape`
 * (its checks, "Nothing changed." and its carry of open journeys all pass through, and the draft
 * stays as it was), then the draft is `applied` with the version, who and when. Refused with
 * `GRAPH_LIVE` when live is a graph, and with the conflict lines when the merge has conflicts.
 * The version's note is the draft's note, else `Draft <name>`.
 */
export async function applyDraft(
  db: Queryable,
  input: { id: string; by: string; triggers: ReadonlySet<string> },
): Promise<{ draft: ShapeDraft; version: ShapeVersion }> {
  return atomic(db, async (tx) => {
    // The shape lock first, then the draft's: `saveShape` takes the shape lock again, which is safe.
    await lock(tx, "shape");
    const d = await lockedDraft(tx, input.id);
    mustBeOpen(d);
    const plan = await planApply(tx, d.id);
    if (plan.refused) throw new Refused([plan.refused]);
    if (plan.conflictLines.length > 0) throw new Refused(plan.conflictLines);
    const version = await saveShape(tx, {
      body: plan.body,
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

/** `12` or `draft:<id>` as a `ShapeRef`. Refused when it is neither. */
export function parseRef(v: unknown): ShapeRef {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    if (/^[1-9]\d*$/.test(v)) return Number(v);
    const id = /^draft:(.+)$/.exec(v)?.[1];
    if (id) return `draft:${id}`;
  }
  throw new Refused([`"${String(v)}" is not a version number or draft:<id>.`]);
}

/** The body a ref names, as stored: a version's or a draft's. Refused when there is none. */
export async function bodyOfRef(db: Queryable, ref: ShapeRef): Promise<StoredBody> {
  if (typeof ref === "number") {
    const [v] = await db.select().from(shapeVersions).where(eq(shapeVersions.number, ref));
    if (!v) throw new Refused([`There is no shape version ${ref}.`]);
    return v.body;
  }
  const d = await draftOf(db, ref.slice("draft:".length));
  if (!d) throw new Refused([`There is no draft "${ref.slice("draft:".length)}".`]);
  return d.body;
}
