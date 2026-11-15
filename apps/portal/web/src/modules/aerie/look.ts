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
