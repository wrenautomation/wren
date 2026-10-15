/**
 * Boards through NotesConsole (designs/2026-10-14-boards.md): the board and its cards, moving
 * and ordering, the Timeline, a card's talk, blockers, cards made from a note's lines, the cards
 * as records, and a Wren board shared to a client. Synthetic logins and words throughout.
 */
import { addMember, addOperator, clients } from "@wren/core/clients";
import type { PortalRefusal } from "@wren/core/portal";
import { createDb, type DbHandle, migrate } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notesApi } from "../../src/console.js";

let pg: TestPostgres;
let acme: DbHandle;
const TABLES = [
  "task_moves",
  "task_blocks",
  "board_shares",
  "boards",
  "note_mentions",
  "note_comments",
  "note_updates",
  "note_versions",
  "note_links",
  "note_shares",
  "notes",
];

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute("create database client_acme");
  acme = createDb(pg.url.replace(/\/[^/?]+(\?|$)/, "/client_acme$1"), { max: 2 });
  await migrate(acme.db);
});
afterAll(async () => {
  await acme.close();
  await pg.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "client_members", "operators", "clients"]);
  await truncate(acme.db, TABLES);
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "client_acme" });
  await addOperator(pg.db, "ada@example.test");
  await addOperator(pg.db, "oz@example.test");
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
});

const api = () => notesApi({ main: pg.db, open: () => acme.db, zone: "UTC" });
const ADA = { email: "ada@example.test", operator: true } as never;
const OZ = { email: "oz@example.test", operator: true } as never;
const OWEN = { email: "owen@acme.test" } as never;
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err?.status).toBe(status);
};

