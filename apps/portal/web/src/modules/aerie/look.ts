/** How Aerie's values read: one colour per status (a lane; Done is quiet), words for empty values. */

import { lineColor } from "@wren/ui";
import { groupTasks, holdersOf, MARK, STATUSES } from "@wrenautomation/aerie/core";
import type { Board, TaskRow } from "./data.js";

/** lane order (redesign D4): these first, the board's others next, Done last */
const LANE_ORDER = ["In Progress", "In Testing", "Needs Human Input", "To Do", "Backlog", "Parked"];
export const DONE = "Done";

function laneOrder(statuses: readonly string[]): string[] {
  const known = LANE_ORDER.filter((s) => statuses.includes(s));
  const rest = statuses.filter((s) => !LANE_ORDER.includes(s) && s !== DONE);
  return [...known, ...rest, ...(statuses.includes(DONE) ? [DONE] : [])];
}

/** the board's columns (its config.yml, `board.statuses`) in lane order; aerie's default while the board loads */
export const statusesOf = (b: Board | null | undefined): readonly string[] =>
  laneOrder(b?.statuses ?? STATUSES);

/** a status as a head says it */
const STATUS_WORD: Record<string, string> = { "Needs Human Input": "Needs you" };
export const statusWord = (s: string) => STATUS_WORD[s] ?? s;

/** who acts on a task (redesign D4): the first rule that speaks */
export type Acts = "Waiting" | "Agent" | "With you" | "You";
const ACTS_LABEL: Record<string, Acts> = {
  "acts:agent": "Agent",
  "acts:with-you": "With you",
  "acts:you": "You",
};
export const isActsLabel = (l: string) => l.startsWith("acts:");
/** an agent's id: `agent:`, `runner:`, a peers session, or the shared `@claude` */
const isAgent = (id: string) =>
  id.startsWith("agent:") || id.startsWith("runner:") || id.startsWith(MARK) || id === "@claude";

export function actsOf(t: TaskRow, statusOf: (id: string) => string | undefined): Acts | null {
  if (
    t.dependencies.some((d) => {
      const s = statusOf(d);
      return s !== undefined && s !== DONE;
    })
  )
    return "Waiting";
  for (const l of t.labels) if (ACTS_LABEL[l]) return ACTS_LABEL[l];
  if (t.status === "Needs Human Input") return "You";
  const ids = [...t.assignees, ...holdersOf(t)];
  const agent = ids.some(isAgent);
  const person = ids.some((id) => !isAgent(id));
  if (agent && person) return "With you";
  return agent ? "Agent" : person ? "You" : null;
}

/** a status lookup over the rows a page holds (ids match case-blind) */
export function statusIn(rows: readonly TaskRow[]): (id: string) => string | undefined {
  const at = new Map(rows.map((r) => [r.id.toLowerCase(), r.status]));
  return (id) => at.get(id.toLowerCase());
}

/** an area's chip colour: its top folder, hashed to a line colour, so one area keeps one colour */
export function areaColor(area: string): string {
  const top = area.split("/")[0] ?? area;
  let h = 0;
  for (const c of top) h = (h * 31 + c.charCodeAt(0)) | 0;
  return lineColor(Math.abs(h) % 8);
}

/** groups in board order; status lanes take the board's own list */
export function groupsOf(
  tasks: TaskRow[],
  group: string,
  statuses: readonly string[],
  all = false,
) {
  const how = { all, ...(group === "status" ? { order: statuses } : {}) };
  if (group !== "labels") return groupTasks(tasks, group, how);
  // `acts:*` says who acts, not what the task is: no lane of its own; the groups hold the real rows
  const real = new Map(tasks.map((t) => [t, t]));
  const bare = tasks.map((t) => {
    const labels = t.labels.filter((l) => !isActsLabel(l));
    if (labels.length === t.labels.length) return t;
    const copy = { ...t, labels };
    real.set(copy, t);
    return copy;
  });
  return groupTasks(bare, group, how).map((g) => ({
    ...g,
    tasks: g.tasks.map((t) => real.get(t) ?? t),
  }));
}

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
  if (key !== null) return by === "status" ? statusWord(key) : key;
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
