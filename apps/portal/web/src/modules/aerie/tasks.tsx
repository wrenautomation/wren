/**
 * Aerie › Tasks (aerie D16): the address holds the whole view (`viewOfAddress`); every task loads once and
 * filters here, so a filter change reads nothing. `q` asks the server's ranked search for ids.
 */

import { Empty, LoadFailed, Loading, useSeen } from "@wren/ui";
import { compare, matches, viewOfAddress } from "@wrenautomation/aerie/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "../../api.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { type TaskRow, useBoard, useRows, useSearch } from "./data.js";
import { TaskList } from "./list.js";

export const TASKS = "/aerie/tasks";
/** how the page lays out, not what it shows: kept when filters clear */
const LAYOUT = ["layout", "group", "sort"];
const layoutOf = (p: URLSearchParams) =>
  new URLSearchParams([...p].filter(([k]) => LAYOUT.includes(k)));
const NO_ACTOR = /^no Aerie actor for (.+)$/;

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
  const open = params.get("task");
  const [washed, setWashed] = useState<ReadonlySet<string>>(new Set());
  // id → version once the mount's first read settles; later reads wash what moved past it
  const held = useRef<Map<string, number> | null>(null);
  const rows = got.data?.rows;
  useEffect(() => {
    if (!rows || got.loading) return;
    const was = held.current;
    held.current = new Map(rows.map((t) => [t.id, t.version]));
    if (!was) return;
    const moved = rows.filter((t) => was.get(t.id) !== t.version).map((t) => t.id);
    if (moved.length) setWashed(new Set(moved));
  }, [rows, got.loading]);
  useSeen("list", { label: "Tasks", icon: "board", text: "Aerie tasks" });

  const shown = useMemo(() => {
    const ctx = { grants: board.data?.grants ?? [] };
    const kept = (got.data?.rows ?? []).filter((t) => matches(t, view.filter, ctx));
    // search ranks; while it reads or failed, the other filters still apply
    if (view.text && search.data) {
      const at = new Map(kept.map((t) => [t.id, t]));
      return search.data.flatMap((id) => at.get(id) ?? []);
    }
    return kept.sort(compare(view.sort));
  }, [got.data, board.data, view, search.data]);

  const err = got.error ?? board.error;
  if (err?.status === 403 && NO_ACTOR.test(err.message)) return <NoActor error={err} />;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={8} />;
  const at = (t: TaskRow) => href(TASKS, { task: t.id }, params);

  if (!got.data.rows.length)
    return (
      <Empty title="No tasks yet" waits>
        Tasks land here from <code>aerie import</code>, <code>backlog task create</code> or an
        agent.
      </Empty>
    );
  if (!shown.length)
    return view.text && search.data ? (
      <Empty action={<a href={href(TASKS, { q: null }, params)}>Clear search</a>}>
        No task mentions “{view.text}”.
      </Empty>
    ) : (
      <Empty action={<a href={href(TASKS, {}, layoutOf(params))}>Clear filters</a>}>
        No task matches these filters.
      </Empty>
    );

  return (
    <TaskList
      tasks={shown}
      group={view.text && search.data ? null : (view.group ?? "status")}
      open={open}
      onOpen={(t) => navigate(at(t))}
      hrefOf={at}
      washed={washed}
      onWashed={() => setWashed(new Set())}
    />
  );
}
