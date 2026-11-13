/**
 * The open task (aerie D16 "Side panel"): the kit's `DetailSheet`, mounted once while `?task=` names a
 * task; the body keys by id, so ↑ ↓ and links swap it with no entrance. The head draws at once from
 * the list row; the body reads the task whole (live). Picks write through `edit` once writes are on.
 */

import {
  cx,
  DetailSheet,
  Facts,
  Icon,
  LoadFailed,
  Pill,
  Skeleton,
  Tag,
  tipProps,
  useSeen,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { holdersOf, lineage, PRIORITIES, STATUSES } from "@wrenautomation/aerie/core";
import { type ReactNode, useEffect, useState } from "react";
import type { Load } from "../../load.js";
import { navigate } from "../../route.js";
import { Markdown, Section } from "../canon/parts.js";
import { dayLabel } from "../work/bits.js";
import {
  type Board,
  editTask,
  sayRefused,
  type TaskPick,
  type TaskRow,
  type TaskWhole,
  useTask,
} from "./data.js";
import { peopleOf, statusColor, who } from "./look.js";

type Whole = TaskWhole["task"];
type TaskEvent = TaskWhole["events"][number];
/** what the head needs: a list row has it, so does the task whole */
type Head = Pick<
  TaskRow,
  | "id"
  | "title"
  | "status"
  | "priority"
  | "area"
  | "milestone"
  | "type"
  | "place"
  | "assignees"
  | "createdAt"
  | "updatedAt"
  | "version"
>;

const NOT_FOUND = 404;

export interface TaskSheetProps {
  id: string;
  /** every task the page holds: the head, the parent and the children read from them */
  rows: readonly TaskRow[];
  board: Load<Board>;
  hrefOf: (id: string) => string;
  /** the shown order, for ↑ ↓ */
  order: readonly string[];
  onClose: () => void;
  /** a write landed: the page reads its rows again */
  onWrote: () => void;
}

export function TaskSheet(p: TaskSheetProps) {
  useWalk(p.id, p.order, p.hrefOf);
  return (
    <DetailSheet
      title={p.rows.find((r) => r.id === p.id)?.title ?? p.id}
      about="The task whole: its fields, checks, people and history."
      onClose={p.onClose}
    >
      <TaskBody key={p.id} {...p} />
    </DetailSheet>
  );
}

/** parts that use ↑ ↓ themselves */
const OWN_ARROWS =
  "input, textarea, select, [contenteditable=true], [data-pick], [role=listbox], [role=menu], [role=tablist], [role=radiogroup], [role=slider], [role=combobox]";

/**
 * ↑ ↓ open the task above or below in the page's order; a field or a pick keeps its keys.
 * Capture phase: the sheet stops the key's bubble.
 */
function useWalk(id: string, order: readonly string[], hrefOf: (id: string) => string) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest(OWN_ARROWS)) return;
      const at = order.indexOf(id);
      if (at < 0) return;
      const next = order[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      navigate(hrefOf(next), true);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [id, order, hrefOf]);
}

