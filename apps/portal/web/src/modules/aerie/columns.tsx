/**
 * Aerie › Tasks as Columns (aerie D16 "Columns"): the kit's Explorer over `aerieTree`, read here from the
 * page's rows, so the bar's filters and sort hold. `?at=` is where it stands; the preview is the task
 * whole (`TaskBody`, bare), so no sheet opens here.
 */

import { childrenAt, columns, type Whole } from "@wren/core/paths";
import { type AerieTreeSource, aerieRouteOf, aerieTree, OUTSIDE } from "@wren/paths/aerie-tree";
import { Explorer, type ExplorerRead, LoadFailed } from "@wren/ui";
import { useCallback, useMemo } from "react";
import type { Load } from "../../load.js";
import { href, navigate } from "../../route.js";
import { TASKS } from "./address.js";
import type { Board, TaskRow } from "./data.js";
import { TaskBody } from "./task.js";

const ROOT = "aerie";
const MARKS = { [OUTSIDE]: { label: "Outside filter" } };
// a read that waits: the rows are not here yet, so the part draws its first-load skeleton
const WAITING: ExplorerRead = {
  columns: () => new Promise(() => {}),
  children: () => new Promise(() => {}),
  find: () => new Promise(() => {}),
};

export interface TaskColumnsProps {
  /** every task; null while the first read runs */
  rows: readonly TaskRow[] | null;
  /** the filtered rows in the page's sort */
  shown: readonly TaskRow[];
  board: Load<Board>;
  params: URLSearchParams;
  onWrote: () => void;
}

/** where Columns stands: `?at=`, else the open task's route (from List or Board), else the root */
export function routeOf(params: URLSearchParams, rows: readonly TaskRow[] | null): string {
  const at = params.get("at");
  if (at) return at;
  const open = params.get("task");
  return (open && rows && aerieRouteOf(rows, open)) || ROOT;
}

export function TaskColumns({ rows, shown, board, params, onWrote }: TaskColumnsProps) {
  const route = routeOf(params, rows);
  const areas = board.data?.areas;
  const src = useMemo((): AerieTreeSource | null => {
    if (!rows || !areas) return null;
    const on = new Set(shown.map((t) => t.id));
    // the sort's order first, so each area lists its tasks as List does
    const tasks = [...shown, ...rows.filter((t) => !on.has(t.id))];
    return { areas, tasks, kept: shown.length === rows.length ? null : on };
  }, [rows, shown, areas]);
  const read = useMemo((): ExplorerRead => {
    if (!src) return WAITING;
    const a = aerieTree(src);
    return {
      columns: (r) => columns(a, r),
      children: (p, after) => childrenAt(a, p, after),
      find: (q, under) => a.find(q, under),
    };
  }, [src]);
  // the tree is the rows: new rows, new answers (a route seen before shows the old ones while it reads)
  const scope = useMemo(() => ({ read }), [read]);
  const hrefFor = useCallback(
    (r: string) => href(TASKS, { at: r === ROOT ? null : r, task: null }, params),
    [params],
  );
  const taskHref = useCallback(
    (id: string) => hrefFor((rows && aerieRouteOf(rows, id)) ?? ROOT),
    [hrefFor, rows],
  );
  const preview = (w: Whole) => {
    const id = (w.data as { id?: string } | undefined)?.id;
    return id && rows ? (
      <TaskBody id={id} rows={rows} board={board} hrefOf={taskHref} onWrote={onWrote} bare />
    ) : null;
  };
  // the areas come with the board: without them the tree has no top
  if (board.error && !board.data) return <LoadFailed error={board.error} onRetry={board.retry} />;
  return (
    <Explorer
      route={route}
      view="columns"
      name="Aerie"
      bar="crumbs"
      hrefFor={hrefFor}
      onRoute={(r) => navigate(hrefFor(r))}
      read={read}
      scope={scope}
      marks={MARKS}
      preview={preview}
      emptyText={(c) =>
        c.item.kind === "area" ? (
          <>
            File one here with{" "}
            {/* a narrow column breaks between the words, never inside the flag */}
            <code>
              aerie task create "&lt;title&gt;"{" "}
              <span className="whitespace-nowrap">--area {c.home.slice(ROOT.length + 1)}</span>
            </code>
            .
          </>
        ) : undefined
      }
    />
  );
}
