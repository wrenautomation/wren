/**
 * Aerie's reads (aerie D16): every task once, then on a push (live topic `aerie`) only the rows
 * written since the newest held, merged by id and version. Filters run in the browser
 * (`matches`), so a filter change reads nothing.
 */

import { changedSince, mergeRows } from "@wrenautomation/aerie/core";
import type { AerieAnswer, AerieRoute } from "@wrenautomation/aerie/http";
import { call } from "../../api.js";
import { useCall } from "../../load.js";

export type Board = AerieAnswer<"board">;
export type TaskRow = AerieAnswer<"tasks">[number];

export const LIVE = "aerie";
/** first read: the board's folders; a delta adds archive, so a task archived elsewhere leaves */
const SHOWN = ["tasks", "drafts"] as const;
const EVERY = ["tasks", "drafts", "archive/tasks", "archive/drafts"] as const;

const aerieCall = <K extends AerieRoute>(k: K, input: Record<string, unknown> = {}) =>
  call<AerieAnswer<K>>(`aerie/${k}`, input);

export const useBoard = () =>
  useCall<Board>("aerie/board", () => aerieCall("board"), { live: LIVE });

/** kept on the device; the wash is the page's diff, so a reload marks nothing */
export interface Rows {
  rows: TaskRow[];
}

async function readRows(before: Rows | undefined): Promise<Rows> {
  const since = before && changedSince(before.rows);
  if (!before || !since)
    return { rows: await aerieCall("tasks", { filter: { place: [...SHOWN] } }) };
  const delta = await aerieCall("tasks", { filter: { place: [...EVERY], updatedAfter: since } });
  return { rows: mergeRows(before.rows, delta).rows };
}

export const useRows = () => useCall<Rows>("aerie/tasks", readRows, { live: LIVE });

export type SavedView = Board["views"][number];

/** the viewer's own view, kept by name (a taken name replaces it) */
export const saveView = (v: Omit<SavedView, "id">) =>
  aerieCall("saveView", v as unknown as Record<string, unknown>);
export const deleteView = (name: string) => aerieCall("deleteView", { name });

/** ids in rank order; the page keeps its other filters */
export const useSearch = (text: string | undefined) =>
  useCall<string[]>(text ? `aerie/search:${text}` : null, () => aerieCall("search", { text }), {
    kept: false,
  });

/** a task whole and its events (oldest first); live, so a write elsewhere shows in the open panel */
export type TaskWhole = AerieAnswer<"task">;
export const useTask = (id: string) =>
  useCall<TaskWhole>(`aerie/task:${id}`, () => aerieCall("task", { id }), { live: LIVE });

/** the panel's picks; `expect` is the version read, a newer one refuses with 409 */
export type TaskPick = { status?: string; priority?: string | null };
export const editTask = (id: string, expect: number, edit: TaskPick) =>
  aerieCall("edit", { id, expect, edit });