function TaskBody({ id, rows, board, hrefOf, onWrote }: TaskSheetProps) {
  const got = useTask(id);
  const row = rows.find((r) => r.id === id);
  const whole = got.data?.task;
  // the newer of the two: a push may reach the rows before this read answers
  const head: Head | undefined = whole && (!row || whole.version >= row.version) ? whole : row;
  const writes = board.data?.writes === true;
  const [wrote, setWrote] = useState(0);
  const [busy, setBusy] = useState(false);
  useSeen(
    "record",
    whole
      ? {
          label: `${whole.id} ${whole.title}`,
          icon: "board",
          text: `${whole.id}: ${whole.title}\n${whole.status}, ${whole.area}\n\n${whole.description ?? ""}`,
        }
      : null,
  );

  if (got.error?.status === NOT_FOUND && !whole) return <NotFound id={id} />;

  // expect the newest version seen: an edit's answer beats a read still on its way
  const expect = Math.max(head?.version ?? 0, wrote);
  const pick = async (edit: TaskPick) => {
    if (!head) return;
    setBusy(true);
    try {
      setWrote((await editTask(head.id, expect, edit)).version);
    } catch (err) {
      sayRefused(head.id, err);
    } finally {
      setBusy(false);
      got.retry();
      onWrote();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {head ? <TaskHead task={head} writes={writes} busy={busy} onPick={pick} /> : <HeadSkeleton />}
      {board.data && !writes && (
        <p className="m-0 -mt-3 flex items-start gap-1.5 text-[13px] leading-snug text-(--ui-ink-3)">
          <Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />
          Edits from the web open at the switch (setting web_writes)
        </p>
      )}
      {got.error && !whole ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data || !whole ? (
        <BodySkeleton />
      ) : (
        <TaskParts
          task={whole}
          events={got.data.events}
          rows={rows}
          grants={board.data?.grants ?? []}
          milestones={board.data?.milestones ?? []}
          hrefOf={hrefOf}
        />
      )}
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <h2 className="m-0 text-[18px] leading-snug font-semibold">No task {id}</h2>
      <p className="m-0 text-[14px] text-pretty text-(--ui-ink-2)">
        It was renamed or deleted. An archived task still opens here.
      </p>
    </div>
  );
}

const FOLDER: Record<string, string> = {
  drafts: "Draft",
  "archive/tasks": "Archived",
  "archive/drafts": "Archived draft",
};

function TaskHead({
  task,
  writes,
  busy,
  onPick,
}: {
  task: Head;
  writes: boolean;
  busy: boolean;
  onPick: (edit: TaskPick) => void;
}) {
  const people = peopleOf(task as TaskRow);
  const status = (
    <Pill color={statusColor(task.status)} className="whitespace-nowrap">
      {task.status}
    </Pill>
  );
  const priority = task.priority ? <Tag>{task.priority}</Tag> : null;
  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] text-(--ui-ink-3) tabular-nums">{task.id}</span>
        {writes ? (
          <OnePick
            label="Status"
            value={task.status}
            options={STATUSES.map((s) => ({ id: s, text: s }))}
            busy={busy}
            onPick={(s) => onPick({ status: s })}
          >
            {status}
          </OnePick>
        ) : (
          status
        )}
        {writes ? (
          <OnePick
            label="Priority"
            value={task.priority ?? ""}
            options={[
              ...PRIORITIES.map((s) => ({ id: s, text: s })),
              { id: "", text: "No priority" },
            ]}
            busy={busy}
            onPick={(s) => onPick({ priority: s || null })}
          >
            {priority ?? <Tag>No priority</Tag>}
          </OnePick>
        ) : (
          priority
        )}
        {FOLDER[task.place] && <Tag tone="warn">{FOLDER[task.place]}</Tag>}
      </span>
      <h2 className="m-0 text-[18px] leading-snug font-semibold text-pretty wrap-anywhere">
        {task.title}
      </h2>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
        <span className="inline-flex items-center gap-1">
          <Icon name="folder" className="size-3.5" />
          {task.area}
        </span>
        {task.type && <span>{task.type}</span>}
        <span>Updated {dayLabel(task.updatedAt ?? task.createdAt)}</span>
      </span>
      {people.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {people.map((x) => (
            <Tag key={x.id} dot={x.holds} title={x.holds ? `${x.id} holds it now` : undefined}>
              {who(x.id)}
            </Tag>
          ))}
        </span>
      )}
    </div>
  );
}

