/**
 * Aerie's reads (aerie D16): every task once, then on a push (live topic `aerie`) only the rows
 * written since the newest held, merged by id and version. Filters run in the browser
 * (`matches`), so a filter change reads nothing.
 */

import { say } from "@wren/ui";
import {
  applyEdit,
  changedSince,
  type MoveEdit,
  mergeRows,
  type Task,
} from "@wrenautomation/aerie/core";
import type { AerieAnswer, AerieRoute } from "@wrenautomation/aerie/http";
import { type ApiError, call } from "../../api.js";
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
export const editTask = (id: string, expect: number, edit: TaskPick | MoveEdit) =>
  aerieCall("edit", { id, expect, edit });

/** the row the server will answer: core `applyEdit`, the store's own step, one version on */
export function predict(r: TaskRow, edit: MoveEdit): TaskRow {
  const { area, ...rest } = edit;
  const t = applyEdit(
    { ...r, comments: [], extra: {} } as unknown as Task,
    rest,
    new Date().toISOString(),
  );
  return {
    ...r,
    ...(t as unknown as TaskRow),
    comments: r.comments,
    area: area ?? r.area,
    version: r.version + 1,
  };
}

/** a refused write's toast: 409 names the task, the rest say the server's line */
export function sayRefused(id: string, err: unknown) {
  say.failed(
    (err as ApiError).status === 409
      ? new Error(`${id} changed since you read it. It shows the newest now.`)
      : err,
  );
}

/** D13: open ones, or answered ones (`open: false`); live, so an `aerie ask` or a CLI answer shows */
export type DecisionRow = AerieAnswer<"decisions">[number];
export const useDecisions = (open: boolean) =>
  useCall<DecisionRow[]>(
    `aerie/decisions:${open ? "open" : "answered"}`,
    () => aerieCall("decisions", { open }),
    { live: LIVE },
  );

/** open: due first (none last), then oldest asked; answered: newest answer first */
export function decisionOrder(rows: readonly DecisionRow[], open: boolean): DecisionRow[] {
  const by = (d: DecisionRow) => (open ? [d.due ?? "￿", d.askedAt] : [d.answeredAt ?? ""]);
  return [...rows].sort((a, b) => {
    const [x, y] = [by(a), by(b)];
    for (let i = 0; i < x.length; i++) {
      const c = (x[i] as string).localeCompare(y[i] as string);
      if (c) return open ? c : -c;
    }
    return a.id - b.id;
  });
}

const ANSWERED = /^decision \d+ is answered \((.*)\)$/;

/**
 * The answer under the press's request id. A 409 naming this answer is this press landing twice
 * (a reload sent it again): done. Another answer: say whose.
 */
export async function decide(d: DecisionRow, answer: string, why: string, requestId: string) {
  try {
    return await call<DecisionRow>("aerie/decide", {
      id: d.id,
      answer,
      ...(why ? { why } : {}),
      requestId,
    });
  } catch (err) {
    const e = err as ApiError;
    const was = e.status === 409 ? ANSWERED.exec(e.message)?.[1] : undefined;
    if (was === answer) return d;
    if (was !== undefined)
      throw new Error(`Decision ${d.id} was answered elsewhere: ${was}.`, { cause: err });
    throw err;
  }
}

/** History (aerie D16): every event newest first, with its task's title */
export type FeedRow = AerieAnswer<"feed">[number];
export const FEED_PAGE = 100;
/** page one and every row held before it; `epoch` moves when a gap made it start over */
export interface Feed {
  rows: FeedRow[];
  end: boolean;
  epoch: number;
}

/** one list newest first, a seq once */
export const mergeFeed = (rows: FeedRow[]) => {
  const seen = new Map<number, FeedRow>();
  for (const r of rows) seen.set(r.seq, r);
  return [...seen.values()].sort((a, b) => b.seq - a.seq);
};

/** events never change, so a push merges page one into the held rows by seq; no shared seq = a gap */
async function readFeed(words: string, before: Feed | undefined): Promise<Feed> {
  const page = await aerieCall("feed", { ...(words ? { words } : {}), limit: FEED_PAGE });
  const end = page.length < FEED_PAGE;
  if (!before) return { rows: page, end, epoch: 0 };
  const held = new Set(before.rows.map((r) => r.seq));
  if (!end && !page.some((r) => held.has(r.seq)))
    return { rows: page, end, epoch: before.epoch + 1 };
  return {
    rows: mergeFeed([...page, ...before.rows]),
    end: end || before.end,
    epoch: before.epoch,
  };
}

export const useFeed = (words: string) =>
  useCall<Feed>(`aerie/feed:${words}`, (before) => readFeed(words, before), {
    live: LIVE,
    // typed words are a passing look; the bare feed is kept on the device
    ...(words ? { kept: false } : {}),
  });

/** the page below the lowest seq held */
export const readOlder = (words: string, before: number) =>
  aerieCall("feed", { ...(words ? { words } : {}), before, limit: FEED_PAGE });

/** Intake (aerie D19, WA-1420): one receipt per filing, newest first; its tasks in any place */
export type Receipt = AerieAnswer<"intake">;
export const INTAKE_PAGE = 20;
export interface Receipts {
  rows: Receipt[];
  end: boolean;
}

export const useReceipts = () =>
  useCall<Receipts>("aerie/intakes", () => aerieCall("intakes", { limit: INTAKE_PAGE }), {
    live: LIVE,
  });

/** the page below the lowest id held */
export const readOlderReceipts = (before: number) =>
  aerieCall("intakes", { before, limit: INTAKE_PAGE });

/** the words as filed; `ear` names the dictation adapter when any of them were spoken */
export const fileWords = (words: string, ear: string | null) =>
  aerieCall("intake", { words, kind: ear ? "voice" : "text", ...(ear ? { ear } : {}) });

/** one list newest first, an id once; the first copy wins (page one is the fresher read) */
export const mergeReceipts = (rows: Receipt[]) => {
  const seen = new Map<number, Receipt>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()].sort((a, b) => b.id - a.id);
};
