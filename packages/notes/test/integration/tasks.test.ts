/**
 * Boards and cards on a real Postgres (designs/2026-10-14-boards.md): the default board, cards
 * in columns and their order, the move history, closing and reopening, an agent's limit,
 * blockers and the ready list, and who may open a board's cards. Synthetic logins throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assignTask,
  blockersOf,
  blockingOf,
  blockTask,
  boardRoleOn,
  closeTask,
  createBoard,
  createTask,
  defaultBoard,
  listBoards,
  listNotes,
  listTasks,
  movesOf,
  moveTask,
  moveToBoard,
  needsYou,
  noteById,
  readyTasks,
  reopenTask,
  roleOn,
  saveBoard,
  setBoardGeneral,
  setDue,
  setLabels,
  shareBoard,
  TaskRefusal,
  taskById,
  unblockTask,
} from "../../src/index.js";

let pg: TestPostgres;
const TABLES = ["task_moves", "task_blocks", "board_shares", "boards", "note_links", "notes"];
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
});

const ADA = "ada@example.test";
const OZ = "oz@example.test";
const CLAUDE = "agent:claude";
const db = () => pg.db;
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("boards", () => {
  it("makes the Work board once, open to the workspace", async () => {
    const [a, b] = await Promise.all([defaultBoard(db(), ADA), defaultBoard(db(), OZ)]);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("Work");
    expect(a.columns.map((c) => c.name)).toEqual(["To do", "Doing", "Done"]);
    expect(a.columns.map((c) => c.done)).toEqual([false, false, true]);
    const team = { email: OZ, team: true, inWorkspace: true, client: null };
    expect(await boardRoleOn(db(), a, team)).toBe("edit");
    expect(await boardRoleOn(db(), a, { ...team, inWorkspace: false, team: false })).toBeNull();
  });

  it("refuses bad columns and a column that still holds cards", async () => {
    await expect(
      createBoard(db(), { name: "X", owner: ADA, columns: [{ name: "Only", done: true }] }),
    ).rejects.toThrow(/2 to 12/);
    await expect(
      createBoard(db(), {
        name: "X",
        owner: ADA,
        columns: [
          { name: "A", done: false },
          { name: "B", done: false },
        ],
      }),
    ).rejects.toThrow(/closes its cards|close/);
    const board = await createBoard(db(), { name: "Plan", owner: ADA });
    await createTask(db(), { board, title: "One", by: ADA });
    await expect(
      saveBoard(db(), board.id, {
        columns: [
          { id: "doing", name: "Doing", done: false },
          { id: "done", name: "Done", done: true },
        ],
      }),
    ).rejects.toThrow(/still has cards/);
    const renamed = await saveBoard(db(), board.id, {
      name: "Plan B",
      columns: [
        { id: "todo", name: "Next", done: false },
        { id: "doing", name: "Doing", done: false },
        { id: "done", name: "Done", done: true },
      ],
    });
    expect(renamed.name).toBe("Plan B");
    expect(renamed.columns[0]?.name).toBe("Next");
  });

  it("lists the boards a reader may open", async () => {
    const work = await defaultBoard(db(), ADA);
    const mine = await createBoard(db(), { name: "Mine", owner: ADA });
    const shared = await createBoard(db(), { name: "Shared", owner: ADA });
    await shareBoard(db(), shared.id, OZ, "view", ADA);
    const oz = { email: OZ, team: true, inWorkspace: true, client: null };
    expect(titles((await listBoards(db(), oz)).map((b) => ({ title: b.name })))).toEqual([
      "Work",
      "Shared",
    ]);
    const all = await listBoards(db(), oz, { everything: true });
    expect(all.map((b) => b.id)).toEqual([work.id, mine.id, shared.id]);
  });
});

describe("cards", () => {
  it("makes a card at the end of the first open column, with its first move", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "First", by: ADA });
    const b = await createTask(db(), {
      board,
      title: "Second",
      by: ADA,
      assignee: OZ,
      due: "2026-11-02",
    });
    expect(a.kind).toBe("task");
    expect(a.columnId).toBe("todo");
    expect(a.closedAt).toBeNull();
    expect(b.assignee).toBe(OZ);
    expect(b.due).toBe("2026-11-02");
    expect(titles(await listTasks(db(), { board: board.id }))).toEqual(["First", "Second"]);
    const moves = await movesOf(db(), b.id);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "create", from: null, to: "todo", by: ADA });
  });

  it("keeps labels clean, replaces them, and filters by one", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA, labels: ["Sales ", "q4"] });
    const b = await createTask(db(), { board, title: "B", by: ADA, labels: "q4; ops" });
    await createTask(db(), { board, title: "C", by: ADA });
    expect(a.labels).toEqual(["sales", "q4"]);
    expect(titles(await listTasks(db(), { label: "Q4" }))).toEqual(["A", "B"]);
    expect(titles(await listTasks(db(), { label: "ops" }))).toEqual(["B"]);
    expect(titles(await listTasks(db(), { label: "nope" }))).toEqual([]);
    const after = await setLabels(db(), a.id, ["ops", "OPS", "new one"]);
    expect(after.labels).toEqual(["ops", "new one"]);
    expect((await setLabels(db(), b.id, [])).labels).toEqual([]);
    await expect(setLabels(db(), a.id, ["x".repeat(40)])).rejects.toBeInstanceOf(TaskRefusal);
    expect((await taskById(db(), a.id))?.labels).toEqual(["ops", "new one"]);
  });

  it("keeps cards out of Notes' lists until searched for", async () => {
    const board = await defaultBoard(db(), ADA);
    await createTask(db(), { board, title: "Quarterly zebra plan", by: ADA });
    const r = { email: ADA, team: true, inWorkspace: true, client: null };
    expect(await listNotes(db(), r, { view: "all" })).toHaveLength(0);
    expect(titles(await listNotes(db(), r, { view: "all", q: "zebra" }))).toEqual([
      "Quarterly zebra plan",
    ]);
    expect(await listNotes(db(), r, { view: "all", tasks: true })).toHaveLength(1);
  });

  it("moves across columns, writes a move, and orders within one without writing", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA });
    const b = await createTask(db(), { board, title: "B", by: ADA });
    const c = await createTask(db(), { board, title: "C", by: ADA });
    // C to the top of its own column, then A to the end, then B between.
    expect((await moveTask(db(), c.id, { before: a.id, by: ADA })).moved).toBe(false);
    expect(titles(await listTasks(db(), { board: board.id }))).toEqual(["C", "A", "B"]);
    await moveTask(db(), a.id, { after: b.id, by: ADA });
    expect(titles(await listTasks(db(), { board: board.id }))).toEqual(["C", "B", "A"]);
    expect(await movesOf(db(), c.id)).toHaveLength(1);

    const doing = await moveTask(db(), b.id, { column: "Doing", by: OZ, why: "starting" });
    expect(doing.moved).toBe(true);
    expect(doing.task.columnId).toBe("doing");
    const [last, first] = await movesOf(db(), b.id);
    expect(last).toMatchObject({
      kind: "move",
      from: "todo",
      to: "doing",
      by: OZ,
      why: "starting",
    });
    expect(first?.kind).toBe("create");
    // Into a column between two cards.
    const d = await createTask(db(), { board, title: "D", by: ADA, column: "doing" });
    const e = await createTask(db(), { board, title: "E", by: ADA, column: "doing" });
    await moveTask(db(), a.id, { column: "doing", after: b.id, by: ADA });
    expect(titles(await listTasks(db(), { board: board.id, column: "doing" }))).toEqual([
      "B",
      "A",
      "D",
      "E",
    ]);
    expect([d.id, e.id]).toHaveLength(2);
  });

  it("refuses a column the board lacks", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA });
    await expect(moveTask(db(), a.id, { column: "Nowhere", by: ADA })).rejects.toThrow(TaskRefusal);
  });

  it("closes into a done column, reopens out of it, each in the history", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA });
    const closed = await closeTask(db(), a.id, { by: OZ, why: "shipped" });
    expect(closed.task.columnId).toBe("done");
    expect(closed.task.closedAt).toBeInstanceOf(Date);
    expect((await closeTask(db(), a.id, { by: OZ })).moved).toBe(false);
    const reopened = await reopenTask(db(), a.id, { by: ADA, why: "found a bug" });
    expect(reopened.task.columnId).toBe("todo");
    expect(reopened.task.closedAt).toBeNull();
    const kinds = (await movesOf(db(), a.id)).map((m) => m.kind);
    expect(kinds).toEqual(["reopen", "close", "create"]);
    // A drag into Done closes too.
    const b = await createTask(db(), { board, title: "B", by: ADA });
    expect((await moveTask(db(), b.id, { column: "done", by: ADA })).task.closedAt).not.toBeNull();
    expect((await movesOf(db(), b.id))[0]?.kind).toBe("close");
  });

  it("an agent can't close a card a person owns: it goes to Review", async () => {
    const board = await createBoard(db(), {
      name: "Ship",
      owner: ADA,
      columns: [
        { name: "To do", done: false },
        { name: "Doing", done: false },
        { name: "Review", done: false },
        { name: "Done", done: true },
      ],
    });
    const mine = await createTask(db(), { board, title: "Mine", by: ADA, assignee: ADA });
    const out = await closeTask(db(), mine.id, { by: CLAUDE, why: "done on my side" });
    expect(out.redirected?.name).toBe("Review");
    expect(out.task.columnId).toBe("review");
    expect(out.task.closedAt).toBeNull();
    // Its own card, or nobody's, it closes.
    const own = await createTask(db(), { board, title: "Own", by: CLAUDE, assignee: CLAUDE });
    expect((await closeTask(db(), own.id, { by: CLAUDE })).task.closedAt).not.toBeNull();
    const nobody = await createTask(db(), { board, title: "Nobody", by: ADA });
    expect((await closeTask(db(), nobody.id, { by: CLAUDE })).redirected).toBeNull();
    // Without a Review column, the last open one.
    const work = await defaultBoard(db(), ADA);
    const t = await createTask(db(), { board: work, title: "T", by: ADA, assignee: OZ });
    expect((await closeTask(db(), t.id, { by: CLAUDE })).task.columnId).toBe("doing");
  });

  it("assigns and writes it down; same owner writes nothing", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA });
    expect((await assignTask(db(), a.id, OZ.toUpperCase(), { by: ADA })).assignee).toBe(OZ);
    await assignTask(db(), a.id, OZ, { by: ADA });
    expect((await assignTask(db(), a.id, null, { by: ADA })).assignee).toBeNull();
    const moves = await movesOf(db(), a.id);
    expect(moves.map((m) => [m.kind, m.assignee])).toEqual([
      ["assign", null],
      ["assign", OZ],
      ["create", null],
    ]);
    await expect(assignTask(db(), a.id, "not a person", { by: ADA })).rejects.toThrow(TaskRefusal);
    expect((await setDue(db(), a.id, "2026-12-01")).due).toBe("2026-12-01");
    await expect(setDue(db(), a.id, "soon")).rejects.toThrow(TaskRefusal);
  });

  it("moves a card to another board, at the end of its first open column", async () => {
    const work = await defaultBoard(db(), ADA);
    const other = await createBoard(db(), { name: "Other", owner: ADA });
    const a = await createTask(db(), { board: work, title: "A", by: ADA, column: "doing" });
    const out = await moveToBoard(db(), a.id, other.id, { by: ADA });
    expect(out.boardId).toBe(other.id);
    expect(out.columnId).toBe("todo");
  });
});

describe("blockers", () => {
  it("blocks, unblocks, and refuses a loop or itself", async () => {
    const board = await defaultBoard(db(), ADA);
    const a = await createTask(db(), { board, title: "A", by: ADA });
    const b = await createTask(db(), { board, title: "B", by: ADA });
    const c = await createTask(db(), { board, title: "C", by: ADA });
    await blockTask(db(), b.id, a.id, ADA);
    await blockTask(db(), c.id, b.id, ADA);
    await blockTask(db(), c.id, b.id, ADA);
    expect(titles(await blockersOf(db(), c.id))).toEqual(["B"]);
    expect(titles(await blockingOf(db(), a.id))).toEqual(["B"]);
    await expect(blockTask(db(), a.id, c.id, ADA)).rejects.toThrow(/loop/);
    await expect(blockTask(db(), a.id, a.id, ADA)).rejects.toThrow(TaskRefusal);
    const rows = await listTasks(db(), { board: board.id });
    expect(rows.map((r) => [r.title, r.blocked, r.blocks])).toEqual([
      ["A", 0, 1],
      ["B", 1, 1],
      ["C", 1, 0],
    ]);
    expect(titles(await listTasks(db(), { blocked: true }))).toEqual(["B", "C"]);
    await unblockTask(db(), c.id, b.id);
    expect(titles(await blockersOf(db(), c.id))).toEqual([]);
  });

  it("ready: open, unblocked, mine or nobody's, oldest first", async () => {
    const board = await defaultBoard(db(), ADA);
    const first = await createTask(db(), { board, title: "First", by: ADA });
    const waits = await createTask(db(), { board, title: "Waits", by: ADA, blockedBy: [first.id] });
    await createTask(db(), { board, title: "Theirs", by: ADA, assignee: OZ });
    await createTask(db(), { board, title: "Mine", by: ADA, assignee: CLAUDE });
    expect(titles(await readyTasks(db(), CLAUDE))).toEqual(["First", "Mine"]);
    // Done unblocks what waited on it.
    await closeTask(db(), first.id, { by: ADA });
    expect(titles(await readyTasks(db(), CLAUDE))).toEqual(["Waits", "Mine"]);
    expect(waits.id).toBeTruthy();
  });

  it("counts what needs a person: due cards of theirs, and cards waiting on theirs", async () => {
    const board = await defaultBoard(db(), ADA);
    const mine = await createTask(db(), {
      board,
      title: "Mine",
      by: ADA,
      assignee: OZ,
      due: "2026-10-01",
    });
    await createTask(db(), { board, title: "Later", by: ADA, assignee: OZ, due: "2026-12-01" });
    await createTask(db(), { board, title: "Waits", by: ADA, blockedBy: [mine.id] });
    expect(await needsYou(db(), OZ, "2026-10-14")).toBe(2);
    expect(await needsYou(db(), ADA, "2026-10-14")).toBe(0);
  });
});

describe("access", () => {
  it("a card is open to whoever opens its board, never above edit", async () => {
    const board = await createBoard(db(), { name: "Private", owner: ADA });
    const card = await createTask(db(), { board, title: "Hidden", by: ADA });
    const oz = { email: OZ, team: true, inWorkspace: true, client: null };
    const note = (await noteById(db(), card.id)) as NonNullable<
      Awaited<ReturnType<typeof noteById>>
    >;
    expect(await roleOn(db(), note, oz)).toBeNull();
    expect(titles(await listTasks(db(), { reader: oz }))).toEqual([]);
    await shareBoard(db(), board.id, OZ, "comment", ADA);
    expect(await roleOn(db(), note, oz)).toBe("comment");
    expect(titles(await listTasks(db(), { reader: oz }))).toEqual(["Hidden"]);
    await setBoardGeneral(db(), board.id, "workspace", "edit");
    expect(await roleOn(db(), note, oz)).toBe("edit");
    // The board's owner holds the card as edit at most through the board; the card's own owner is owner.
    expect(
      await roleOn(db(), note, { email: ADA, team: true, inWorkspace: true, client: null }),
    ).toBe("owner");
  });

  it("a board shared to a client reaches its people", async () => {
    const board = await createBoard(db(), { name: "For Acme", owner: ADA });
    const card = await createTask(db(), { board, title: "Visible", by: ADA });
    const note = (await noteById(db(), card.id)) as NonNullable<
      Awaited<ReturnType<typeof noteById>>
    >;
    const owen = { email: "owen@acme.test", team: false, inWorkspace: false, client: "acme" };
    expect(await roleOn(db(), note, owen)).toBeNull();
    await shareBoard(db(), board.id, "client:acme", "edit", ADA);
    expect(await roleOn(db(), note, owen)).toBe("edit");
    expect(titles(await listTasks(db(), { reader: owen }))).toEqual(["Visible"]);
    expect(titles((await listBoards(db(), owen)).map((b) => ({ title: b.name })))).toEqual([
      "For Acme",
    ]);
  });
});
