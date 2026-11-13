/**
 * Aerie's answers (`@wrenautomation/aerie/http`), typed by its API. Synthetic tasks: made-up areas, people and
 * work. Worst cases ride along: a long unbroken title, a task with no priority, area `inbox` or assignee,
 * a task in two label groups, a held task, and a big Done pile.
 */
import type { AerieAnswer, AerieApi } from "@wrenautomation/aerie/http";
import { serve } from "../api.js";
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
    },
  ),
  row("EX-104", "Write the weekly numbers note", "To Do", "ops", {
    priority: "low",
    assignees: ["@alex"],
    summary: "Opens, replies and booked calls for the week.",
    days: 2,
  }),
  row("EX-105", "Untriaged idea from a chat", "To Do", "inbox", { days: 0.5 }),
  row("EX-106", "Archive the old pricing page", "Backlog", "dev/site", {
    priority: "low",
    labels: ["repo:site"],
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

const BOARD: AerieAnswer<"board"> = {
  me: "@william",
  areas: [
    { id: 1, path: "dev", name: "Development", description: null, mirror: true, count: 29 },
    { id: 2, path: "dev/site", name: "Site", description: null, mirror: true, count: 17 },
    { id: 3, path: "growth", name: "Growth", description: null, mirror: false, count: 2 },
    { id: 4, path: "growth/email", name: "Email", description: null, mirror: false, count: 1 },
    { id: 5, path: "inbox", name: "Inbox", description: null, mirror: false, count: 1 },
    { id: 6, path: "ops", name: "Operations", description: null, mirror: false, count: 13 },
  ],
  grants: [
    { area: "dev", actor: "@william", role: "owner" },
    { area: "growth", actor: "@alex", role: "manager" },
    { area: "dev/site", actor: "@sam", role: "doer" },
  ],
  milestones: [],
  actors: [
    { id: "@william", kind: "person", name: "William" },
    { id: "@alex", kind: "person", name: "Alex" },
    { id: "@sam", kind: "person", name: "Sam" },
  ],
  views: [],
  writes: false,
};

export const AERIE_ANSWERS = serve<AerieApi>("aerie", {
  board: BOARD,
  // a delta read (`updatedAfter`) finds nothing new: nothing changes behind a story
  tasks: (b) =>
    (b.filter as { updatedAfter?: string } | undefined)?.updatedAfter ? [] : AERIE_TASKS,
  search: (b) => {
    const q = String(b.text).toLowerCase();
    return AERIE_TASKS.filter((t) =>
      `${t.id} ${t.title} ${t.summary ?? ""}`.toLowerCase().includes(q),
    ).map((t) => t.id);
  },
  decisions: [],
});
