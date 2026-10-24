/**
 * NotesConsole: Notes in the portal (designs/2026-10-07-notes.md). The workspace is Wren's for a
 * team login naming no client, else the named client's (its own database). Every route checks
 * the note's own role on top of the guard's app check: owner, a share, or the workspace's access,
 * held to what the login may do in Notes there.
 */
import type * as restate from "@restatedev/restate-sdk";
import { answer, PortalRefusal, type PortalRequest, portalService } from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { commentsHandlers } from "./console-comments.js";
import { type NotesDeps, notesApiContext } from "./console-context.js";
import { pagesHandlers } from "./console-pages.js";
import { recordsHandlers } from "./console-records.js";
import { NOTES_CONSOLE_APPS, NOTES_CONSOLE_ROUTES } from "./console-routes.js";
import { sharingHandlers } from "./console-sharing.js";
import { trainingHandlers } from "./console-training.js";
import { writesHandlers } from "./console-writes.js";

export type { NoteFiles, NotesDeps, NoteTurns } from "./console-context.js";
export { noteOut } from "./console-pages.js";
export { FILE_SRC, IMAGE_MAX, IMAGE_TYPES } from "./console-writes.js";

export function notesApi(deps: NotesDeps) {
  const notes = notesApiContext(deps);
  return {
    ...recordsHandlers(notes),
    ...pagesHandlers(notes),
    ...commentsHandlers(notes),
    ...writesHandlers(notes),
    ...sharingHandlers(notes),
    ...trainingHandlers(notes),
  };
}

export type NotesApi = ReturnType<typeof notesApi>;

/**
 * Up to `limit` notes this viewer may open that match `q`, as context for Ask Claude: title,
 * link and excerpt each. Empty when nothing matches.
 */
export async function notesContext(deps: NotesDeps, req: PortalRequest, q: string, limit = 5) {
  const api = notesApi(deps);
  const words = q
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 12)
    .join(" or ");
  if (!words) return "";
  const { notes: rows } = await api.home({ ...req, view: "all", q: words, limit });
  if (!rows.length) return "";
  return rows
    .slice(0, limit)
    .map(
      (r) =>
        `- ${r.name} (/notes/doc/${r.id}): ${r.excerpt.replaceAll("«", "").replaceAll("»", "")}`,
    )
    .join("\n");
}

const ID = z.string().max(64).describe("The note's id");

const ON = z.boolean().describe("On or off");

const LABELS = z
  .array(z.string().max(60))
  .max(20)
  .describe("Free-text labels, lowercase; they replace the card's own. An empty list clears them");

const NUM = z.number().int().positive();

const ROLE = z.enum(["view", "comment", "edit"]);

