/**
 * Boards and cards in NotesConsole (designs/2026-10-14-boards.md). Same rules as a note's
 * routes: the guard checked the app and permission, then each handler checks the role on the
 * board or the card. A client's people also reach a Wren board shared to their client (read from
 * main), as they reach a Wren note.
 */
import { WREN } from "@wren/core/access";
import { PortalRefusal, type PortalRequest } from "@wren/core/portal";
import type { Db } from "@wren/db";
import { atLeast, clientWho, effectiveRole, isShareRole, type Reader } from "./access.js";
import {
  boardById,
  boardRoleOn,
  boardSharesOf,
  createBoard,
  defaultBoard,
  isBoardId,
  listBoards,
  saveBoard,
  setBoardArchived,
  setBoardGeneral,
  shareBoard,
  TaskRefusal,
} from "./boards.js";
import { CHIPS_PER_READ } from "./chips.js";
import { linksOf, nameOf } from "./doc.js";
import { type Mentioned, proposePrompt, readProposal } from "./propose.js";
import type { Board, Note } from "./schema.js";
import { cardIdIn } from "./sheet.js";
import { isNoteId } from "./store.js";
import {
  assigneeOf,
  assignTask,
  blockersOf,
  blockingOf,
  blockTask,
  closeTask,
  columnOf,
  createTask,
  dueOf,
  labelsOf,
  listTasks,
  movesOf,
  moveTask,
  moveToBoard,
  needsYou,
  reopenTask,
  setDue,
  setLabels,
  type TaskRef,
  type TaskRow,
  taskById,
  unblockTask,
} from "./tasks.js";
import { isAgent, moveWords, type NoteJson, ownerName, type Role } from "./types.js";

type Req<T = object> = PortalRequest & T;

/** What the console hands this half: the pieces of `notesApi` it shares. */
export interface Hooks {
  main: Db;
  placeOf(req: PortalRequest): Promise<{ ws: string; db: Db; client: { id: string } | null }>;
  readerOf(req: PortalRequest, place: { ws: string; db: Db }): Promise<Reader>;
  byOf(req: PortalRequest): string;
  locate(
    req: PortalRequest,
    id: unknown,
    need: Role,
  ): Promise<{
    place: { ws: string; db: Db; client: { id: string } | null };
    reader: Reader;
    db: Db;
    note: Note;
    role: Role;
    home: string;
    as: Omit<Reader, "cap">;
  }>;
  /** The model, for Turn into cards; null where none runs. */
  write: ((prompt: string) => Promise<string>) | null;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** A store refusal as the portal's. */
async function refuse<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TaskRefusal) {
      const s = e.status;
      throw new PortalRefusal(e.message, s === 403 || s === 404 || s === 409 ? s : 400);
    }
    throw e;
  }
}

const idOrNull = (v: unknown): string | null => (isNoteId(v) ? v : null);

/** A Timeline name: the first name, "Claude" for an agent. */
const person = (who: string): string => ownerName(who, true);

/** A card as the board and the list draw it. */
export const faceOut = (t: TaskRow, home: string) => ({
  id: t.id,
  name: nameOf(t.title, t.text),
  boardId: t.boardId,
  columnId: t.columnId,
  assignee: t.assignee,
  agent: isAgent(t.assignee) || t.via === "agent",
  due: t.due,
  labels: t.labels,
  closed: t.closedAt !== null,
  blocked: t.blocked,
  blocks: t.blocks,
  comments: t.comments,
  clients: t.clients,
  updatedAt: iso(t.updatedAt) as string,
  home,
});

const boardOut = (b: Board, role: Role, home: string) => ({
  id: b.id,
  name: b.name,
  columns: b.columns,
  owner: b.owner,
  general: b.general,
  generalRole: b.generalRole,
  isDefault: b.isDefault,
  role,
  home,
});

