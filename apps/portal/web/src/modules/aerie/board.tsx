/**
 * Aerie's Board (aerie D16 "Board"): the kit's `Board`, a lane per group of the List's (`groupTasks`), the
 * page's fold set shared with the List. Status seeds every lane in board order; other fields show the
 * values present. Writes on and a field with a `move` (aerie D17): each card's Move menu writes the field.
 */

import { Board, type BoardLane, type BoardMove, Icon, type IconName, Pill } from "@wren/ui";
import { fieldOf } from "@wrenautomation/aerie/core";
import { useMemo } from "react";
import type { TaskRow } from "./data.js";
import { foldKey } from "./list.js";
import { type Acts, areaColor, DONE, groupLabel, groupsOf, statusWord } from "./look.js";

/** a card (v116): id and area, title, the first sentence, then priority and who acts */
function Face({ t, group, acts }: { t: TaskRow; group: string; acts: Acts | null }) {
  return (
    <span className="grid gap-1.5">
      {/* the title first in the link's name; the id row draws above it. pr: the Move button sits top right */}
      <span className="text-[13.5px] leading-[1.35] font-semibold text-pretty wrap-anywhere text-(--ui-ink)">
        {t.title}
      </span>
      <span className="order-first flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pr-7">
        <span className="text-[12px] font-medium whitespace-nowrap text-(--ui-ink-3) tabular-nums">
          {t.id}
        </span>
        {group !== "area" ? (
          <Pill color={areaColor(t.area)} className="min-w-0 wrap-anywhere">
            {t.area}
          </Pill>
        ) : null}
      </span>
      {t.summary ? (
        <span className="text-[12.5px] leading-normal text-pretty wrap-anywhere text-(--ui-ink-2)">
          {t.summary}
        </span>
      ) : null}
      <Foot t={t} group={group} acts={acts} />
    </span>
  );
}

const PRIORITY_ICON: Record<string, { icon: IconName; color: string }> = {
  high: { icon: "arrowUp", color: "var(--ui-bad)" },
  medium: { icon: "equal", color: "var(--ui-warn)" },
  low: { icon: "arrowDown", color: "var(--ui-ink-3)" },
};

/** priority as an arrow, the status off a status board, who acts on the right */
function Foot({ t, group, acts }: { t: TaskRow; group: string; acts: Acts | null }) {
  const p = group !== "priority" && t.priority ? PRIORITY_ICON[t.priority] : undefined;
  const status = group !== "status";
  if (!p && !status && !acts) return null;
  return (
    <span className="flex min-h-5 flex-wrap items-center gap-2 text-[12px]">
      {p ? (
        <span title={`${t.priority} priority`} className="inline-flex" style={{ color: p.color }}>
          <Icon name={p.icon} size={14} className="[stroke-width:2.2]" />
          <span className="sr-only">{t.priority} priority</span>
        </span>
      ) : null}
      {status ? <span className="text-(--ui-ink-3)">{statusWord(t.status)}</span> : null}
      {acts ? (
        <span className="ml-auto">
          {acts === "You" ? (
            <Pill color="var(--ui-bad)">You</Pill>
          ) : (
            <span className="text-(--ui-ink-3)">{acts}</span>
          )}
        </span>
      ) : null}
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
  statuses: readonly string[],
): {
  lanes: BoardLane<TaskRow>[];
  values: Map<string, string | null>;
  more: { key: string; label: string }[];
} {
  const seen = new Set<string>();
  const values = new Map<string, string | null>();
  const groups = groupsOf(tasks, group, statuses, true);
  const keep = group === "status" && only?.length ? new Set(only) : null;
  // Done only when the status filter names it (v116 "Status is not Done"); Move still offers it
  const hideDone = group === "status" && !keep?.has(DONE);
  const kept = groups.filter(
    (g) => (g.tasks.length || !keep || keep.has(g.key ?? "")) && !(hideDone && g.key === DONE),
  );
  const more: { key: string; label: string }[] = [];
  if (hideDone && statuses.includes(DONE)) {
    const at = foldKey(group, DONE);
    values.set(at, DONE);
    more.push({ key: at, label: groupLabel(group, DONE) });
  }
  const lanes = kept.map((g) => {
    const at = foldKey(group, g.key);
    const label = groupLabel(group, g.key);
    values.set(at, g.key);
    return {
      key: at,
      label,
      empty: "No tasks",
      // key = id (`open` matches it); a repeat in a second lane (two labels) gets the lane
      cards: g.tasks.map((item) => {
        const key = seen.has(item.id) ? `${item.id}@${at}` : item.id;
        seen.add(item.id);
        return { key, id: item.id, item };
      }),
    };
  });
  return { lanes, values, more };
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
  statuses,
  actsOf,
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
  /** the board's status order: a lane each */
  statuses: readonly string[];
  /** who acts on a card (redesign D4) */
  actsOf: (t: TaskRow) => Acts | null;
  /** writes on: a move from one group value to another (null: the empty group) */
  move?:
    | {
        onMove: (t: TaskRow, from: string | null, to: string | null) => void;
        busy: (t: TaskRow) => boolean;
      }
    | undefined;
}) {
  const made = useMemo(
    () => (tasks ? lanesOf(tasks, group, only, statuses) : null),
    [tasks, group, only, statuses],
  );
  const field = fieldOf(group);
  const moves = useMemo<BoardMove<TaskRow> | undefined>(() => {
    if (!move || !made || !field?.move) return undefined;
    const raw = (k: string) => made.values.get(k) ?? null;
    return {
      label: field.label,
      onMove: (t, from, to) => move.onMove(t, raw(from), raw(to)),
      busy: move.busy,
      more: made.more,
    };
  }, [move, made, field]);
  return (
    <Board<TaskRow>
      label="tasks"
      lanes={made?.lanes ?? null}
      card={(t) => <Face t={t} group={group} acts={actsOf(t)} />}
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
