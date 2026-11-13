/**
 * Aerie's answers (`@wrenautomation/aerie/http`), typed by its API. Synthetic tasks: made-up areas, people and
 * work. Worst cases ride along: a long unbroken title, a task with no priority, area `inbox` or assignee,
 * a task in two label groups, a held task, and a big Done pile.
 */
import { applyEdit, type Edit, type Task } from "@wrenautomation/aerie/core";
import type { AerieAnswer, AerieApi } from "@wrenautomation/aerie/http";
import { onFreshStory, refuse, serve } from "../api.js";
import { ago } from "./shell.js";

type Row = AerieAnswer<"tasks">[number];

const row = (
  id: string,
  title: string,
  status: string,
  area: string,
  more: Partial<Row> & { days?: number } = {},
): Row => {
  const { days = 3, ...rest } = more;
  return {
    id,
    title,
    status,
    area,
    aliases: [],
    place: "tasks",
    version: 1,
    assignees: [],
    createdAt: ago(days + 4),
    updatedAt: ago(days),
    labels: [],
    dependencies: [],
    references: [],
    ac: [],
    dod: [],
    comments: 0,
    ...rest,
  };
};

const DONE = Array.from({ length: 24 }, (_, i) =>
  row(`EX-${200 + i}`, `Closed piece of work number ${i + 1}`, "Done", i % 2 ? "dev/site" : "ops", {
    days: 10 + i,
    priority: "low",
  }),
);

export const AERIE_TASKS: Row[] = [
  row("EX-101", "Move the sign-up form to the new page layout", "In Progress", "dev/site", {
    priority: "high",
    assignees: ["@sam", "@peers:cc-1a2b3c4d"],
    summary: "The form sits under the fold on a phone and loses half its sign-ups.",
    labels: ["repo:site"],
    milestone: "m-spring",
    type: "feature",
    ac: [
      { text: "Form above the fold at 390", done: true },
      { text: "Same fields as before", done: false },
    ],
    days: 0.1,
  }),
  row("EX-102", "Pick the launch date for the spring offer", "Needs Human Input", "growth", {
    priority: "medium",
    assignees: ["@alex"],
    summary: "Two dates fit the calendar; each moves a different campaign.",
    milestone: "m-spring",
    days: 1,
  }),
  row(
    "EX-103",
    "Supercalifragilisticexpialidocious_long_unbroken_identifier_that_never_wraps_on_its_own_and_must_not_overflow",
    "To Do",
    "dev/site",
    {
      priority: "medium",
      summary:
        "A worst-case title: one word longer than any row is wide, then a summary sentence that runs long on purpose so the row has to wrap it whole, never clip it with an ellipsis.",
      labels: ["repo:site", "worst-case"],
      type: "bug",
    },
  ),
  row("EX-104", "Write the weekly numbers note", "To Do", "ops", {
    priority: "low",
    assignees: ["@alex"],
    summary: "Opens, replies and booked calls for the week.",
    // inbox reads it too: an alias row there (not growth: Board EmptyLane needs its To Do empty)
    aliases: ["inbox"],
    days: 2,
  }),
  row("EX-105", "Untriaged idea from a chat", "To Do", "inbox", { days: 0.5 }),
  row("EX-106", "Archive the old pricing page", "Backlog", "dev/site", {
    priority: "low",
    labels: ["repo:site"],
    dependencies: ["EX-101"],
    days: 6,
  }),
  row("EX-107", "Try a second subject line on the follow-up", "Parked", "growth/email", {
    priority: "medium",
    summary: "Parked until the first test reads out.",
    days: 8,
  }),
  row("EX-108", "Fix the broken link in the footer", "In Progress", "dev/site", {
    priority: "high",
    assignees: ["@peers:cc-9f8e7d6c"],
    parentId: "EX-101",
    days: 0.3,
  }),
  ...DONE,
];

const SPREAD = ["To Do", "In Progress", "Backlog", "Parked", "Done", "Done", "Done", "Done"];
const AREAS = ["dev/site", "growth", "growth/email", "ops", "inbox"];
/** prod's size (776 rows on 11-13), mostly Done: the List's speed check */
export const manyTasks = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) =>
    row(
      `EX-${1000 + i}`,
      `Piece of work number ${i + 1}`,
      SPREAD[i % SPREAD.length] as string,
      AREAS[i % AREAS.length] as string,
      {
        days: 1 + (i % 60),
        priority: i % 3 ? "medium" : "high",
        assignees: i % 4 ? ["@alex"] : ["@sam", "@peers:cc-1a2b3c4d"],
        summary: "A first sentence that runs about as long as a real one does on the board.",
        labels: i % 5 ? [] : ["repo:site"],
      },
    ),
  );