/** Each handler's input: the portal's own fields and the route's. The handlers check them again. */
const INPUTS = {
  home: {
    view: z.enum(["recent", "mine", "shared", "starred", "archived", "all"]).optional(),
    q: z.string().max(500).optional().describe("Words to search for"),
    limit: z.number().int().optional(),
    parentId: ID.nullable().optional(),
  },
  open: { id: ID },
  sync: {
    id: ID,
    update: z.string().optional().describe("A Yjs update, base64"),
    sv: z.string().optional().describe("The browser's state vector, base64"),
  },
  versions: { id: ID },
  version: { id: ID, number: NUM },
  compare: { id: ID, from: NUM, to: NUM },
  backlinks: { target: z.string().max(300).describe("A record, `<type>:<id>`") },
  people: { id: ID.optional().describe("A note: whether each person can open it") },
  file: { id: ID, key: z.string().max(400) },
  settings: {},
  comments: { id: ID },
  mentions: { limit: z.number().int().optional() },
  mentionsRead: { ids: z.array(z.string().max(64)).max(200).describe("Mention ids") },
  mentionsUnread: { ids: z.array(z.string().max(64)).max(200).describe("Mention ids") },
  star: { id: ID, on: ON },
  comment: {
    id: ID,
    body: z.string().max(10_000).describe("The words; `@email` tells that person"),
    parentId: z.string().max(64).nullable().optional().describe("A reply: the thread's id"),
    anchor: z
      .object({ from: z.unknown(), to: z.unknown() })
      .nullable()
      .optional()
      .describe("A new thread's range: Yjs relative positions"),
    quote: z.string().max(5000).optional().describe("The words it's on"),
  },
  commentEdit: { id: ID, commentId: z.string().max(64), body: z.string().max(10_000) },
  commentDelete: { id: ID, commentId: z.string().max(64) },
  resolve: { id: ID, commentId: z.string().max(64), on: ON },
  append: {
    id: ID,
    body: z.unknown().describe("Editor JSON: a doc"),
    from: z.string().max(200).optional().describe("The file it came from: an import version"),
  },
  drive: { link: z.string().max(2000).describe("A Google Docs or Drive link") },
  driveTitle: { link: z.string().max(2000).describe("A Google Docs, Sheets or Drive link") },
  create: {
    title: z.string().max(3000).optional(),
    markdown: z.string().optional().describe("The body, as Markdown"),
    parentId: ID.optional(),
  },
  capture: {
    words: z.string().max(20_000),
    open: z.boolean().optional().describe("As a note of its own"),
  },
  rename: { id: ID, title: z.string().max(3000) },
  restore: { id: ID, number: NUM },
  nameVersion: { id: ID, number: NUM, name: z.string().max(2000).nullable() },
  share: { id: ID, who: z.string().max(320), role: ROLE.nullable().describe("None removes them") },
  general: { id: ID, general: z.enum(["private", "workspace"]), role: ROLE },
  transfer: { id: ID, to: z.string().max(320) },
  archive: { id: ID, on: ON },
  move: { id: ID, parentId: ID.nullable() },
  train: { id: ID, on: ON },
  upload: { id: ID, name: z.string().max(200), type: z.string().max(100), size: z.number().int() },
  workspaceTrain: { on: ON },
  toDraft: {
    id: ID,
    text: z.string().max(20_000).optional().describe("The selection; none is the note"),
  },
  toSop: {
    id: ID,
    text: z.string().max(200_000).optional().describe("The selection; none is the note"),
    sop: z.string().max(64).describe("The SOP's name: lowercase letters, digits and dashes"),
  },
  boards: {},
  needsYou: {},
  board: {
    id: ID.describe("The board's id"),
    known: z
      .array(z.string().max(32))
      .max(500)
      .optional()
      .describe("The marks of the cards held (`hashes`): those come back as stubs"),
  },
  task: { id: ID.describe("The card's id") },
  taskMoves: { id: ID.describe("The card's id") },
  taskExport: { id: ID.describe("The board's id") },
  recordsTypes: {},
  recordsList: {},
  recordsGet: {},
  recordsExport: {},
  recordsStats: {},
  boardCreate: {
    name: z.string().max(1200),
    columns: z
      .array(
        z.object({
          id: z.string().max(40).optional(),
          name: z.string().max(60),
          done: z.boolean(),
        }),
      )
      .max(12)
      .optional()
      .describe("Ordered; at least one done and one open. Left out: To do, Doing, Done"),
  },
  boardSave: {
    id: ID.describe("The board's id"),
    expect: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The board's version the change started from; refused if it moved"),
    name: z.string().max(1200).optional(),
    columns: z
      .array(
        z.object({
          id: z.string().max(40).optional(),
          name: z.string().max(60),
          done: z.boolean(),
        }),
      )
      .max(12)
      .optional(),
  },
  boardShare: {
    id: ID.describe("The board's id"),
    who: z.string().max(320).describe("An email, `team` or `client:<id>`"),
    role: ROLE.nullable().describe("None removes them"),
  },
  boardGeneral: {
    id: ID.describe("The board's id"),
    general: z.enum(["private", "workspace"]),
    role: ROLE,
  },
  boardArchive: { id: ID.describe("The board's id"), on: ON },
  taskAdd: {
    title: z.string().max(3000),
    board: ID.optional().describe("A board id; the Work board when left out"),
    column: z
      .string()
      .max(60)
      .optional()
      .describe("A column's id or name; the first open one when left out"),
    assignee: z.string().max(200).nullable().optional().describe("An email or `agent:<name>`"),
    due: z.string().max(10).nullable().optional().describe("YYYY-MM-DD"),
    labels: LABELS.optional(),
    blockedBy: z.array(ID).max(20).optional().describe("Cards it waits on"),
    body: z.unknown().optional().describe("Editor JSON: the card's details"),
  },
  taskMove: {
    id: ID.describe("The card's id"),
    column: z
      .string()
      .max(60)
      .optional()
      .describe("A column's id or name; the card's own to reorder"),
    before: ID.nullable().optional().describe("Just above this card"),
    after: ID.nullable().optional().describe("Just below this card"),
    why: z.string().max(3000).optional(),
  },
  taskEdit: {
    id: ID.describe("The card's id"),
    assignee: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("An email or `agent:<name>`; null takes the owner off"),
    due: z.string().max(10).nullable().optional().describe("YYYY-MM-DD; null clears it"),
    labels: LABELS.optional(),
    board: ID.optional().describe("Move it to this board"),
    column: z.string().max(60).optional().describe("With board: the column there"),
  },
  taskClose: {
    id: ID.describe("The card's id"),
    on: z.boolean().optional().describe("False reopens it"),
    why: z.string().max(3000).optional(),
  },
  taskBlock: {
    id: ID.describe("The card's id"),
    blockedBy: ID.describe("The card it waits on"),
    on: z.boolean().optional().describe("False stops waiting"),
  },
  cardChips: {
    ids: z
      .array(ID)
      .min(1)
      .max(100)
      .describe("A note's cards: where each stands now, for the chips on its lines"),
  },
  taskFromLine: {
    id: ID.describe("The note the lines are in"),
    lines: z
      .array(
        z.union([
          z.string().max(3000),
          z.object({
            title: z.string().max(3000),
            owner: z.string().max(320).nullable().optional(),
            due: z.string().max(10).nullable().optional(),
          }),
        ]),
      )
      .min(1)
      .max(50)
      .describe("One card each: a line, or a Turn into cards pick with its owner and due"),
    board: ID.optional().describe("The board; the Work board when left out"),
  },
  cardsPropose: { id: ID.describe("The note Claude reads") },
  taskImport: {
    id: ID.describe("The board's id"),
    rows: z
      .array(z.record(z.string(), z.string().max(2000)))
      .min(1)
      .max(200)
      .describe("Rows by field: title, column, owner, due, labels, blocked by, link"),
  },
} as const satisfies Record<keyof typeof NOTES_CONSOLE_ROUTES, z.ZodRawShape>;