describe("board and cards", () => {
  it("opens on a Work board and adds, moves and orders cards", async () => {
    const { boards } = await api().boards({ viewer: ADA });
    expect(boards.map((b) => b.name)).toEqual(["Work"]);
    const board = boards[0]?.id as string;
    const a = await api().taskAdd({ viewer: ADA, title: "Write the plan" });
    const b = await api().taskAdd({ viewer: ADA, title: "Send it", column: "Doing" });
    const c = await api().taskAdd({
      viewer: ADA,
      title: "Third",
      board,
      assignee: "oz@example.test",
    });
    expect([a.columnId, b.columnId, c.assignee]).toEqual(["todo", "doing", "oz@example.test"]);

    const moved = await api().taskMove({ viewer: OZ, id: a.id, column: "Doing", after: b.id });
    expect(moved.moved).toBe(true);
    const full = await api().board({ viewer: ADA, id: board });
    expect(full.cards.filter((x) => x.columnId === "doing").map((x) => x.name)).toEqual([
      "Send it",
      "Write the plan",
    ]);
    expect(full.canWrite).toBe(true);

    const timeline = await api().taskMoves({ viewer: ADA, id: a.id });
    expect(timeline.moves.map((m) => m.words)).toEqual(["moved it to Doing", "made it in To do"]);
    expect(timeline.moves[0]?.who).toBe("Oz");

    const closed = await api().taskClose({ viewer: OZ, id: a.id, why: "shipped" });
    expect(closed.card.closed).toBe(true);
    const reopened = await api().taskClose({ viewer: OZ, id: a.id, on: false });
    expect(reopened.card.closed).toBe(false);
    expect((await api().taskMoves({ viewer: ADA, id: a.id })).moves.map((m) => m.kind)).toEqual([
      "reopen",
      "close",
      "move",
      "create",
    ]);
  });

  it("assigns, dates, and moves a card to another board", async () => {
    const a = await api().taskAdd({ viewer: ADA, title: "Card" });
    const other = await api().boardCreate({ viewer: ADA, name: "Launch" });
    const e = await api().taskEdit({
      viewer: ADA,
      id: a.id,
      assignee: "agent:claude",
      due: "2026-11-01",
      board: other.id,
    });
    expect(e).toMatchObject({
      assignee: "agent:claude",
      agent: true,
      due: "2026-11-01",
      boardId: other.id,
    });
    await refused(api().taskEdit({ viewer: ADA, id: a.id, due: "soon" }), 400);
    const strip = await api().task({ viewer: ADA, id: a.id });
    expect(strip.board.name).toBe("Launch");
    expect(strip.boards.map((x) => x.name).sort()).toEqual(["Launch", "Work"]);
  });

  it("blocks one card on another, and refuses a loop", async () => {
    const a = await api().taskAdd({ viewer: ADA, title: "First" });
    const b = await api().taskAdd({ viewer: ADA, title: "Second" });
    const blocked = await api().taskBlock({ viewer: ADA, id: b.id, blockedBy: a.id });
    expect(blocked.blocked).toBe(1);
    const strip = await api().task({ viewer: ADA, id: b.id });
    expect(strip.blockedBy.map((x) => [x.name, x.column, x.open])).toEqual([
      ["First", "To do", true],
    ]);
    expect((await api().task({ viewer: ADA, id: a.id })).blocking.map((x) => x.name)).toEqual([
      "Second",
    ]);
    await refused(api().taskBlock({ viewer: ADA, id: a.id, blockedBy: b.id }), 400);
    await api().taskClose({ viewer: ADA, id: a.id });
    expect((await api().task({ viewer: ADA, id: b.id })).blocked).toBe(0);
    await api().taskBlock({ viewer: ADA, id: b.id, blockedBy: a.id, on: false });
    expect((await api().task({ viewer: ADA, id: b.id })).blockedBy).toEqual([]);
  });

  it("takes a comment on a card with no range", async () => {
    const a = await api().taskAdd({ viewer: ADA, title: "Talk" });
    const c = await api().comment({ viewer: OZ, id: a.id, body: "Looks right" });
    expect(c.body).toBe("Looks right");
    expect((await api().comments({ viewer: ADA, id: a.id })).threads).toHaveLength(1);
    expect((await api().board({ viewer: ADA, id: a.boardId })).cards[0]?.comments).toBe(1);
    // A note still needs its words picked.
    const n = await api().create({ viewer: ADA, title: "Plain" });
    await refused(api().comment({ viewer: ADA, id: n.id, body: "x" }), 400);
  });

  it("makes cards from a note's lines, linked back, shown by column in its backlinks", async () => {
    const n = await api().create({ viewer: ADA, title: "Launch plan" });
    const out = await api().taskFromLine({
      viewer: ADA,
      id: n.id,
      lines: ["[ ] Book the venue", "- [x] Order shirts", "   "],
    });
    expect(out.cards.map((c) => [c.title, c.column])).toEqual([
      ["Book the venue", "To do"],
      ["Order shirts", "To do"],
    ]);
    const back = await api().backlinks({ viewer: ADA, target: `note:${n.id}` });
    expect(back.notes.map((x) => [x.name, x.card])).toEqual(
      expect.arrayContaining([["Book the venue", { column: "To do", closed: false }]]),
    );
    await api().taskMove({ viewer: ADA, id: out.cards[0]?.id, column: "done" });
    const again = await api().backlinks({ viewer: ADA, target: `note:${n.id}` });
    expect(again.notes.find((x) => x.name === "Book the venue")?.card).toEqual({
      column: "Done",
      closed: true,
    });
    // Cards stay out of the notes list.
    expect((await api().home({ viewer: ADA, view: "all" })).notes.map((x) => x.name)).toEqual([
      "Launch plan",
    ]);
  });

  it("serves the cards as records", async () => {
    const a = await api().taskAdd({ viewer: ADA, title: "One", assignee: "ada@example.test" });
    await api().taskAdd({ viewer: ADA, title: "Two" });
    await api().taskBlock({
      viewer: ADA,
      id: a.id,
      blockedBy: (await api().taskAdd({ viewer: ADA, title: "Gate" })).id,
    });
    const types = await api().recordsTypes({ viewer: ADA });
    expect(types.map((t) => t.id)).toEqual(["notes.task"]);
    const all = await api().recordsList({ viewer: ADA, record: "notes.task", view: "all" });
    expect(all.rows).toHaveLength(3);
    const ready = await api().recordsList({ viewer: ADA, record: "notes.task", view: "ready" });
    expect(ready.rows.map((r) => r.title).sort()).toEqual(["Gate", "Two"]);
    const mine = await api().recordsList({ viewer: ADA, record: "notes.task", view: "mine" });
    expect(mine.rows.map((r) => r.title)).toEqual(["One"]);
    const agent = await api().taskAdd({
      viewer: ADA,
      title: "Agent's",
      assignee: "agent:claude",
      labels: ["Sales", "q4"],
    });
    const listed = await api().recordsList({ viewer: ADA, record: "notes.task", view: "all" });
    expect(listed.rows.find((r) => r.id === agent.id)).toMatchObject({
      owner: "Claude",
      assignee: "agent:claude",
      labels: "sales; q4",
    });
    const csv = await api().recordsExport({ viewer: ADA, record: "notes.task", view: "all" });
    expect(csv.body).toContain("Gate");
  });
});

