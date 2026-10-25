/**
 * Cards as records (designs/2026-10-14-boards.md): `notes.task`, so the Board's List toggle, saved
 * views, CSV export and the agent API read them like any record. A reader sees the cards they may
 * open; with nobody signed in there are none.
 */
import {
  date,
  defineRecord,
  type Me,
  number,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { inArray } from "drizzle-orm";
import type { Reader } from "./access.js";
import { nameOf } from "./doc.js";
import { boards } from "./schema.js";
import { listTasks } from "./tasks.js";
import { ownerName } from "./types.js";

const TASK = "notes.task";

/** The newest cards one read carries. */
const TASK_ROWS = 2000;

const day = (d: string | null) => (d ? `${d}T00:00:00.000Z` : null);

/** The cards `reader` may open, as record rows. */
async function taskRows(db: Queryable, reader: Omit<Reader, "cap">) {
  if (!reader.email) return [];
  const cards = await listTasks(db, { reader, limit: TASK_ROWS });
  const ids = [...new Set(cards.map((c) => c.boardId))];
  const found = ids.length ? await db.select().from(boards).where(inArray(boards.id, ids)) : [];
  const byId = new Map(found.map((b) => [b.id, b]));
  return cards.map((c) => {
    const board = byId.get(c.boardId);
    const open = c.closedAt === null;
    return {
      id: c.id,
      title: nameOf(c.title, c.text),
      board: board?.name ?? "",
      column: board?.columns.find((x) => x.id === c.columnId)?.name ?? c.columnId,
      state: open ? "open" : "closed",
      owner: ownerName(c.assignee) || null,
      assignee: c.assignee,
      due: day(c.due),
      labels: c.labels.join("; "),
      blocked: c.blocked > 0 ? "blocked" : "clear",
      ready: open && c.blocked === 0 ? "ready" : "no",
      comments: c.comments,
      clients: c.clients.map((x) => x.name).join(", "),
      created: c.createdAt.toISOString(),
      updated: c.updatedAt.toISOString(),
    };
  });
}

/** The record over one workspace: Wren's, or the named client's. */
export function taskRecordFor(client: string | null): RecordType {
  return defineRecord({
    id: TASK,
    app: "notes",
    channel: null,
    name: { one: "card", many: "cards" },
    rows: (db: Queryable, me?: Me | null) =>
      me?.email
        ? taskRows(db, {
            email: me.email,
            team: me.team,
            inWorkspace: client === null ? me.team : true,
            client,
          })
        : Promise.resolve([]),
    key: "id",
    title: "title",
    subtitle: "board",
    fields: {
      title: text("Card"),
      board: text("Board"),
      column: text("Column"),
      state: status(
        { open: { label: "Open", tone: "neutral" }, closed: { label: "Closed", tone: "good" } },
        "State",
      ),
      // As people say it ("Claude"); `assignee` is the address `Mine` reads.
      owner: text("Owner"),
      assignee: text("Owner address", { listed: false }),
      due: date("Due"),
      // `a; b`, so the List's own filter finds a label as text.
      labels: text("Labels"),
      blocked: status(
        { blocked: { label: "Blocked", tone: "warn" }, clear: { label: "Clear", tone: "neutral" } },
        "Blocked",
      ),
      ready: status(
        { ready: { label: "Ready", tone: "good" }, no: { label: "Not ready", tone: "neutral" } },
        "Ready",
      ),
      comments: number("Comments"),
      clients: text("Clients"),
      created: date("Made", { listed: false }),
      updated: date("Updated"),
    },
    views: [
      { id: "open", label: "Open", where: { state: "open" }, sort: "-updated", at: "updated" },
      { id: "mine", label: "Mine", where: { state: "open" }, sort: "due", mine: "assignee" },
      { id: "ready", label: "Ready", where: { ready: "ready" }, sort: "-updated" },
      { id: "blocked", label: "Blocked", where: { blocked: "blocked", state: "open" } },
      { id: "closed", label: "Closed", where: { state: "closed" }, sort: "-updated" },
      { id: "all", label: "All", sort: "-updated" },
    ],
  });
}

/** Wren's own cards: the console serves it on Wren's database. */
export const taskRecord: RecordType = taskRecordFor(null);
