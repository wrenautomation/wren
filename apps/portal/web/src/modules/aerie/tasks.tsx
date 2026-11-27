/**
 * Aerie › Tasks (aerie D16): the address holds the whole view (`viewOfAddress`); every task loads once and
 * filters here, so a filter change reads nothing. `q` asks the server's ranked search for ids.
 */

import { Empty, LoadFailed, Loading, typing, useNarrow, useRoom, useSeen, walkKey } from "@wren/ui";
import {
  compare,
  matches,
  mergeRows,
  moveEdit,
  type ViewLayout,
  viewOfAddress,
} from "@wrenautomation/aerie/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { addressOf, GROUP, TASKS, unfiltered, withoutText } from "./address.js";
import { AerieBar } from "./bar.js";
import { TaskBoard } from "./board.js";
import { TaskColumns } from "./columns.js";
import {
  editTask,
  predict,
  sayRefused,
  type TaskRow,
  useBoard,
  useRows,
  useSearch,
} from "./data.js";
import { SHUT, shownOrder, TaskList } from "./list.js";
import { actsOf, statusesOf, statusIn } from "./look.js";
import { isNoActor, NoActor } from "./no-actor.js";
import { TaskBody, TaskSheet } from "./task.js";

export { TASKS };

const LAYOUTS: readonly ViewLayout[] = ["list", "board", "columns"];
const NO_TASKS: TaskRow[] = [];
/** main this wide or wider: the List docks the open task on its right (raycast-light D2) */
const SPLIT_AT = 800;
/** parts that keep j k ↑ ↓ for themselves */
const OWN_KEYS =
  '[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"],[role="tablist"]';

