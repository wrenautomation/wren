/**
 * Cards (designs/2026-10-14-boards.md): a note of kind `task` on a board, in a column. This is
 * every way a card changes: made, moved and reordered, given to someone, closed and reopened,
 * blocked. Each change that matters writes a `task_moves` row, so the Timeline is the history.
 * Who may do what is `access.ts`'s answer on the note and `boards.ts`'s on the board; the
 * console and the CLI ask before calling these.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Reader } from "./access.js";
import { boardById, TaskRefusal } from "./boards.js";
import { positionBetween } from "./position.js";
import {
  type Board,
  type Note,
  noteComments,
  noteLinks,
  notes,
  taskBlocks,
  taskMoves,
} from "./schema.js";
import { createNote, visible } from "./store.js";
import { type BoardColumn, isAgent, type MoveKind, type NoteJson, type Via } from "./types.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_NAME = /^agent:[a-z0-9][\w.-]{0,40}$/;

/** An owner as stored: a lowercase email or `agent:<name>`; none is null. */
export function assigneeOf(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("agent:")) {
    if (!AGENT_NAME.test(s)) throw new TaskRefusal("an agent is agent:<name>");
    return s;
  }
  if (!EMAIL.test(s)) throw new TaskRefusal("give an email or agent:<name>");
  return s;
}

/** Most labels a card holds, and the longest one. */
export const LABELS_MAX = 12;
export const LABEL_MAX = 30;

/**
 * Labels as stored: free text, trimmed, one space between words, lowercase, no repeats, in the
 * order given. A string splits at `;`, `,` or a line break (the CSV and the CLI hand one over),
 * so a label never holds those. None is `[]`.
 */
export function labelsOf(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => String(x ?? "").split(/[;,\n]/));
  const out: string[] = [];
  for (const p of parts) {
    const label = p.trim().replace(/\s+/g, " ").toLowerCase();
    if (!label || out.includes(label)) continue;
    if (label.length > LABEL_MAX)
      throw new TaskRefusal(`a label is ${LABEL_MAX} characters at most`);
    out.push(label);
  }
  if (out.length > LABELS_MAX) throw new TaskRefusal(`a card holds ${LABELS_MAX} labels at most`);
  return out;
}

/** A due day as `YYYY-MM-DD`; none is null. */
export function dueOf(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
    throw new TaskRefusal("a due day is YYYY-MM-DD");
  return s;
}

/** Where a column is named by id or by name, any case. */
export function columnOf(board: Pick<Board, "columns">, ref: string): BoardColumn | null {
  const r = ref.trim().toLowerCase();
  return board.columns.find((c) => c.id === ref || c.name.toLowerCase() === r) ?? null;
}

export const firstOpen = (cols: readonly BoardColumn[]): BoardColumn =>
  cols.find((c) => !c.done) ?? (cols[0] as BoardColumn);
export const firstDone = (cols: readonly BoardColumn[]): BoardColumn =>
  cols.find((c) => c.done) ?? (cols.at(-1) as BoardColumn);

/**
 * Where an agent leaves a card a person owns instead of closing it: "Review", else the last
 * column that isn't done.
 */
export function reviewColumn(cols: readonly BoardColumn[]): BoardColumn {
  return (
    cols.find((c) => !c.done && c.name.toLowerCase() === "review") ??
    [...cols].reverse().find((c) => !c.done) ??
    (cols[0] as BoardColumn)
  );
}

// ---- Read ----

export interface TaskRow {
  id: string;
  title: string;
  text: string;
  boardId: string;
  columnId: string;
  position: string;
  owner: string;
  via: Via;
  assignee: string | null;
  due: string | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Free-text tags, lowercase. */
  labels: string[];
  /** Blockers still open. */
  blocked: number;
  /** Cards waiting on this one. */
  blocks: number;
  comments: number;
  /** Clients the card `@`s. */
  clients: { id: string; name: string }[];
  /** The row version: one up on every write of the card (0279). */
  version: number;
}

// Drizzle prints a lone table's columns unqualified, which the subqueries below would capture.
const NOTE_ID = sql.raw('"notes"."id"');

const openBlockers = sql<number>`(select count(*)::int from task_blocks tb join notes bn on bn.id = tb.blocked_by where tb.task_id = ${NOTE_ID} and bn.closed_at is null and bn.archived_at is null)`;
const blocking = sql<number>`(select count(*)::int from task_blocks tb where tb.blocked_by = ${NOTE_ID})`;
const commentCount = sql<number>`(select count(*)::int from ${noteComments} c where c.note_id = ${NOTE_ID})`;
const clientChips = sql<
  { id: string; name: string }[]