const input = (route: keyof typeof INPUTS) => ({
  input: z.looseObject({ ...PORTAL_FIELDS, ...INPUTS[route] }),
});

/** The Restate service. A write is journaled once, so a retry never writes twice. */
export function makeNotesConsole(deps: NotesDeps) {
  const api = notesApi(deps);
  const read = <K extends keyof typeof INPUTS & keyof NotesApi>(route: K) =>
    serviceHandler(input(route), (_: restate.Context, req: Parameters<NotesApi[K]>[0]) =>
      answer(() => (api[route] as (r: typeof req) => Promise<unknown>)(req)),
    );
  const write = <K extends keyof typeof INPUTS & keyof NotesApi>(route: K, name: string) =>
    serviceHandler(input(route), (ctx: restate.Context, req: Parameters<NotesApi[K]>[0]) =>
      answer(() =>
        ctx.run(name, () => answer(() => (api[route] as (r: typeof req) => Promise<unknown>)(req))),
      ),
    );
  return portalService({
    name: "NotesConsole",
    main: deps.main,
    routes: NOTES_CONSOLE_ROUTES,
    apps: NOTES_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      home: read("home"),
      open: read("open"),
      // Yjs merges an update it has once: a retry changes nothing, so no journal (the answer can be big).
      sync: read("sync"),
      versions: read("versions"),
      version: read("version"),
      compare: read("compare"),
      backlinks: read("backlinks"),
      people: read("people"),
      file: read("file"),
      settings: read("settings"),
      comments: read("comments"),
      mentions: read("mentions"),
      mentionsRead: write("mentionsRead", "read mentions"),
      mentionsUnread: write("mentionsUnread", "unread mentions"),
      star: write("star", "star"),
      comment: write("comment", "comment"),
      commentEdit: write("commentEdit", "edit comment"),
      commentDelete: write("commentDelete", "delete comment"),
      resolve: write("resolve", "resolve"),
      // A Drive read: big bytes and no write, so no journal.
      drive: read("drive"),
      driveTitle: read("driveTitle"),
      append: write("append", "append"),
      create: write("create", "create"),
      capture: write("capture", "capture"),
      rename: write("rename", "rename"),
      restore: write("restore", "restore"),
      nameVersion: write("nameVersion", "name version"),
      share: write("share", "share"),
      general: write("general", "general"),
      transfer: write("transfer", "transfer"),
      archive: write("archive", "archive"),
      move: write("move", "move"),
      train: write("train", "train"),
      upload: write("upload", "upload"),
      workspaceTrain: write("workspaceTrain", "workspace train"),
      toDraft: serviceHandler(
        input("toDraft"),
        (ctx: restate.Context, req: Parameters<NotesApi["drafting"]>[0]) =>
          answer(async () => {
            const turns = deps.turns;
            if (!turns) throw new PortalRefusal("drafting isn't set up here", 503);
            const go = await ctx.run("check", () => answer(() => api.drafting(req)));
            await turns.draft(ctx, go);
            return { started: true };
          }),
      ),
      toSop: write("toSop", "to sop"),
      boards: read("boards"),
      needsYou: read("needsYou"),
      board: read("board"),
      task: read("task"),
      taskMoves: read("taskMoves"),
      taskExport: read("taskExport"),
      cardChips: read("cardChips"),
      recordsTypes: read("recordsTypes"),
      recordsList: read("recordsList"),
      recordsGet: read("recordsGet"),
      recordsExport: read("recordsExport"),
      recordsStats: read("recordsStats"),
      boardCreate: write("boardCreate", "board create"),
      boardSave: write("boardSave", "board save"),
      boardShare: write("boardShare", "board share"),
      boardGeneral: write("boardGeneral", "board general"),
      boardArchive: write("boardArchive", "board archive"),
      taskAdd: write("taskAdd", "task add"),
      taskMove: write("taskMove", "task move"),
      taskEdit: write("taskEdit", "task edit"),
      taskClose: write("taskClose", "task close"),
      taskBlock: write("taskBlock", "task block"),
      taskFromLine: write("taskFromLine", "task from line"),
      // Journaled, so a retry never asks the model twice.
      cardsPropose: write("cardsPropose", "propose cards"),
      taskImport: write("taskImport", "task import"),
    },
  });
}