export const AERIE_BOARD: AerieAnswer<"board"> = {
  me: "@william",
  areas: [
    { id: 1, path: "dev", name: "Development", description: null, mirror: true, count: 29 },
    { id: 2, path: "dev/site", name: "Site", description: null, mirror: true, count: 17 },
    { id: 3, path: "growth", name: "Growth", description: null, mirror: false, count: 2 },
    { id: 4, path: "growth/email", name: "Email", description: null, mirror: false, count: 1 },
    { id: 5, path: "inbox", name: "Inbox", description: null, mirror: false, count: 1 },
    { id: 6, path: "ops", name: "Operations", description: null, mirror: false, count: 13 },
    // no task yet: Columns' empty area
    {
      id: 7,
      path: "content",
      name: "Content",
      description: "Videos and posts",
      mirror: false,
      count: 0,
    },
  ],
  grants: [
    { area: "dev", actor: "@william", role: "owner" },
    { area: "growth", actor: "@alex", role: "manager" },
    { area: "dev/site", actor: "@sam", role: "doer" },
  ],
  milestones: [
    { id: "m-spring", title: "Spring offer", description: null, total: 2, done: 0 },
    { id: "m-later", title: "Later", description: null, total: 0, done: 0 },
  ],
  actors: [
    { id: "@william", kind: "person", name: "William" },
    { id: "@alex", kind: "person", name: "Alex" },
    { id: "@sam", kind: "person", name: "Sam" },
  ],
  views: [
    {
      id: 1,
      name: "Site work",
      filter: { area: ["dev/site"], status: ["To Do", "In Progress"] },
      sort: [{ field: "priority", dir: "asc" }],
      layout: "list",
    },
  ],
  writes: false,
};

type Whole = AerieAnswer<"task">;
type Event = Whole["events"][number];

/** the long fields a row leaves on the server; EX-101 carries every part the panel draws */
const LONG: Record<string, Partial<Whole["task"]>> = {
  "EX-101": {
    description:
      "The form sits under the fold on a phone and loses half its sign-ups.\n\nMove it into the first screen and keep the same fields. See the **spring offer** brief.",
    dod: [
      { text: "Shot at 390 and 1280", done: true },
      { text: "No new field", done: false },
      {
        text: "A long check that wraps on a phone because it names every page the form shows on, one by one",
        done: false,
      },
    ],
    plan: "1. Move the form block.\n2. Shoot both widths.\n3. Ship behind the usual check.",
    notes: "Held by a session since this morning.",
    comments: [
      {
        author: "@alex",
        created: "2026-11-10T09:12:00Z",
        body: "The old page converts at half the rate on a phone.",
      },
    ],
  },
};

const EVENTS: Record<string, Event[]> = {
  "EX-101": [
    {
      seq: 1,
      taskId: "EX-101",
      at: "2026-11-08T10:00:00Z",
      by: "@william",
      kind: "create",
      why: null,
      body: {},
    },
    {
      seq: 4,
      taskId: "EX-101",
      at: "2026-11-09T14:30:00Z",
      by: "@sam",
      kind: "edit",
      why: "Started on the layout",
      body: { status: "In Progress" },
    },
    {
      seq: 9,
      taskId: "EX-101",
      at: "2026-11-11T08:05:00Z",
      by: "@peers:cc-1a2b3c4d",
      kind: "edit",
      why: null,
      body: { appendNotes: ["Held by a session since this morning."], ac: { check: [1] } },
    },
  ],
};

/** a row of `rows` whole: its long fields from `LONG`, else a one-line description */
export function wholeOf(id: string, rows: readonly Row[] = AERIE_TASKS): Whole | null {
  const r = rows.find((t) => t.id.toUpperCase() === id.toUpperCase());
  if (!r) return null;
  const { comments: _c, summary, ...rest } = r;
  return {
    task: {
      ...rest,
      ...(summary ? { description: summary } : {}),
      comments: [],
      extra: {},
      ...LONG[r.id],
    },
    events: EVENTS[r.id] ?? [
      {
        seq: 1,
        taskId: r.id,
        at: r.createdAt,
        by: "@william",
        kind: "create",
        why: null,
        body: {},
      },
    ],
  };
}

/** rows a story wrote, by id: reads see them, so a move stays moved */
const written = new Map<string, Row>();
onFreshStory(() => written.clear());
const rowOf = (id: string) => written.get(id) ?? AERIE_TASKS.find((t) => t.id === id);
const current = () => AERIE_TASKS.map((t) => written.get(t.id) ?? t);

/** the server's write: core `applyEdit` on the row, `area` as a placement, one version on */
function write(r: Row, edit: Edit & { area?: string }): Row {
  const { area, ...rest } = edit;
  const t = applyEdit(
    { ...r, comments: [], extra: {} } as unknown as Task,
    rest,
    new Date().toISOString(),
  );
  return {
    ...r,
    ...(t as unknown as Row),
    comments: r.comments,
    area: area ?? r.area,
    version: r.version + 1,
  };
}

export const AERIE_ANSWERS = serve<AerieApi>("aerie", {
  board: AERIE_BOARD,
  // a delta read (`updatedAfter`) answers the rows a story wrote since
  tasks: (b) => {
    const after = (b.filter as { updatedAfter?: string } | undefined)?.updatedAfter;
    return after
      ? [...written.values()].filter((r) => (r.updatedAt ?? r.createdAt) > after)
      : current();
  },
  search: (b) => {
    const q = String(b.text).toLowerCase();
    return current()
      .filter((t) => `${t.id} ${t.title} ${t.summary ?? ""}`.toLowerCase().includes(q))
      .map((t) => t.id);
  },
  task: async (b) => wholeOf(String(b.id), current()) ?? refuse(404, `no task ${String(b.id)}`),
  // stories that turn writes on override the board
  edit: async (b) => {
    const r = rowOf(String(b.id));
    if (!r) return refuse(404, `no task ${String(b.id)}`);
    if (b.expect !== r.version) return refuse(409, `stale: ${r.id} is at version ${r.version}`);
    const next = write(r, b.edit as Edit);
    written.set(r.id, next);
    return next;
  },
  decisions: [],
  saveView: (b) => ({ id: 2, ...(b as Omit<AerieAnswer<"saveView">, "id">) }),
  deleteView: true,
});
