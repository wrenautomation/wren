/**
 * Aerie › Tasks (aerie D16): the address holds the whole view (`viewOfAddress`); every task loads once and
 * filters here, so a filter change reads nothing. `q` asks the server's ranked search for ids.
 */

import { Empty, LoadFailed, Loading, useNarrow, useSeen } from "@wren/ui";
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
import { isNoActor, NoActor } from "./no-actor.js";
import { TaskSheet } from "./task.js";

export { TASKS };

const LAYOUTS: readonly ViewLayout[] = ["list", "board", "columns"];
const NO_TASKS: TaskRow[] = [];

export function TasksPage({ params }: PageProps) {
  const view = useMemo(() => viewOfAddress(params), [params]);
  const board = useBoard();
  const got = useRows();
  const search = useSearch(view.text);
  const narrow = useNarrow();
  const open = params.get("task");
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
  const order = useMemo(() => shownOrder(shown, group, folded), [shown, group, folded]);
  const taskAt = useCallback((id: string) => href(TASKS, { task: id }, params), [params]);

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
  else
    body = (
      <TaskList
        tasks={shown}
        group={group}
        open={open}
        onOpen={(t) => navigate(at(t))}
        hrefOf={at}
        washed={washed}
        onWashed={() => setWashed(new Set())}
        folded={folded}
        onFold={fold}
      />
    );

  return (
    <div className="grid min-w-0 gap-3">
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
      {open && !onColumns && (
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
