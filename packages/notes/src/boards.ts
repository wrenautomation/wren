/**
 * Boards (designs/2026-10-14-boards.md): the kanban a card sits on. A board is shared like a
 * note: an owner, general access, `board_shares`. Who may open it may open its cards, with its
 * role (never above edit). Pure checks here; `tasks.ts` has the cards.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { clientWho, noteRole, type Reader, TEAM } from "./access.js";
import { type Board, boardShares, boards, notes } from "./schema.js";
import {
  type BoardColumn,
  DEFAULT_BOARD,
  DEFAULT_COLUMNS,
  type General,
  type Role,
  type ShareRole,
} from "./types.js";

/** A refusal the person asking can act on, with an HTTP status. */
export class TaskRefusal extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBoardId = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "column";

/**
 * A board's columns from what was sent: 2 to 12, each named, ids kept or made from the name,
 * with at least one that closes cards and one that doesn't.
 */
export function parseColumns(raw: unknown): BoardColumn[] {
  if (!Array.isArray(raw)) throw new TaskRefusal("columns are a list");
  if (raw.length < 2 || raw.length > 12) throw new TaskRefusal("a board has 2 to 12 columns");
  const out: BoardColumn[] = [];
  for (const c of raw as { id?: unknown; name?: unknown; done?: unknown }[]) {
    const name = String(c?.name ?? "").trim();
    if (!name) throw new TaskRefusal("every column needs a name");
    if (name.length > 40) throw new TaskRefusal(`${name.slice(0, 20)}… is too long a name`);
    let id = typeof c.id === "string" && /^[\w-]{1,40}$/.test(c.id) ? c.id : slug(name);
    for (let n = 2; out.some((o) => o.id === id); n++) id = `${slug(name).slice(0, 36)}-${n}`;
    out.push({ id, name, done: c.done === true });
  }
  if (!out.some((c) => c.done)) throw new TaskRefusal("one column must close its cards (Done)");
  if (out.every((c) => c.done)) throw new TaskRefusal("one column must stay open (To do)");
  if (new Set(out.map((c) => c.name.toLowerCase())).size !== out.length)
    throw new TaskRefusal("two columns have the same name");
  return out;
}

export async function boardById(db: Queryable, id: string): Promise<Board | null> {
  if (!isBoardId(id)) return null;
  const [row] = await db.select().from(boards).where(eq(boards.id, id));
  return row ?? null;
}

export const boardSharesOf = (db: Queryable, id: string) =>
  db.select().from(boardShares).where(eq(boardShares.boardId, id)).orderBy(asc(boardShares.at));

/** The board's role for a reader, from its rows. */
export async function boardRoleOn(
  db: Queryable,
  board: Board,
  r: Omit<Reader, "cap">,
): Promise<Role | null> {
  return noteRole(board, await boardSharesOf(db, board.id), r);
}

/** Which boards a reader may open, as SQL on `boards`; `alias` names the table in a subquery. */
export function boardVisible(r: Omit<Reader, "cap">, alias = "boards"): SQL {
  const t = sql.identifier(alias);
  const whos = [
    r.email.toLowerCase(),
    ...(r.team ? [TEAM] : []),
    ...(r.client ? [clientWho(r.client)] : []),
  ];
  return or(
    r.email ? sql`lower(${t}.owner) = ${r.email.toLowerCase()}` : sql`false`,
    sql`exists (select 1 from ${boardShares} s where s.board_id = ${t}.id and lower(s.who) in (${sql.join(
      whos.map((w) => sql`${w}`),
      sql`, `,
    )}))`,
    r.inWorkspace ? sql`${t}.general = 'workspace'` : sql`false`,
  ) as SQL;
}

/** The workspace's Work board, made on first use: everyone here edits it. */
export async function defaultBoard(db: Db, by: string): Promise<Board> {
  const find = async () => {
    const [row] = await db.select().from(boards).where(eq(boards.isDefault, true));
    return row ?? null;
  };
  const have = await find();
  if (have) return have;
  await db
    .insert(boards)
    .values({
      name: DEFAULT_BOARD,
      columns: [...DEFAULT_COLUMNS],
      owner: by,
      general: "workspace",
      generalRole: "edit",
      isDefault: true,
    })
    .onConflictDoNothing();
  const made = await find();
  if (!made) throw new Error("board not made");
  return made;
}

export interface BoardListOpts {
  /** Only boards shared to these `who`s (a Wren board shared to a client, read from main). */
  sharedTo?: readonly string[];
  /** Every board, whoever's: the CLI without `--as`. */
  everything?: boolean;
  archived?: boolean;
}

