/**
 * Aerie › Tasks (aerie D16): the address holds the whole view (`viewOfAddress`); every task loads once and
 * filters here, so a filter change reads nothing. `q` asks the server's ranked search for ids.
 */

import { Empty, LoadFailed, Loading, useNarrow, useSeen } from "@wren/ui";
import { compare, matches, type ViewLayout, viewOfAddress } from "@wrenautomation/aerie/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { addressOf, GROUP, TASKS, unfiltered, withoutText } from "./address.js";
import { AerieBar } from "./bar.js";
import { type TaskRow, useBoard, useRows, useSearch } from "./data.js";
import { SHUT, shownOrder, TaskList } from "./list.js";
import { TaskSheet } from "./task.js";

export { TASKS };

const NO_ACTOR = /^no Aerie actor for (.+)$/;
/** the layouts that draw so far; the switch shows once a second lands */
const LAYOUTS: readonly ViewLayout[] = ["list"];
const NO_TASKS: TaskRow[] = [];

/** the viewer's sign-in has no actor: say the one line that adds it */
function NoActor({ error }: { error: ApiError }) {
  const email = NO_ACTOR.exec(error.message)?.[1] ?? "<email>";
  return (
    <Empty title={`No Aerie actor for ${email}`} waits>
      Add one from the CLI: <code>aerie actor set &lt;id&gt; --email {email}</code>
    </Empty>
  );
}

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
  const rows = got.data?.rows ?? NO_TASKS;
  useEffect(() => {
    if (!got.data || got.loading) return;
    const was = held.current;
    held.current = new Map(got.data.rows.map((t) => [t.id, t.version]));
    if (!was) return;
    const moved = got.data.rows.filter((t) => was.get(t.id) !== t.version).map((t) => t.id);
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

  const group = ranked ? null : (view.group ?? GROUP);
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
  if (err?.status === 403 && NO_ACTOR.test(err.message)) return <NoActor error={err} />;
  const at = (t: TaskRow) => taskAt(t.id);

  let body: ReactNode;
  if (got.error && !got.data) body = <LoadFailed error={got.error} onRetry={got.retry} />;
  else if (!got.data) body = <Loading shape="rows" lines={8} />;
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
      {open && (
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