>`(select coalesce(json_agg(json_build_object('id', substr(l.target, 16), 'name', l.label)), '[]'::json) from ${noteLinks} l where l.note_id = ${NOTE_ID} and l.target like 'console.client:%')`;

const taskFields = {
  id: notes.id,
  title: notes.title,
  text: sql<string>`left(${notes.text}, 200)`,
  boardId: notes.boardId,
  columnId: notes.columnId,
  position: notes.position,
  owner: notes.owner,
  via: notes.via,
  assignee: notes.assignee,
  due: notes.due,
  closedAt: notes.closedAt,
  archivedAt: notes.archivedAt,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  labels: notes.labels,
  blocked: openBlockers,
  blocks: blocking,
  comments: commentCount,
  clients: clientChips,
  version: notes.version,
};

const toRow = (r: Record<string, unknown>): TaskRow => r as unknown as TaskRow;

export interface TaskFilter {
  board?: string;
  column?: string;
  /** An email or agent id; `null` for cards nobody owns. */
  assignee?: string | null;
  /** Only open cards (true) or only closed ones (false); both when left out. */
  open?: boolean;
  /** Only blocked cards (true) or only unblocked ones (false). */
  blocked?: boolean;
  /** Only cards that carry this label. */
  label?: string;
  /** Only these cards. */
  ids?: string[];
  q?: string;
  /** Cards this reader may open; none lists every card (the CLI). */
  reader?: Omit<Reader, "cap">;
  archived?: boolean;
  limit?: number;
}

/** Cards in column order, oldest first within a tie. */
export async function listTasks(db: Queryable, f: TaskFilter = {}): Promise<TaskRow[]> {
  const where: (SQL | undefined)[] = [
    eq(notes.kind, "task"),
    f.archived ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt),
    f.reader ? visible(f.reader) : undefined,
    f.board ? eq(notes.boardId, f.board) : undefined,
    f.column ? eq(notes.columnId, f.column) : undefined,
    f.assignee === undefined
      ? undefined
      : f.assignee === null
        ? isNull(notes.assignee)
        : eq(notes.assignee, f.assignee),
    f.open === undefined ? undefined : f.open ? isNull(notes.closedAt) : isNotNull(notes.closedAt),
    f.blocked === undefined
      ? undefined
      : f.blocked
        ? sql`${openBlockers} > 0`
        : sql`${openBlockers} = 0`,
    f.label?.trim() ? arrayContains(notes.labels, labelsOf(f.label)) : undefined,
    f.ids ? (f.ids.length ? inArray(notes.id, f.ids) : sql`false`) : undefined,
    f.q?.trim()
      ? or(
          sql`${notes.search} @@ websearch_to_tsquery('english', ${f.q.trim()})`,
          sql`${notes.title} ilike ${`%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
        )
      : undefined,
  ];
  const rows = await db
    .select(taskFields)
    .from(notes)
    .where(and(...where))
    .orderBy(sql`${notes.position} collate "C"`, asc(notes.createdAt), asc(notes.id))
    .limit(Math.min(Math.max(f.limit ?? 500, 1), 2000));
  return rows.map(toRow);
}

export async function taskById(db: Queryable, id: string): Promise<TaskRow | null> {
  const [row] = await db
    .select(taskFields)
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.kind, "task")));
  return row ? toRow(row) : null;
}

/**
 * What an agent should pick up next: open, nothing open blocking it, owned by `me` or nobody,
 * oldest first.
 */
export async function readyTasks(
  db: Queryable,
  me: string,
  o: { board?: string; limit?: number } = {},
): Promise<TaskRow[]> {
  const rows = await db
    .select(taskFields)
    .from(notes)
    .where(
      and(
        eq(notes.kind, "task"),
        isNull(notes.archivedAt),
        isNull(notes.closedAt),
        or(isNull(notes.assignee), eq(notes.assignee, me)),
        sql`${openBlockers} = 0`,
        o.board ? eq(notes.boardId, o.board) : undefined,
      ),
    )
    .orderBy(asc(notes.createdAt), asc(notes.id))
    .limit(Math.min(Math.max(o.limit ?? 50, 1), 500));
  return rows.map(toRow);
}

/** A card's neighbours in the block graph. */
export interface TaskRef {
  id: string;
  title: string;
  text: string;
  columnId: string | null;
  boardId: string | null;
  closedAt: Date | null;
}

const refFields = {
  id: notes.id,
  title: notes.title,
  text: sql<string>`left(${notes.text}, 80)`,
  columnId: notes.columnId,
  boardId: notes.boardId,
  closedAt: notes.closedAt,
};

