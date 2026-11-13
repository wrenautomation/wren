/**
 * Aerie's Board (aerie D16 "Board"): the kit's `Board`, a lane per group of the List's (`groupTasks`), the
 * page's fold set shared with the List. Status seeds every lane in board order; other fields show the
 * values present. Writes on and a field with a `move` (aerie D17): each card's Move menu writes the field.
 */

import { Board, type BoardLane, type BoardMove, Icon, Pill } from "@wren/ui";
import { fieldOf, groupTasks } from "@wrenautomation/aerie/core";
import { useMemo } from "react";
import type { TaskRow } from "./data.js";
import { foldKey, People } from "./list.js";
import { groupLabel, statusColor } from "./look.js";

/** a card: title, id, the first sentence, then chips; the lane's own field is left out */
function Face({ t, group }: { t: TaskRow; group: string }) {
  return (
    <span className="grid gap-1">
      <span className="text-[14px] leading-snug font-semibold text-pretty wrap-anywhere">
        {t.title}
      </span>
      <span className="text-[12px] text-(--ui-ink-3) tabular-nums">{t.id}</span>
      {t.summary ? (
        <span className="text-[13px] leading-normal text-pretty wrap-anywhere text-(--ui-ink-2)">
          {t.summary}
        </span>
      ) : null}
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-(--ui-ink-3)">
        {group !== "status" ? (
          <Pill color={statusColor(t.status)} className="whitespace-nowrap">
            {t.status}
          </Pill>
        ) : null}
        {group !== "area" ? (
          <span className="inline-flex min-w-0 items-center gap-1 wrap-anywhere">
            <Icon name="folder" size={13} className="flex-none" />
            {t.area}
          </span>
        ) : null}
        {group !== "priority" && t.priority ? <span>{t.priority}</span> : null}
        <People task={t} />
      </span>
    </span>
  );
}

/**
 * `only`: the status filter; on a status board an empty lane it leaves out does not draw. `values`: each
 * lane's key → the field's raw value (null: the empty lane), for a move.
 */
function lanesOf(
  tasks: TaskRow[],
  group: string,
  only: readonly string[] | undefined,
): { lanes: BoardLane<TaskRow>[]; values: Map<string, string | null> } {
  const seen = new Set<string>();
  const values = new Map<string, string | null>();
  const groups = groupTasks(tasks, group, { all: true });
  const keep = group === "status" && only?.length ? new Set(only) : null;
  const kept = groups.filter((g) => g.tasks.length || !keep || keep.has(g.key ?? ""));
  const lanes = kept.map((g) => {
    const at = foldKey(group, g.key);
    const label = groupLabel(group, g.key);
    values.set(at, g.key);
    return {
      key: at,
      label,
      color: group === "status" && g.key ? statusColor(g.key) : undefined,
      empty: "No tasks",
      // key = id (`open` matches it); a repeat in a second lane (two labels) gets the lane
      cards: g.tasks.map((item) => {
        const key = seen.has(item.id) ? `${item.id}@${at}` : item.id;
        seen.add(item.id);
        return { key, id: item.id, item };
      }),
    };
  });
  return { lanes, values };
}

export function TaskBoard({
  tasks,
  group,
  open,
  onOpen,
  hrefOf,
  washed,
  onWashed,
  folded,
  onFold,
  narrow,
  only,
  move,
}: {
  /** null: loading */
  tasks: TaskRow[] | null;
  group: string;
  open: string | null;
  onOpen: (t: TaskRow) => void;
  hrefOf: (t: TaskRow) => string;
  washed: ReadonlySet<string>;
  onWashed: () => void;
  folded: ReadonlySet<string>;
  onFold: (key: string) => void;
  narrow: boolean;
  only?: readonly string[] | undefined;
  /** writes on: a move from one group value to another (null: the empty group) */
  move?:
    | {
        onMove: (t: TaskRow, from: string | null, to: string | null) => void;
        busy: (t: TaskRow) => boolean;
      }
    | undefined;
}) {
  const made = useMemo(() => (tasks ? lanesOf(tasks, group, only) : null), [tasks, group, only]);
  const field = fieldOf(group);
  const moves = useMemo<BoardMove<TaskRow> | undefined>(() => {
    if (!move || !made || !field?.move) return undefined;
    const raw = (k: string) => made.values.get(k) ?? null;
    return {
      label: field.label,
      onMove: (t, from, to) => move.onMove(t, raw(from), raw(to)),
      busy: move.busy,
    };
  }, [move, made, field]);
  return (
    <Board<TaskRow>
      label="tasks"
      lanes={made?.lanes ?? null}
      card={(t) => <Face t={t} group={group} />}
      href={hrefOf}
      open={{ id: open, onOpen }}
      shut={folded}
      onShut={onFold}
      changed={(t) => washed.has(t.id)}
      onSettled={onWashed}
      narrow={narrow}
      move={moves}
    />
  );
}