export function boardsApi(h: Hooks) {
  const { main } = h;

  /** The board and the viewer's role on it, refused below `need`; a client's people reach Wren's from main. */
  const locateBoard = async (req: PortalRequest, rawId: unknown, need: Role) => {
    if (!isBoardId(rawId)) throw new PortalRefusal("no such board", 404);
    const place = await h.placeOf(req);
    const reader = await h.readerOf(req, place);
    let db = place.db;
    let board = await boardById(db, rawId);
    let home = place.ws;
    let as: Omit<Reader, "cap"> = reader;
    if (!board && place.ws !== WREN) {
      const b = await boardById(main, rawId);
      if (b) {
        board = b;
        db = main;
        home = WREN;
        as = { ...reader, team: false, inWorkspace: false };
      }
    }
    if (!board) throw new PortalRefusal("no such board", 404);
    const role = effectiveRole(await boardRoleOn(db, board, as), reader.cap);
    if (!role) throw new PortalRefusal("no such board", 404);
    if (!atLeast(role, need))
      throw new PortalRefusal(
        need === "owner" ? "only its owner can do that" : "you can't edit this board",
        403,
      );
    return { place, reader, db, board, role, home };
  };

  /** A card on a board of this workspace, for `need`. */
  const locateCard = async (req: PortalRequest, id: unknown, need: Role) => {
    const at = await h.locate(req, id, need);
    if (at.note.kind !== "task" || !at.note.boardId)
      throw new PortalRefusal("that isn't a card", 404);
    return at;
  };

  /** A blocker's name and place, for the card's strip. */
  const refOut = async (db: Db, r: TaskRef) => {
    const board = r.boardId ? await boardById(db, r.boardId) : null;
    return {
      id: r.id,
      name: nameOf(r.title, r.text),
      boardId: r.boardId,
      column: board?.columns.find((c) => c.id === r.columnId)?.name ?? null,
      open: r.closedAt === null,
    };
  };

  return {
    /** The boards this viewer may open; the workspace's Work board is made on first look. */
    async boards(req: PortalRequest) {
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      if (reader.cap === "edit" && reader.email) await defaultBoard(place.db, reader.email);
      const out: ReturnType<typeof boardOut>[] = [];
      for (const b of await listBoards(place.db, reader)) {
        const role = effectiveRole(await boardRoleOn(place.db, b, reader), reader.cap);
        if (role) out.push(boardOut(b, role, place.ws));
      }
      // Wren's boards shared to this client.
      if (place.ws !== WREN && !reader.team) {
        const wr = { ...reader, team: false, inWorkspace: false };
        for (const b of await listBoards(main, wr, { sharedTo: [clientWho(place.ws)] })) {
          const role = effectiveRole(await boardRoleOn(main, b, wr), reader.cap);
          if (role) out.push(boardOut(b, role, WREN));
        }
      }
      return {
        boards: out,
        me: reader.email,
        workspace: place.ws,
        canWrite: reader.cap === "edit" && !!reader.email,
      };
    },

    /** How many cards wait on this viewer: assigned to them and due, or held up by their cards. */
    async needsYou(req: PortalRequest) {
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      const n = reader.email
        ? await needsYou(place.db, reader.email, new Date().toISOString().slice(0, 10))
        : 0;
      return { n };
    },

    /** One board with its cards. */
    async board(req: Req<{ id?: unknown }>) {
      const { db, board, role, home, reader } = await locateBoard(req, req.id, "view");
      const cards = await listTasks(db, { board: board.id, limit: 1000 });
      return {
        board: boardOut(board, role, home),
        cards: cards.map((c) => faceOut(c, home)),
        me: reader.email,
        canWrite: atLeast(role, "edit") && !!reader.email,
        shares:
          role === "owner"
            ? (await boardSharesOf(db, board.id)).map((s) => ({ who: s.who, role: s.role }))
            : [],
      };
    },

    /** A new board, private to its maker. */
    async boardCreate(req: Req<{ name?: unknown; columns?: unknown }>) {
      const by = h.byOf(req);
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      const b = await refuse(() =>
        createBoard(place.db, {
          name: String(req.name ?? ""),
          owner: by,
          ...(req.columns !== undefined ? { columns: req.columns } : {}),
        }),
      );
      return boardOut(b, "owner", place.ws);
    },

    /** Its name and columns. */
    async boardSave(req: Req<{ id?: unknown; name?: unknown; columns?: unknown }>) {
      const { db, role, home } = await locateBoard(req, req.id, "edit");
      h.byOf(req);
      const b = await refuse(() =>
        saveBoard(db, String(req.id), {
          ...(req.name !== undefined ? { name: req.name } : {}),
          ...(req.columns !== undefined ? { columns: req.columns } : {}),
        }),
      );
      return boardOut(b, role, home);
    },

    /** Share a board with a person, the team, or (at Wren) a client; none takes them off. */
    async boardShare(req: Req<{ id?: unknown; who?: unknown; role?: unknown }>) {
      const { db, board } = await locateBoard(req, req.id, "owner");
      const by = h.byOf(req);
      const who = String(req.who ?? "").trim();
      if (!who || who.length > 320) throw new PortalRefusal("say who", 400);
      const role = req.role === null || req.role === undefined ? null : req.role;
      if (role !== null && !isShareRole(role)) throw new PortalRefusal("no such role", 400);
      await shareBoard(db, board.id, who, role, by);
      return { shared: role !== null };
    },

    /** Everyone in the workspace, or only those named. */
    async boardGeneral(req: Req<{ id?: unknown; general?: unknown; role?: unknown }>) {
      const { db, board } = await locateBoard(req, req.id, "owner");
      h.byOf(req);
      if (board.isDefault)
        throw new PortalRefusal("the Work board stays open to the workspace", 409);
      if (req.general !== "private" && req.general !== "workspace")
        throw new PortalRefusal("private or workspace", 400);
      if (!isShareRole(req.role)) throw new PortalRefusal("no such role", 400);
      await setBoardGeneral(db, board.id, req.general, req.role);
      return { general: req.general };
    },

    async boardArchive(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, board } = await locateBoard(req, req.id, "owner");
      h.byOf(req);
      if (board.isDefault) throw new PortalRefusal("the Work board can't be archived", 409);
      await setBoardArchived(db, board.id, req.on !== false);
      return { archived: req.on !== false };
    },

    /** A card's strip: its place, owner, due, and what it waits on and holds up. */
    async task(req: Req<{ id?: unknown }>) {
      const { db, note, role, home, reader } = await locateCard(req, req.id, "view");
      const t = (await taskById(db, note.id)) as TaskRow;
      const board = (await boardById(db, t.boardId)) as Board;
      const [by, on] = await Promise.all([blockersOf(db, t.id), blockingOf(db, t.id)]);
      const mine = reader.email
        ? await listBoards(db, reader).then((bs) => bs.map((b) => ({ id: b.id, name: b.name })))
        : [];
      return {
        ...faceOut(t, home),
        board: { id: board.id, name: board.name, columns: board.columns },
        boards: mine,
        blockedBy: await Promise.all(by.map((r) => refOut(db, r))),
        blocking: await Promise.all(on.map((r) => refOut(db, r))),
        canEdit: atLeast(role, "edit") && !!reader.email,
      };
    },

    /** A card's history, newest first, in plain words. */
    async taskMoves(req: Req<{ id?: unknown }>) {
      const { db, note } = await locateCard(req, req.id, "view");
      const board = await boardById(db, note.boardId as string);
      const name = (id: string | null) =>
        id ? (board?.columns.find((c) => c.id === id)?.name ?? id) : null;
      return {
        moves: (await movesOf(db, note.id)).map((m) => ({
          id: Number(m.id),
          kind: m.kind,
          from: name(m.from),
          to: name(m.to),
          assignee: m.assignee,
          by: m.by,
          who: person(m.by),
          why: m.why,
          at: iso(m.at) as string,
          words: moveWords({ ...m, to: name(m.to) }, person),
        })),
      };
    },

    /** A new card at the end of a column (the board's first by default). */
    async taskAdd(
      req: Req<{
        board?: unknown;
        column?: unknown;
        title?: unknown;
        assignee?: unknown;
        due?: unknown;
        labels?: unknown;
        blockedBy?: unknown;
        body?: unknown;
      }>,
    ) {
      const by = h.byOf(req);
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      let db = place.db;
      let board: Board;
      let home = place.ws;
      if (req.board) {
        const at = await locateBoard(req, req.board, "edit");
        db = at.db;
        board = at.board;
        home = at.home;
      } else board = await defaultBoard(place.db, by);
      const note = await refuse(() =>
        createTask(db, {
          board,
          title: String(req.title ?? ""),
          by,
          ...(typeof req.column === "string" && req.column ? { column: req.column } : {}),
          ...(req.assignee !== undefined ? { assignee: req.assignee as string | null } : {}),
          ...(req.due !== undefined ? { due: req.due as string | null } : {}),
          ...(req.labels !== undefined ? { labels: req.labels } : {}),
          ...(Array.isArray(req.blockedBy)
            ? { blockedBy: req.blockedBy.filter(isNoteId).slice(0, 20) }
            : {}),
          ...(req.body && typeof req.body === "object" ? { body: req.body as NoteJson } : {}),
        }),
      );
      const t = (await taskById(db, note.id)) as TaskRow;
      return faceOut(t, home);
    },

    /** Into a column, or reordered inside one. An agent can't close a person's card: it lands in Review. */
    async taskMove(
      req: Req<{
        id?: unknown;
        column?: unknown;
        before?: unknown;
        after?: unknown;
        why?: unknown;
      }>,
    ) {
      const { db, note, home } = await locateCard(req, req.id, "edit");
      const by = h.byOf(req);
      const out = await refuse(() =>
        moveTask(db, note.id, {
          column: typeof req.column === "string" && req.column ? req.column : undefined,
          before: idOrNull(req.before),
          after: idOrNull(req.after),
          by,
          why: typeof req.why === "string" ? req.why : null,
        }),
      );
      return {
        card: faceOut(out.task, home),
        moved: out.moved,
        redirected: out.redirected?.name ?? null,
      };
    },

    /** Owner, due day, labels, or board: whichever are sent. */
    async taskEdit(
      req: Req<{
        id?: unknown;
        assignee?: unknown;
        due?: unknown;
        labels?: unknown;
        board?: unknown;
        column?: unknown;
      }>,
    ) {
      const { db, note, home } = await locateCard(req, req.id, "edit");
      const by = h.byOf(req);
      await refuse(async () => {
        if (req.assignee !== undefined) await assignTask(db, note.id, req.assignee, { by });
        if (req.due !== undefined) await setDue(db, note.id, req.due);
        if (req.labels !== undefined) await setLabels(db, note.id, req.labels);
        if (req.board !== undefined) {
          if (!isBoardId(req.board)) throw new PortalRefusal("no such board", 404);
          const to = await locateBoard(req, req.board, "edit");
          if (to.db !== db) throw new PortalRefusal("a card stays in its own workspace", 400);
          await moveToBoard(db, note.id, to.board.id, {
            by,
            ...(typeof req.column === "string" && req.column ? { column: req.column } : {}),
          });
        }
      });
      return faceOut((await taskById(db, note.id)) as TaskRow, home);
    },

    /** Close a card (into the board's done column) or open it again. */
    async taskClose(req: Req<{ id?: unknown; on?: unknown; why?: unknown }>) {
      const { db, note, home } = await locateCard(req, req.id, "edit");
      const by = h.byOf(req);
      const why = typeof req.why === "string" ? req.why : null;
      const out = await refuse(() =>
        req.on === false
          ? reopenTask(db, note.id, { by, why })
          : closeTask(db, note.id, { by, why }),
      );
      return {
        card: faceOut(out.task, home),
        moved: out.moved,
        redirected: out.redirected?.name ?? null,
      };
    },

    /** This card waits on another, or stops. */
    async taskBlock(req: Req<{ id?: unknown; blockedBy?: unknown; on?: unknown }>) {
      const { db, note, home } = await locateCard(req, req.id, "edit");
      const by = h.byOf(req);
      const other = await locateCard(req, req.blockedBy, "view");
      if (other.db !== db) throw new PortalRefusal("both cards have to be in one workspace", 400);
      await refuse(() =>
        req.on === false
          ? unblockTask(db, note.id, other.note.id)
          : blockTask(db, note.id, other.note.id, by),
      );
      return faceOut((await taskById(db, note.id)) as TaskRow, home);
    },

    /**
     * Turn into cards: Claude reads the note and proposes cards, owners only from the people it
     * @-mentions. Writes nothing; the person ticks which to add (`taskFromLine`).
     */
    async cardsPropose(req: Req<{ id?: unknown }>) {
      if (!h.write) throw new PortalRefusal("Claude isn't set up here", 503);
      const { note, place } = await h.locate(req, req.id, "view");
      const reader = await h.readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (!note.text.trim()) throw new PortalRefusal("the note has no words yet", 400);
      const owners: Mentioned[] = linksOf(note.body)
        .filter((l) => l.target.startsWith("person:"))
        .map((l) => ({ id: l.target.slice("person:".length).toLowerCase(), label: l.label }));
      const raw = await h.write(
        proposePrompt({
          title: note.title,
          text: note.text,
          owners,
          today: new Date().toISOString().slice(0, 10),
        }),
      );
      const cards = readProposal(raw, { text: note.text, owners: owners.map((o) => o.id) });
      if (!cards.length) throw new PortalRefusal("Claude found no cards in this note", 422);
      return { cards };
    },

    /**
     * Cards from a note's lines (a checklist item each), or from Turn into cards' picks with an
     * owner and due: on the board named, else the workspace's Work board, each body pointing back
     * at the note. The web puts the card's link on the line.
     */
    async taskFromLine(req: Req<{ id?: unknown; lines?: unknown; board?: unknown }>) {
      const { note } = await h.locate(req, req.id, "view");
      const by = h.byOf(req);
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      const lines = (Array.isArray(req.lines) ? req.lines : [])
        .map((l) => {
          const o: Record<string, unknown> = l && typeof l === "object" ? { ...l } : { title: l };
          return {
            title: String(o.title ?? "")
              .replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?/, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300),
            assignee: typeof o.owner === "string" ? o.owner : null,
            due: typeof o.due === "string" ? o.due : null,
          };
        })
        .filter((l) => l.title)
        .slice(0, 50);
      if (!lines.length) throw new PortalRefusal("pick a line with words", 400);
      let board = await defaultBoard(place.db, by);
      if (req.board) {
        const at = await locateBoard(req, req.board, "edit");
        if (at.db !== place.db) throw new PortalRefusal("pick a board in this workspace", 400);
        board = at.board;
      }
      const label = nameOf(note.title, note.text);
      const body: NoteJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "From " },
              { type: "mention", attrs: { id: `note:${note.id}`, label } },
            ],
          },
        ],
      };
      const cards = [];
      for (const { title, assignee, due } of lines) {
        const made = await refuse(() =>
          createTask(place.db, { board, title, by, body, assignee, due }),
        );
        cards.push({
          id: made.id,
          title,
          boardId: board.id,
          column: board.columns.find((c) => c.id === made.columnId)?.name ?? made.columnId,
          columnId: made.columnId,
        });
      }
      return { cards, board: board.name };
    },

    /**
     * Where a note's cards stand now, for the "Card: <column>" chips: one read for all of them,
     * only the cards this viewer may open. A card not listed (gone, archived, not theirs) keeps the
     * words saved in the note.
     */
    async cardChips(req: Req<{ ids?: unknown }>) {
      const ids = [...new Set((Array.isArray(req.ids) ? req.ids : []).filter(isNoteId))].slice(
        0,
        CHIPS_PER_READ,
      );
      if (!ids.length) return { cards: [] };
      const place = await h.placeOf(req);
      const reader = await h.readerOf(req, place);
      const rows = await listTasks(place.db, { ids, reader, limit: ids.length });
      const columns = new Map<string, Board["columns"]>();
      for (const id of new Set(rows.map((r) => r.boardId)))
        columns.set(id, (await boardById(place.db, id))?.columns ?? []);
      return {
        cards: rows.map((r) => ({
          id: r.id,
          column: columns.get(r.boardId)?.find((c) => c.id === r.columnId)?.name ?? r.columnId,
          closed: r.closedAt !== null,
        })),
      };
    },

    /** A board's cards as rows for a sheet: the web writes the CSV. */
    async taskExport(req: Req<{ id?: unknown }>) {
      const { db, board } = await locateBoard(req, req.id, "view");
      const cards = await listTasks(db, { board: board.id, limit: 1000 });
      const title = new Map(cards.map((c) => [c.id, nameOf(c.title, c.text)]));
      const rows = [];
      for (const c of cards) {
        const waits = await blockersOf(db, c.id);
        rows.push({
          id: c.id,
          title: title.get(c.id) as string,
          column: board.columns.find((x) => x.id === c.columnId)?.name ?? c.columnId,
          owner: c.assignee ?? "",
          due: c.due ?? "",
          labels: c.labels,
          blockedBy: waits.map((w) => nameOf(w.title, w.text)),
        });
      }
      return { board: board.name, rows };
    },

    /**
     * Rows of a sheet as cards on a board. A row whose link names a card of this board updates
     * that card (column, owner, due); any other row with a title makes one. "Blocked by" names a
     * card by title or link. What can't be used is said, row by row; the rest still goes in.
     */
    async taskImport(
      req: Req<{
        id?: unknown;
        rows?: unknown;
      }>,
    ) {
      const { db, board } = await locateBoard(req, req.id, "edit");
      const by = h.byOf(req);
      const rows = (Array.isArray(req.rows) ? req.rows : []).slice(0, 200) as Record<
        string,
        unknown
      >[];
      if (!rows.length) throw new PortalRefusal("no rows to import", 400);
      const text = (r: Record<string, unknown>, k: string) =>
        typeof r[k] === "string" ? (r[k] as string).trim() : "";
      const have = new Map(
        (await listTasks(db, { board: board.id, limit: 1000 })).map((c) => [c.id, c]),
      );
      const byTitle = new Map<string, string>();
      for (const c of have.values()) byTitle.set(nameOf(c.title, c.text).toLowerCase(), c.id);
      const warnings: { row: number; why: string }[] = [];
      const warn = (row: number, why: string) => warnings.push({ row, why });
      let made = 0;
      let updated = 0;
      const rowCard: (string | null)[] = [];
      for (const [i, r] of rows.entries()) {
        const n = i + 1;
        const title = text(r, "title").slice(0, 300);
        const link = cardIdIn(text(r, "link"));
        const column = text(r, "column");
        const col = column ? columnOf(board, column) : null;
        if (column && !col) warn(n, `no column "${column}"; used the first`);
        let owner: string | null | undefined;
        if (text(r, "owner")) {
          try {
            owner = assigneeOf(text(r, "owner"));
          } catch {
            warn(n, `"${text(r, "owner")}" isn't an email or agent:name; left without an owner`);
          }
        }
        let due: string | null | undefined;
        if (text(r, "due")) {
          try {
            due = dueOf(text(r, "due"));
          } catch {
            warn(n, `"${text(r, "due")}" isn't YYYY-MM-DD; left without a due day`);
          }
        }
        let labels: string[] | undefined;
        if (text(r, "labels")) {
          try {
            labels = labelsOf(text(r, "labels"));
          } catch (e) {
            if (!(e instanceof TaskRefusal)) throw e;
            warn(n, `${e.message}; left without labels`);
          }
        }
        try {
          if (link && have.has(link)) {
            if (col) await moveTask(db, link, { column: col.id, by, why: "From a sheet" });
            if (owner !== undefined) await assignTask(db, link, owner, { by });
            if (due !== undefined) await setDue(db, link, due);
            if (labels !== undefined) await setLabels(db, link, labels);
            updated++;
            rowCard.push(link);
          } else if (title) {
            const note = await createTask(db, {
              board,
              title,
              by,
              ...(col ? { column: col.id } : {}),
              ...(owner !== undefined ? { assignee: owner } : {}),
              ...(due !== undefined ? { due } : {}),
              ...(labels !== undefined ? { labels } : {}),
            });
            byTitle.set(title.toLowerCase(), note.id);
            made++;
            rowCard.push(note.id);
          } else {
            warn(n, link ? "that link isn't a card on this board" : "no title");
            rowCard.push(null);
          }
        } catch (e) {
          if (!(e instanceof TaskRefusal)) throw e;
          warn(n, e.message);
          rowCard.push(null);
        }
      }
      // After every row is in, so a row can wait on one further down.
      for (const [i, r] of rows.entries()) {
        const id = rowCard[i];
        if (!id) continue;
        for (const ref of text(r, "blocked by").split(/[;\n]/)) {
          const name = ref.trim();
          if (!name) continue;
          const other = cardIdIn(name) ?? byTitle.get(name.toLowerCase());
          if (!other || other === id) {
            warn(i + 1, `no card "${name}" to wait on`);
            continue;
          }
          try {
            await blockTask(db, id, other, by);
          } catch (e) {
            if (!(e instanceof TaskRefusal)) throw e;
            warn(i + 1, e.message);
          }
        }
      }
      return { made, updated, warnings: warnings.slice(0, 50), board: board.name };
    },
  };
}