/** The cards this one waits on. */
export const blockersOf = (db: Queryable, id: string): Promise<TaskRef[]> =>
  db
    .select(refFields)
    .from(taskBlocks)
    .innerJoin(notes, eq(notes.id, taskBlocks.blockedBy))
    .where(eq(taskBlocks.taskId, id))
    .orderBy(asc(taskBlocks.at));

/** The cards waiting on this one. */
export const blockingOf = (db: Queryable, id: string): Promise<TaskRef[]> =>
  db
    .select(refFields)
    .from(taskBlocks)
    .innerJoin(notes, eq(notes.id, taskBlocks.taskId))
    .where(eq(taskBlocks.blockedBy, id))
    .orderBy(asc(taskBlocks.at));

/** A card's history, newest first. */
export const movesOf = (db: Queryable, id: string) =>
  db
    .select()
    .from(taskMoves)
    .where(eq(taskMoves.taskId, id))
    .orderBy(desc(taskMoves.at), desc(taskMoves.id));

/**
 * How many cards wait on this person: theirs and due by `today`, or blocked on a card of
 * theirs. Home's Needs you.
 */
export async function needsYou(db: Queryable, email: string, today: string): Promise<number> {
  const me = email.toLowerCase();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notes)
    .where(
      and(
        eq(notes.kind, "task"),
        isNull(notes.archivedAt),
        isNull(notes.closedAt),
        or(
          and(eq(notes.assignee, me), isNotNull(notes.due), sql`${notes.due} <= ${today}`),
          sql`exists (select 1 from task_blocks tb join notes bn on bn.id = tb.blocked_by where tb.task_id = ${NOTE_ID} and bn.closed_at is null and bn.archived_at is null and bn.assignee = ${me})`,
        ),
      ),
    );
  return Number(row?.n ?? 0);
}

// ---- Create ----

export interface NewTask {
  board: Board;
  title: string;
  by: string;
  via?: Via;
  /** A column id or name; the first open one when left out. */
  column?: string;
  assignee?: string | null;
  due?: string | null;
  body?: NoteJson;
  /** Cards it waits on. */
  blockedBy?: readonly string[];
  why?: string | null;
  /** The note's owner when not `by`. */
  owner?: string;
  /** Free-text labels (an array, or one string split at `;` or `,`). */
  labels?: unknown;
}

const whyOf = (why: unknown) => {
  const s = typeof why === "string" ? why.trim().slice(0, 3000) : "";
  return s || null;
};

/** The place at the end of a column. */
async function lastPosition(db: Queryable, boardId: string, columnId: string): Promise<string> {
  const [last] = await db
    .select({ position: notes.position })
    .from(notes)
    .where(
      and(
        eq(notes.boardId, boardId),
        eq(notes.columnId, columnId),
        isNull(notes.archivedAt),
        isNotNull(notes.position),
      ),
    )
    .orderBy(desc(sql`${notes.position} collate "C"`))
    .limit(1);
  return positionBetween(last?.position ?? null, null);
}

/** A card at the end of a column, with its first move. */
export async function createTask(db: Db, o: NewTask): Promise<Note> {
  const title = o.title.trim();
  if (!title) throw new TaskRefusal("a card needs a title");
  if (title.length > 300) throw new TaskRefusal("that title is too long");
  const col = o.column ? columnOf(o.board, o.column) : firstOpen(o.board.columns);
  if (!col) throw new TaskRefusal(`no column "${o.column}" on ${o.board.name}`);
  const assignee = assigneeOf(o.assignee);
  const due = dueOf(o.due);
  const labels = labelsOf(o.labels);
  return atomic(db, async (tx) => {
    const made = await createNote(tx, {
      owner: o.owner ?? o.by,
      by: o.by,
      ...(o.via ? { via: o.via } : {}),
      title,
      ...(o.body ? { body: o.body } : {}),
      kind: "task",
    });
    const position = await lastPosition(tx, o.board.id, col.id);
    const [note] = await tx
      .update(notes)
      .set({
        boardId: o.board.id,
        columnId: col.id,
        position,
        assignee,
        due,
        labels,
        closedAt: col.done ? new Date() : null,
      })
      .where(eq(notes.id, made.id))
      .returning();
    await tx.insert(taskMoves).values({
      taskId: made.id,
      kind: "create",
      from: null,
      to: col.id,
      assignee,
      by: o.by,
      why: whyOf(o.why),
    });
    for (const b of o.blockedBy ?? []) await blockTask(tx, made.id, b, o.by);
    return note as Note;
  });
}

// ---- Move ----