export function TasksPage({ params }: PageProps) {
  const view = useMemo(() => viewOfAddress(params), [params]);
  const board = useBoard();
  const got = useRows();
  const search = useSearch(view.text);
  const narrow = useNarrow();
  const open = params.get("task");
  // main's width, not the window's: the agent panel narrows it. undefined until measured
  const [measure, room] = useRoom();
  const [washed, setWashed] = useState<ReadonlySet<string>>(new Set());
  // id → version once the mount's first read settles; later reads wash what moved past it
  const held = useRef<Map<string, number> | null>(null);
  // the viewer's own writes, id → the version they make: set before the call, so a push that reads
  // the row before the answer lands still does not wash it
  const own = useRef(new Map<string, number>());
  // a move's row, predicted then answered, over the read rows until they reach its version; kept out of
  // the read's cache, so the delta cursor (`changedSince`) stays on the server's clock
  const [over, setOver] = useState<ReadonlyMap<string, TaskRow>>(new Map());
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
  const read = got.data?.rows ?? NO_TASKS;
  const rows = useMemo(
    () => (over.size ? mergeRows(read, [...over.values()]).rows : read),
    [read, over],
  );
  useEffect(() => {
    if (!got.data || got.loading) return;
    const was = held.current;
    held.current = new Map(got.data.rows.map((t) => [t.id, t.version]));
    // a read that reached a move's version takes over from it
    const at = held.current;
    setOver((m) => {
      const left = [...m].filter(([id, r]) => (at.get(id) ?? -1) < r.version);
      return left.length === m.size ? m : new Map(left);
    });
    if (!was) return;
    const moved = got.data.rows
      .filter((t) => was.get(t.id) !== t.version && own.current.get(t.id) !== t.version)
      .map((t) => t.id);
    if (moved.length) setWashed(new Set(moved));
  }, [got.data, got.loading]);
  useSeen("list", { label: "Tasks", icon: "board", text: "Aerie tasks" });

  // search ranks; while it reads or failed, the other filters still apply
  const ranked = view.text ? search.data : null;
  const hits = useMemo(() => (ranked ? new Set(ranked) : null), [ranked]);
  const shown = useMemo(() => {
    const ctx = { grants: board.data?.grants ?? [] };
    const kept = rows.filter((t) => matches(t, view.filter, ctx));
    if (ranked) {
      const at = new Map(kept.map((t) => [t.id, t]));
      return ranked.flatMap((id) => at.get(id) ?? []);
    }
    return kept.sort(compare(view.sort));
  }, [rows, board.data, view, ranked]);

  const onBoard = view.layout === "board";
  // Columns previews the task itself: no sheet there
  const onColumns = view.layout === "columns";
  const writes = board.data?.writes === true;
  const { retry } = got;
  const groupKey = view.group ?? GROUP;
  const move = useMemo(() => {
    if (!writes) return undefined;
    const onMove = (t: TaskRow, from: string | null, to: string | null) => {
      const edit = moveEdit(groupKey, t, from, to);
      if (!edit) return;
      const guess = predict(t, edit);
      own.current.set(t.id, guess.version);
      setOver((m) => new Map(m).set(t.id, guess));
      setMoving((s) => new Set(s).add(t.id));
      const drop = <V,>(m: ReadonlyMap<string, V>) => {
        const n = new Map(m);
        n.delete(t.id);
        return n;
      };
      editTask(t.id, t.version, edit)
        .then((answer) => {
          own.current.set(t.id, answer.version);
          setOver((m) => new Map(m).set(t.id, answer));
        })
        .catch((err: unknown) => {
          // the card goes back to its lane; the read brings the newest row
          setOver((m) => drop(m));
          sayRefused(t.id, err);
        })
        .finally(() => {
          setMoving((s) => {
            const n = new Set(s);
            n.delete(t.id);
            return n;
          });
          retry();
        });
    };
    return { onMove, busy: (t: TaskRow) => moving.has(t.id) };
  }, [writes, groupKey, moving, retry]);
  // search ranks across groups on the List; the Board keeps its lanes (rank order inside each)
  const group = ranked && !onBoard ? null : (view.group ?? GROUP);
  const [folded, setFolded] = useState<ReadonlySet<string>>(SHUT);
  const fold = (k: string) =>
    setFolded((s) => {
      const next = new Set(s);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const statuses = statusesOf(board.data);
  const order = useMemo(
    () => shownOrder(shown, group, folded, statuses),
    [shown, group, folded, statuses],
  );
  const taskAt = useCallback((id: string) => href(TASKS, { task: id }, params), [params]);
  const acts = useMemo(() => {
    const statusOf = statusIn(rows);
    return (t: TaskRow) => actsOf(t, statusOf);
  }, [rows]);
  const onList = !onBoard && !onColumns;
  const split = onList && room !== undefined && room >= SPLIT_AT;
  // a pick replaces the address: the walk is not history
  const pick = useCallback((id: string) => navigate(taskAt(id), true), [taskAt]);
  useWalk(split, open, order, pick);

  const err = got.error ?? board.error;
  if (isNoActor(err)) return <NoActor error={err} />;
  const at = (t: TaskRow) => taskAt(t.id);
  const boardOf = (tasks: TaskRow[] | null) => ({
    tasks,
    group: group ?? GROUP,
    open,
    onOpen: (t: TaskRow) => navigate(at(t)),
    hrefOf: at,
    washed,
    onWashed: () => setWashed(new Set()),
    folded,
    onFold: fold,
    narrow,
    only: view.filter.status,
    statuses,
    actsOf: acts,
    move,
  });

  let body: ReactNode;
  if (got.error && !got.data) body = <LoadFailed error={got.error} onRetry={got.retry} />;
  else if (onColumns && (!got.data || shown.length))
    body = (
      <TaskColumns
        rows={got.data ? rows : null}
        shown={shown}
        board={board}
        params={params}
        onWrote={got.retry}
      />
    );
  else if (!got.data)
    body = onBoard ? <TaskBoard {...boardOf(null)} /> : <Loading shape="rows" lines={8} />;
  else if (!rows.length)
    body = (
      <Empty title="No tasks yet" waits>
        Tasks land here from <code>aerie import</code>, <code>backlog task create</code> or an
        agent.
      </Empty>
    );
  else if (!shown.length)
    body = ranked ? (
      <Empty action={<a href={addressOf(params, withoutText(view))}>Clear search</a>}>
        No task mentions “{view.text}”.
      </Empty>
    ) : (
      <Empty action={<a href={addressOf(params, unfiltered(view))}>Clear filters</a>}>
        No task matches these filters.
      </Empty>
    );
  else if (onBoard) body = <TaskBoard {...boardOf(shown)} />;
  else {
    const list = (
      <TaskList
        tasks={shown}
        group={group}
        open={open}
        onOpen={(t) => (split ? pick(t.id) : navigate(at(t)))}
        hrefOf={at}
        washed={washed}
        onWashed={() => setWashed(new Set())}
        folded={folded}
        onFold={fold}
        statuses={statuses}
        narrow={split}
      />
    );
    body = split ? (
      // Backlog.md's board on Tab: the list at 40%, the task at 60%
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-6">
        {list}
        <section
          aria-label="Task"
          // pb-20: the last line scrolls clear of the agent circle
          className="sticky top-[calc(var(--phone-bar,0px)+16px)] max-h-[calc(100dvh-var(--phone-bar,0px)-32px)] overflow-y-auto overscroll-contain rounded-(--ui-leaf-panel) bg-(--ui-paper) p-5 pb-20 shadow-(--ui-raise) [scrollbar-width:thin]"
        >
          {open ? (
            <TaskBody
              key={open}
              id={open}
              rows={rows}
              board={board}
              hrefOf={taskAt}
              onWrote={got.retry}
            />
          ) : (
            <p className="m-0 py-10 text-center text-[13.5px] text-(--ui-ink-3)">
              Pick a task to read it here.
            </p>
          )}
        </section>
      </div>
    ) : (
      list
    );
  }

  return (
    <div ref={measure} className="grid min-w-0 gap-3">
      <div className="pb-2">
        <AerieBar
          params={params}
          view={view}
          board={board}
          rows={rows}
          counted={!!got.data}
          hits={hits}
          search={{
            loading: !!view.text && search.loading,
            error: search.error,
            retry: search.retry,
          }}
          narrow={narrow}
          layouts={LAYOUTS}
        />
      </div>
      {body}
      {/* the sheet waits for the first measure, so a wide reload never plays it then swaps */}
      {open && !onColumns && !split && room !== undefined && (
        <TaskSheet
          id={open}
          rows={rows}
          board={board}
          hrefOf={taskAt}
          order={order}
          onClose={() => navigate(href(TASKS, { task: null }, params), true)}
          onWrote={got.retry}
        />
      )}
    </div>
  );
}

/**
 * j k ↑ ↓ on the split List: the pick moves in the List's order. No pick, or a pick filtered out:
 * ↓ and j take the first row. Typing, a menu or a dialog keep their keys.
 */
function useWalk(
  on: boolean,
  open: string | null,
  order: readonly string[],
  pick: (id: string) => void,
) {
  useEffect(() => {
    if (!on) return;
    const press = (e: KeyboardEvent) => {
      if (typing(e) || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(OWN_KEYS)) return;
      const step = walkKey(e);
      if (!step) return;
      const at = open ? order.indexOf(open) : -1;
      const next = at < 0 ? (step > 0 ? order[0] : undefined) : order[at + step];
      e.preventDefault();
      if (next) pick(next);
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [on, open, order, pick]);
}