describe("sharing", () => {
  it("exports a board as rows and imports them back: new cards, link updates, waits", async () => {
    const board = (await api().boards({ viewer: ADA })).boards[0]?.id as string;
    const a = await api().taskAdd({ viewer: ADA, title: "Order the sign" });
    const b = await api().taskAdd({ viewer: ADA, title: "Hang the sign" });
    await api().taskBlock({ viewer: ADA, id: b.id, blockedBy: a.id });
    const out = await api().taskExport({ viewer: ADA, id: board });
    expect(out.rows.find((r) => r.id === b.id)).toMatchObject({
      title: "Hang the sign",
      column: "To do",
      blockedBy: ["Order the sign"],
    });

    const res = await api().taskImport({
      viewer: ADA,
      id: board,
      rows: [
        // Updates the card its link names.
        {
          title: "ignored",
          link: `https://app.example.test/notes/doc/${a.id}`,
          column: "Doing",
          owner: "oz@example.test",
          due: "2031-01-02",
          labels: "Sales; Q4",
        },
        {
          title: "Paint the sign",
          column: "Nowhere",
          owner: "Sam",
          blocked: "x",
          labels: `fine; ${"x".repeat(40)}`,
          "blocked by": "Hang the sign; Missing card",
        },
        { column: "Doing" },
      ],
    });
    expect([res.made, res.updated]).toEqual([1, 1]);
    expect(res.warnings.map((w) => w.row).sort()).toEqual([2, 2, 2, 2, 3]);
    const back = await api().taskExport({ viewer: ADA, id: board });
    expect(back.rows.find((r) => r.id === a.id)?.labels).toEqual(["sales", "q4"]);
    expect(back.rows.find((r) => r.title === "Paint the sign")?.labels).toEqual([]);
    const full = await api().board({ viewer: ADA, id: board });
    const named = (n: string) => full.cards.find((c) => c.name === n);
    expect(named("Order the sign")).toMatchObject({
      columnId: "doing",
      assignee: "oz@example.test",
      due: "2031-01-02",
    });
    expect(named("Paint the sign")).toMatchObject({ columnId: "todo", assignee: null, blocked: 1 });
    const edit = await api()
      .taskImport({ viewer: OWEN, client: "acme", id: board, rows: [{ title: "x" }] })
      .catch((e: unknown) => e);
    expect((edit as PortalRefusal).status).toBe(404);
  });

  it("a private board stays private until shared; columns are guarded", async () => {
    const b = await api().boardCreate({ viewer: ADA, name: "Private" });
    expect((await api().boards({ viewer: OZ })).boards.map((x) => x.name)).toEqual(["Work"]);
    await refused(api().board({ viewer: OZ, id: b.id }), 404);
    await api().boardShare({ viewer: ADA, id: b.id, who: "oz@example.test", role: "view" });
    expect((await api().board({ viewer: OZ, id: b.id })).canWrite).toBe(false);
    await refused(api().taskAdd({ viewer: OZ, title: "No", board: b.id }), 403);
    await api().boardShare({ viewer: ADA, id: b.id, who: "oz@example.test", role: "edit" });
    await api().taskAdd({ viewer: OZ, title: "Yes", board: b.id });
    await refused(
      api().boardSave({
        viewer: ADA,
        id: b.id,
        columns: [
          { id: "doing", name: "Doing", done: false },
          { id: "done", name: "Done", done: true },
        ],
      }),
      409,
    );
    await refused(api().boardArchive({ viewer: OZ, id: b.id }), 403);
  });

  it("a Wren board shared to a client reaches its people, and their edits land in Wren's database", async () => {
    const b = await api().boardCreate({ viewer: ADA, name: "For Acme" });
    const card = await api().taskAdd({ viewer: ADA, title: "Needs Acme", board: b.id });
    expect(
      (await api().boards({ viewer: OWEN, client: "acme" })).boards.map((x) => x.name),
    ).toEqual(["Work"]);
    await api().boardShare({ viewer: ADA, id: b.id, who: "client:acme", role: "edit" });
    const seen = await api().boards({ viewer: OWEN, client: "acme" });
    expect(seen.boards.map((x) => [x.name, x.home])).toEqual([
      ["Work", "acme"],
      ["For Acme", "wren"],
    ]);
    const full = await api().board({ viewer: OWEN, client: "acme", id: b.id });
    expect(full.cards.map((c) => c.name)).toEqual(["Needs Acme"]);
    await api().taskMove({ viewer: OWEN, client: "acme", id: card.id, column: "doing" });
    expect((await api().board({ viewer: ADA, id: b.id })).cards[0]?.columnId).toBe("doing");
    // Their own board stays theirs.
    const mine = await api().boardCreate({ viewer: OWEN, client: "acme", name: "Ours" });
    await refused(api().board({ viewer: ADA, id: mine.id }), 404);
  });
});