export interface MoveOpts {
  /** A column id or name; the card's own when left out (a reorder). */
  column?: string | undefined;
  /** Put it just above this card, or just below. None puts it at the end of the column. */
  before?: string | null | undefined;
  after?: string | null | undefined;
  by: string;
  why?: string | null | undefined;
}

export interface Moved {
  task: TaskRow;
  /** The column changed (a move was written). */
  moved: boolean;
  /** Where it went instead: an agent can't close a card a person owns. */
  redirected: BoardColumn | null;
}

async function lockTask(tx: Queryable, id: string) {
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.kind, "task")))
    .for("update");
  if (!note?.boardId || !note.columnId) throw new TaskRefusal("no such card", 404);
  const board = await boardById(tx, note.boardId);
  if (!board) throw new TaskRefusal("no such board", 404);
  return { note, board };
}

const placeIn = (
  others: readonly { id: string; position: string | null }[],
  before: string | null | undefined,
  after: string | null | undefined,
): string => {
  let at = others.length;
  if (before) {
    const k = others.findIndex((x) => x.id === before);
    if (k >= 0) at = k;
  } else if (after) {
    const k = others.findIndex((x) => x.id === after);
    if (k >= 0) at = k + 1;
  }
  const lo = others[at - 1]?.position ?? null;
  const hi = others[at]?.position ?? null;
  try {
    return positionBetween(lo, hi);
  } catch {
    // Two cards on one place: land after the one above.
    return positionBetween(lo, null);
  }
};

/**
 * Put a card in a column, or reorder it within one. A change of column writes a move (a close
 * when it lands in a done column, a reopen when it leaves one). An agent leaves a card a person
 * owns in Review instead of closing it.
 */
export async function moveTask(db: Db, id: string, o: MoveOpts): Promise<Moved> {
  return atomic(db, async (tx) => {
    const { note, board } = await lockTask(tx, id);
    const from = board.columns.find((c) => c.id === note.columnId);
    let to = o.column ? columnOf(board, o.column) : (from ?? null);
    if (!to) throw new TaskRefusal(`no column "${o.column}" on ${board.name}`);
    let redirected: BoardColumn | null = null;
    if (isAgent(o.by) && to.done && !from?.done && note.assignee && !isAgent(note.assignee)) {
      to = reviewColumn(board.columns);
      redirected = to;
    }
    const changed = to.id !== note.columnId;
    let position = note.position;
    if (changed || o.before || o.after) {
      const others = await tx
        .select({ id: notes.id, position: notes.position })
        .from(notes)
        .where(
          and(
            eq(notes.boardId, board.id),
            eq(notes.columnId, to.id),
            ne(notes.id, id),
            isNull(notes.archivedAt),
          ),
        )
        .orderBy(sql`${notes.position} collate "C"`, asc(notes.createdAt), asc(notes.id));
      position = placeIn(others, o.before, o.after);
    }
    if (!changed && position === note.position)
      return { task: (await taskById(tx, id)) as TaskRow, moved: false, redirected };
    const closing = to.done && !from?.done;
    const reopening = !to.done && !!from?.done;
    await tx
      .update(notes)
      .set({
        columnId: to.id,
        position,
        ...(closing ? { closedAt: new Date() } : reopening ? { closedAt: null } : {}),
      })
      .where(eq(notes.id, id));
    if (changed) {
      const kind: MoveKind = closing ? "close" : reopening ? "reopen" : "move";
      await tx.insert(taskMoves).values({
        taskId: id,
        kind,
        from: note.columnId,
        to: to.id,
        assignee: note.assignee,
        by: o.by,
        why: whyOf(o.why),
      });
    }
    return { task: (await taskById(tx, id)) as TaskRow, moved: changed, redirected };
  });
}

/** Into the board's first done column; a card already closed stays. */
export async function closeTask(db: Db, id: string, o: { by: string; why?: string | null }) {
  const [t] = await db
    .select({ boardId: notes.boardId, columnId: notes.columnId })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.kind, "task")));
  const board = t?.boardId ? await boardById(db, t.boardId) : null;
  if (!board) throw new TaskRefusal("no such card", 404);
  if (board.columns.find((c) => c.id === t?.columnId)?.done)
    return { task: (await taskById(db, id)) as TaskRow, moved: false, redirected: null };
  return moveTask(db, id, { column: firstDone(board.columns).id, by: o.by, why: o.why });
}

/** Back into a column that isn't done (the first, or the one named). */
export async function reopenTask(
  db: Db,
  id: string,
  o: { by: string; why?: string | null; column?: string },
) {
  const [t] = await db
    .select({ boardId: notes.boardId })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.kind, "task")));
  const board = t?.boardId ? await boardById(db, t.boardId) : null;
  if (!board) throw new TaskRefusal("no such card", 404);
  const col = o.column ? columnOf(board, o.column) : firstOpen(board.columns);
  if (!col || col.done) throw new TaskRefusal("reopen it into a column that isn't done");
  return moveTask(db, id, { column: col.id, by: o.by, why: o.why });
}

