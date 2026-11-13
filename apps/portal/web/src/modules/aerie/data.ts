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


/** ids in rank order; the page keeps its other filters */
export const useSearch = (text: string | undefined) =>
  useCall<string[]>(text ? `aerie/search:${text}` : null, () => aerieCall("search", { text }), {
    kept: false,
  });

