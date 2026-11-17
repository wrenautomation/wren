/** How Aerie's values read: one colour per status (a lane; Done is quiet), words for empty values. */

import { lineColor } from "@wren/ui";
import { groupTasks, holdersOf, MARK, STATUSES } from "@wrenautomation/aerie/core";
import type { Board, TaskRow } from "./data.js";

/** the board's columns (its config.yml, `board.statuses`); aerie's default while the board loads */
export const statusesOf = (b: Board | null | undefined): readonly string[] =>
  b?.statuses ?? STATUSES;

/** groups in board order; status lanes take the board's own list */
export const groupsOf = (
  tasks: TaskRow[],
  group: string,
  statuses: readonly string[],
  all = false,
) => groupTasks(tasks, group, { all, ...(group === "status" ? { order: statuses } : {}) });

/** a colour per known status; amber stays "late" only, so Needs Human Input gets a lane too. Others: grey */
const LANE: Record<string, number> = {
  "To Do": 0,
  "In Progress": 1,
  "In Testing": 4,
  "Needs Human Input": 3,
  Backlog: 5,
  Parked: 6,
};

export const statusColor = (s: string) => (s in LANE ? lineColor(LANE[s] as number) : undefined);

/** priority as a tinted pill: high red, medium amber, low plain */
const PRIORITY: Record<string, string> = { high: "var(--ui-bad)", medium: "var(--ui-warn)" };
export const priorityColor = (p: string) => PRIORITY[p];

/** a group's head: the field's value, or what its absence means */
export function groupLabel(by: string, key: string | null): string {
  if (key !== null) return key;
  const NONE: Record<string, string> = {
    priority: "No priority",
    assignee: "Nobody",
    holder: "Not held",
    labels: "No label",
    milestone: "No milestone",
    parent: "No parent",
    type: "No type",
  };
  return NONE[by] ?? "None";
}

/** people on a task: assignees, then holders (a peers session at work on it) */
export const peopleOf = (t: TaskRow) => [
  ...t.assignees.filter((a) => !a.startsWith(MARK)).map((id) => ({ id, holds: false })),
  ...holdersOf(t).map((id) => ({ id, holds: true })),
];

/** an actor id as a name: "@william" → "william" */
export const who = (id: string) => id.replace(/^@/, "");

/** an edit's fields named: a short value shows, a long text field names itself */
const SHORT = new Set(["status", "priority", "area", "place", "milestone", "type", "parentId"]);
const FIELD_WORD: Record<string, string> = {
  parentId: "parent",
  ac: "acceptance criteria",
  dod: "definition of done",
  appendPlan: "plan",
  appendNotes: "notes",
  finalSummary: "final summary",
  appendFinalSummary: "final summary",
  clearFinalSummary: "final summary",
  addLabels: "labels",
  removeLabels: "labels",
  addDeps: "dependencies",
  clearDeps: "dependencies",
  addAliases: "areas",
  removeAliases: "areas",
};
/** the kinds that are not edits, said plainly (store.ts event + log) */
const KIND_SAYS: Record<string, string> = {
  create: "made it",
  filed: "filed it from a note",
  "run.start": "started a run",
};
/** run.result outcomes (run/port.ts RunResult) */
const RUN_SAYS: Record<string, string> = {
  done: "finished a run",
  failed: "had a run fail",
  "needs-input": "stopped a run for input",
  stopped: "stopped a run",
};

export interface EventLike {
  kind: string;
  body: unknown;
}

/** an event as a plain phrase after the actor's name ("set status to Done") */
export function eventSays(e: EventLike): string {
  const body = (e.body ?? {}) as Record<string, unknown>;
  if (e.kind === "import")
    return typeof body.place === "string" ? `imported it (${body.place})` : "imported it";
  if (e.kind === "routed")
    return typeof body.runner === "string" ? `sent it to ${body.runner}` : "routed it";
  if (e.kind === "run.result") return RUN_SAYS[String(body.outcome)] ?? "ended a run";
  if (e.kind !== "edit") return KIND_SAYS[e.kind] ?? e.kind.replace(/[._]/g, " ");
  const said = new Set<string>();
  for (const [k, v] of Object.entries(body)) {
    const word = FIELD_WORD[k] ?? k;
    if (SHORT.has(k)) said.add(v == null ? `cleared ${word}` : `set ${word} to ${String(v)}`);
    else said.add(`changed ${word}`);
  }
  return said.size ? [...said].join(", ") : "edited it";
}

/** an event's own words: the why, else a run's summary or question */
export function eventText(e: EventLike & { why?: string | null }): string | null {
  const body = (e.body ?? {}) as Record<string, unknown>;
  for (const t of [e.why, body.summary, body.question])
    if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}
