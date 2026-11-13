/**
 * Aerie's List: the kit's `Rows`, a fold per group (artifact F2). Done starts shut: `Rows` draws every row,
 * and Done is most of the board. A row: title, the description's first sentence, then chips.
 */

import { Pill, type RowsColumn, type RowsLine, Tag } from "@wren/ui";
import { groupTasks } from "@wrenautomation/aerie/core";
import { useState } from "react";
import { PageRows } from "../../page-rows.js";
import { dayLabel } from "../work/bits.js";
import type { TaskRow } from "./data.js";
import { groupLabel, peopleOf, statusColor, who } from "./look.js";

const SHUT = ["status:Done"];

const COLUMNS: RowsColumn<TaskRow>[] = [
  {
    key: "status",
    label: "Status",
    icon: "selected",
    width: 170,
    cell: (t) => (
      <Pill color={statusColor(t.status)} className="whitespace-nowrap">
        {t.status}
      </Pill>
    ),
  },
  {
    key: "area",
    label: "Area",
    icon: "folder",
    width: 150,
    cell: (t) => <span className="text-[13.5px] wrap-anywhere text-(--ui-ink-2)">{t.area}</span>,
  },
  {
    key: "people",
    label: "People",
    icon: "user",
    width: 180,
    cell: (t) => (
      <span className="flex flex-wrap gap-1">
        {peopleOf(t).map((p) => (
          <Tag key={p.id} dot={p.holds} title={p.holds ? `${p.id} holds it now` : undefined}>
            {who(p.id)}
          </Tag>
        ))}
      </span>
    ),
  },
  {
    key: "priority",
    label: "Priority",
    icon: "gauge",
    width: 90,
    cell: (t) => (t.priority ? <span className="text-[13.5px]">{t.priority}</span> : null),
  },
  {
    key: "updated",
    label: "Updated",
    icon: "clock",
    width: 110,
    quiet: true,
    cell: (t) => dayLabel(t.updatedAt ?? t.createdAt),
  },
];

export function TaskList({
  tasks,
  group,
  open,
  onOpen,
  hrefOf,
  washed,
  onWashed,
}: {
  tasks: TaskRow[];
  /** a `FIELDS` key that groups; none: one run */
  group: string | null;
  open: string | null;
  onOpen: (t: TaskRow) => void;
  hrefOf: (t: TaskRow) => string;
  washed: ReadonlySet<string>;
  onWashed: () => void;
}) {
  // the group's field shows on its fold; the phone's one column is the next that says most
  const columns = COLUMNS.filter((c) => c.key !== group).map((c, i) =>
    i === 0 ? { ...c, phone: true } : c,
  );
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(SHUT));
  const lines: RowsLine<TaskRow>[] = [];
  let index = 0;
  const groups = group ? groupTasks(tasks, group) : [{ key: null, tasks }];
  const seen = new Set<string>();
  for (const g of groups) {
    const at = group ? `${group}:${g.key ?? ""}` : "";
    if (group)
      lines.push({
        kind: "group",
        key: at,
        label: groupLabel(group, g.key),
        color: group === "status" && g.key ? statusColor(g.key) : undefined,
      });
    for (const row of g.tasks) {
      // key = id (`open` matches it); a repeat in a second group (two labels) gets the group
      const key = seen.has(row.id) ? `${row.id}@${at}` : row.id;
      seen.add(row.id);
      lines.push({ kind: "row", key, index: index++, row });
    }
  }
  return (
    <PageRows<TaskRow>
      label="tasks"
      noun="task"
      columns={columns}
      name={{
        label: "Task",
        icon: "text",
        min: 280,
        title: (t) => t.title,
        href: hrefOf,
        sub: (t) => (
          <span className="flex flex-col gap-0.5">
            <span className="text-[12px] text-(--ui-ink-3) tabular-nums">{t.id}</span>
            {t.summary ? (
              <span className="text-[13.5px] leading-normal text-pretty wrap-anywhere text-(--ui-ink-2)">
                {t.summary}
              </span>
            ) : null}
          </span>
        ),
      }}
      lines={lines}
      open={{ id: open, onOpen: (t) => onOpen(t) }}
      rowState={(t) => ({ changed: washed.has(t.id) })}
      onSettled={onWashed}
      group={
        group
          ? {
              folded,
              toggle: (k) =>
                setFolded((s) => {
                  const next = new Set(s);
                  if (!next.delete(k)) next.add(k);
                  return next;
                }),
            }
          : undefined
      }
    />
  );
}