/** Give a card to someone (an email or `agent:<name>`), or take the owner off with null. */
export async function assignTask(
  db: Db,
  id: string,
  who: unknown,
  o: { by: string; why?: string | null },
): Promise<TaskRow> {
  const assignee = assigneeOf(who);
  return atomic(db, async (tx) => {
    const { note } = await lockTask(tx, id);
    if (note.assignee !== assignee) {
      await tx.update(notes).set({ assignee }).where(eq(notes.id, id));
      await tx.insert(taskMoves).values({
        taskId: id,
        kind: "assign",
        from: note.columnId,
        to: note.columnId,
        assignee,
        by: o.by,
        why: whyOf(o.why),
      });
    }
    return (await taskById(tx, id)) as TaskRow;
  });
}

export async function setDue(db: Queryable, id: string, due: unknown): Promise<TaskRow> {
  const day = dueOf(due);
  await db
    .update(notes)
    .set({ due: day })
    .where(and(eq(notes.id, id), eq(notes.kind, "task")));
  const t = await taskById(db, id);
  if (!t) throw new TaskRefusal("no such card", 404);
  return t;
}

/** A card's labels, replaced by these. */
export async function setLabels(db: Queryable, id: string, raw: unknown): Promise<TaskRow> {
  const labels = labelsOf(raw);
  await db
    .update(notes)
    .set({ labels })
    .where(and(eq(notes.id, id), eq(notes.kind, "task")));
  const t = await taskById(db, id);
  if (!t) throw new TaskRefusal("no such card", 404);
  return t;
}

/** Onto another board, at the end of a column there (the first open one by default). */
export async function moveToBoard(
  db: Db,
  id: string,
  boardId: string,
  o: { by: string; column?: string },
): Promise<TaskRow> {
  return atomic(db, async (tx) => {
    const { note, board: was } = await lockTask(tx, id);
    const board = await boardById(tx, boardId);
    if (!board || board.archivedAt) throw new TaskRefusal("no such board", 404);
    if (board.id === was.id) return (await taskById(tx, id)) as TaskRow;
    const col = o.column ? columnOf(board, o.column) : firstOpen(board.columns);
    if (!col) throw new TaskRefusal(`no column "${o.column}" on ${board.name}`);
    await tx
      .update(notes)
      .set({
        boardId: board.id,
        columnId: col.id,
        position: await lastPosition(tx, board.id, col.id),
        closedAt: col.done ? (note.closedAt ?? new Date()) : null,
      })
      .where(eq(notes.id, id));
    await tx.insert(taskMoves).values({
      taskId: id,
      kind: col.done ? "close" : note.closedAt ? "reopen" : "move",
      from: note.columnId,
      to: col.id,
      assignee: note.assignee,
      by: o.by,
      why: `moved to ${board.name}`,
    });
    return (await taskById(tx, id)) as TaskRow;
  });
}

// ---- Blocks ----

/** `id` waits on `blockedBy`. Refused for a card on itself, or a loop. */
export async function blockTask(db: Queryable, id: string, blockedBy: string, by: string) {
  if (id === blockedBy) throw new TaskRefusal("a card can't wait on itself");
  await atomic(db, async (tx) => {
    const found = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(inArray(notes.id, [id, blockedBy]), eq(notes.kind, "task")));
    if (found.length !== 2) throw new TaskRefusal("both have to be cards", 404);
    // Walk up from the blocker: if it already waits on this card, it would loop.
    const seen = new Set<string>([blockedBy]);
    let frontier = [blockedBy];
    while (frontier.length && seen.size < 1000) {
      const up = await tx
        .select({ id: taskBlocks.blockedBy })
        .from(taskBlocks)
        .where(inArray(taskBlocks.taskId, frontier));
      frontier = [];
      for (const u of up) {
        if (u.id === id) throw new TaskRefusal("that would make a loop");
        if (!seen.has(u.id)) {
          seen.add(u.id);
          frontier.push(u.id);
        }
      }
    }
    await tx.insert(taskBlocks).values({ taskId: id, blockedBy, by }).onConflictDoNothing();
  });
}

export async function unblockTask(db: Queryable, id: string, blockedBy: string) {
  await db
    .delete(taskBlocks)
    .where(and(eq(taskBlocks.taskId, id), eq(taskBlocks.blockedBy, blockedBy)));
}