/** Boards a reader may open, the default first, then oldest first. */
export function listBoards(db: Queryable, r: Omit<Reader, "cap">, o: BoardListOpts = {}) {
  const who = o.sharedTo
    ? sql`exists (select 1 from ${boardShares} s where s.board_id = ${boards.id} and s.who in (${sql.join(
        o.sharedTo.map((w) => sql`${w}`),
        sql`, `,
      )}))`
    : o.everything
      ? undefined
      : boardVisible(r);
  return db
    .select()
    .from(boards)
    .where(and(who, o.archived ? undefined : isNull(boards.archivedAt)))
    .orderBy(desc(boards.isDefault), asc(boards.createdAt));
}

const nameOf = (raw: unknown) => {
  const s = String(raw ?? "").trim();
  if (!s) throw new TaskRefusal("a board needs a name");
  if (s.length > 120) throw new TaskRefusal("that name is too long");
  return s;
};

export interface NewBoard {
  name: string;
  columns?: unknown;
  owner: string;
  general?: General;
  generalRole?: ShareRole;
}

/** A new board; private to its owner unless shared. */
export async function createBoard(db: Db, o: NewBoard): Promise<Board> {
  const [row] = await db
    .insert(boards)
    .values(
      pgSafe({
        name: nameOf(o.name),
        columns: o.columns === undefined ? [...DEFAULT_COLUMNS] : parseColumns(o.columns),
        owner: o.owner,
        general: o.general ?? "private",
        generalRole: o.generalRole ?? "view",
      }),
    )
    .returning();
  if (!row) throw new Error("board not made");
  return row;
}

/**
 * A board's name and columns saved. A column that cards sit in can't go: they'd lose their place.
 */
export async function saveBoard(
  db: Db,
  id: string,
  o: { name?: unknown; columns?: unknown; expect?: number },
): Promise<Board> {
  return atomic(db, async (tx) => {
    const [board] = await tx.select().from(boards).where(eq(boards.id, id)).for("update");
    if (!board) throw new TaskRefusal("no such board", 404);
    // Started from an older version: someone saved since. Their change shows on the next read.
    if (o.expect !== undefined && board.version !== o.expect)
      throw new TaskRefusal(
        "someone saved this board after you opened it. Pick the version to keep, then save",
        409,
      );
    const set: Partial<typeof boards.$inferInsert> = { updatedAt: new Date() };
    if (o.name !== undefined) set.name = nameOf(o.name);
    if (o.columns !== undefined) {
      const next = parseColumns(o.columns);
      const gone = board.columns.filter((c) => !next.some((n) => n.id === c.id));
      if (gone.length) {
        const [held] = await tx
          .select({ column: notes.columnId })
          .from(notes)
          .where(
            and(
              eq(notes.boardId, id),
              sql`${notes.columnId} in (${sql.join(
                gone.map((g) => sql`${g.id}`),
                sql`, `,
              )})`,
            ),
          )
          .limit(1);
        if (held)
          throw new TaskRefusal(
            `${gone.find((g) => g.id === held.column)?.name ?? "that column"} still has cards`,
            409,
          );
      }
      // A column's done flag moving would strand its cards' closed time.
      for (const c of next) {
        const was = board.columns.find((b) => b.id === c.id);
        if (was && was.done !== c.done) {
          const [held] = await tx
            .select({ id: notes.id })
            .from(notes)
            .where(and(eq(notes.boardId, id), eq(notes.columnId, c.id)))
            .limit(1);
          if (held) throw new TaskRefusal(`${c.name} still has cards; empty it first`, 409);
        }
      }
      set.columns = next;
    }
    const [row] = await tx.update(boards).set(set).where(eq(boards.id, id)).returning();
    return row as Board;
  });
}

export async function shareBoard(
  db: Queryable,
  id: string,
  who: string,
  role: ShareRole | null,
  by: string,
) {
  const w = who.includes("@") ? who.trim().toLowerCase() : who.trim();
  if (!role) {
    await db.delete(boardShares).where(and(eq(boardShares.boardId, id), eq(boardShares.who, w)));
    return;
  }
  await db
    .insert(boardShares)
    .values({ boardId: id, who: w, role, by })
    .onConflictDoUpdate({
      target: [boardShares.boardId, boardShares.who],
      set: { role, by, at: new Date() },
    });
}

export async function setBoardGeneral(
  db: Queryable,
  id: string,
  general: General,
  role: ShareRole,
) {
  await db
    .update(boards)
    .set({ general, generalRole: role, updatedAt: new Date() })
    .where(eq(boards.id, id));
}

export async function setBoardArchived(db: Queryable, id: string, on: boolean) {
  await db
    .update(boards)
    .set({ archivedAt: on ? new Date() : null, updatedAt: new Date() })
    .where(eq(boards.id, id));
}