/** one value from a short list: the face opens it, a pick writes at once */
function OnePick({
  label,
  value,
  options,
  busy,
  onPick,
  children,
}: {
  label: string;
  value: string;
  options: { id: string; text: string }[];
  busy: boolean;
  onPick: (id: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const row =
    "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:font-semibold";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={busy}
        aria-label={`${label}: ${value || "none"}`}
        {...tipProps(`Change ${label.toLowerCase()}`)}
        className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 hover:opacity-80 disabled:cursor-default disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:pr-1"
      >
        {children}
        <Icon name="down" className="size-3.5 text-(--ui-ink-3)" />
      </PopoverTrigger>
      <PopoverContent data-pick aria-label={label} align="start" className="w-56 gap-0 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-current={o.id === value}
            className={row}
            onClick={() => {
              setOpen(false);
              if (o.id !== value) onPick(o.id);
            }}
          >
            <span className="flex-1">{o.text}</span>
            {o.id === value ? <Icon name="check" className="size-3.5 text-(--ui-ink-2)" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function HeadSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function BodySkeleton() {
  // the open body's shape: a label, then lines, per section
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Reading the task">
      {[3, 2, 2].map((lines, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder sections
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-28" />
          {Array.from({ length: lines }, (_, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines
            <Skeleton key={j} className={cx("h-4", j === lines - 1 ? "w-3/5" : "w-full")} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TaskParts({
  task,
  events,
  rows,
  grants,
  milestones,
  hrefOf,
}: {
  task: Whole;
  events: TaskEvent[];
  rows: readonly TaskRow[];
  grants: Board["grants"];
  milestones: Board["milestones"];
  hrefOf: (id: string) => string;
}) {
  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title;
  const children = rows.filter((r) => r.parentId === task.id);
  const holders = holdersOf(task);
  const roles = rolesOf(grants, [task.area, ...task.aliases]);
  const milestone = task.milestone
    ? (milestones.find((m) => m.id === task.milestone)?.title ?? task.milestone)
    : null;
  const facts = (
    [
      ["Milestone", milestone],
      ["Labels", task.labels.length ? task.labels.join(", ") : null],
      ["Also in", task.aliases.length ? task.aliases.join(", ") : null],
      [
        "Created",
        `${dayLabel(task.createdAt)}${task.createdBy ? ` by ${who(task.createdBy)}` : ""}`,
      ],
      ["Closed", task.closedAt ? dayLabel(task.closedAt) : null],
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => f[1] != null);
  return (
    <>
      {task.description?.trim() && (
        <Section title="Description">
          <Markdown text={task.description} />
        </Section>
      )}
      <Checks title="Acceptance criteria" checks={task.ac} />
      <Checks title="Definition of done" checks={task.dod} />
      {task.plan?.trim() && (
        <Section title="Plan">
          <Markdown text={task.plan} />
        </Section>
      )}
      {task.notes?.trim() && (
        <Section title="Notes">
          <Markdown text={task.notes} />
        </Section>
      )}
      {task.finalSummary?.trim() && (
        <Section title="Final summary">
          <Markdown text={task.finalSummary} />
        </Section>
      )}
      {(task.parentId || children.length > 0 || task.dependencies.length > 0) && (
        <Section title="Linked tasks">
          <Facts
            items={(
              [
                ["Parent", task.parentId ? [task.parentId] : []],
                ["Children", children.map((c) => c.id)],
                ["Waits on", task.dependencies],
              ] as [string, string[]][]
            )
              .filter(([, ids]) => ids.length)
              .map(([k, ids]) => [
                k,
                <TaskLinks key={k} ids={ids} titleOf={titleOf} hrefOf={hrefOf} />,
              ])}
          />
        </Section>
      )}
      <Section title="People">
        <Facts
          items={[
            ...roles.map(([role, list]): [string, ReactNode] => [role, list]),
            ["Held by", holders.length ? holders.join(", ") : "Nobody holds it now"],
          ]}
        />
      </Section>
      {facts.length > 0 && (
        <Section title="Fields">
          <Facts items={facts} />
        </Section>
      )}
      {task.comments.length > 0 && (
        <Section title={`Comments (${task.comments.length})`}>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {task.comments.map((c) => (
              <li key={`${c.created}-${c.author ?? ""}`} className="flex flex-col gap-1">
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  {c.author ? who(c.author) : "Someone"} · {dayLabel(c.created)}
                </span>
                <Markdown text={c.body} />
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="History">
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {[...events].reverse().map((e) => (
            <li key={e.seq} className="flex flex-col gap-0.5 text-[13.5px]">
              <span className="wrap-anywhere">
                <span className="font-medium">{who(e.by)}</span> {eventSays(e)}
                <span className="text-(--ui-ink-3)"> · {dayLabel(e.at)}</span>
              </span>
              {e.why && <span className="text-[13px] text-pretty text-(--ui-ink-2)">{e.why}</span>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

function TaskLinks({
  ids,
  titleOf,
  hrefOf,
}: {
  ids: string[];
  titleOf: (id: string) => string | undefined;
  hrefOf: (id: string) => string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {ids.map((id) => (
        <li key={id}>
          <a href={hrefOf(id)} className="wrap-anywhere">
            <code className="text-[12.5px]">{id}</code>
            {titleOf(id) ? ` ${titleOf(id)}` : ""}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Checks({ title, checks }: { title: string; checks: Whole["ac"] }) {
  if (!checks.length) return null;
  const done = checks.filter((c) => c.done).length;
  return (
    <Section title={`${title} (${done} of ${checks.length})`}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {checks.map((c, i) => (
          <li
            // checks have no id; the index is their Backlog.md number
            // biome-ignore lint/suspicious/noArrayIndexKey: the index is the check's number
            key={i}
            className="flex items-start gap-2 text-[14px] leading-snug"
          >
            <Icon
              name={c.done ? "selected" : "unchecked"}
              label={c.done ? "Done" : "Open"}
              className={cx(
                "mt-0.5 size-4 shrink-0",
                c.done ? "text-(--ui-good)" : "text-(--ui-ink-3)",
              )}
            />
            <span className={cx("text-pretty wrap-anywhere", c.done && "text-(--ui-ink-2)")}>
              {c.text}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const ROLE_WORD: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  doer: "Doer",
  watcher: "Watcher",
};

/** roles on the task's areas and every ancestor: role → "william on dev" lines */
function rolesOf(grants: Board["grants"], areas: string[]): [string, string][] {
  const up = new Set(areas.flatMap(lineage));
  const by = new Map<string, string[]>();
  for (const g of grants) {
    if (!up.has(g.area)) continue;
    const word = ROLE_WORD[g.role] ?? g.role;
    by.set(word, [...(by.get(word) ?? []), `${who(g.actor)} on ${g.area}`]);
  }
  return [...by].map(([role, list]) => [role, list.join(", ")]);
}

/** an edit's fields named: a short value shows, a long text field names itself */
const SHORT = new Set(["status", "priority", "area", "place", "milestone", "type", "parentId"]);
const FIELD_WORD: Record<string, string> = {
  parentId: "parent",
  ac: "acceptance criteria",
  dod: "definition of done",
  appendPlan: "plan",
  appendNotes: "notes",
  finalSummary: "final summary",
  appendFinalSummary: "final summary",
  clearFinalSummary: "final summary",
  addLabels: "labels",
  removeLabels: "labels",
  addDeps: "dependencies",
  clearDeps: "dependencies",
  addAliases: "areas",
  removeAliases: "areas",
};

function eventSays(e: TaskEvent): string {
  const body = (e.body ?? {}) as Record<string, unknown>;
  if (e.kind === "create") return "made it";
  if (e.kind === "import")
    return typeof body.place === "string" ? `imported it (${body.place})` : "imported it";
  if (e.kind !== "edit") return e.kind;
  const said = new Set<string>();
  for (const [k, v] of Object.entries(body)) {
    const word = FIELD_WORD[k] ?? k;
    if (SHORT.has(k)) said.add(v == null ? `cleared ${word}` : `set ${word} to ${String(v)}`);
    else said.add(`changed ${word}`);
  }
  return said.size ? [...said].join(", ") : "edited it";
}
