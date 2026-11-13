/**
 * Aerie's bar (aerie D16 "Bar"): the viewer's views as tabs, then Group, Sort, Filter and search.
 * Built from the kit's parts (`useFilterTools`, `PickList`, `ViewStrip`, `SaveViewPop`); every pick
 * writes the address through Aerie's codec. Counts run in the browser when an editor opens.
 */

import {
  type BarField,
  CHIP,
  CHIP_ON,
  Icon,
  type IconName,
  PickList,
  type PickListOption,
  POP,
  SaveViewPop,
  SearchField,
  type Segment,
  Segmented,
  tipProps,
  useFilterTools,
  ViewStrip,
  type ViewTab,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import {
  type AddressView,
  type AreaRole,
  areaCounts,
  type Filter,
  fieldOf,
  GROUP_KEYS,
  holdersOf,
  lineage,
  MARK,
  matches,
  PRIORITIES,
  type RoleGrant,
  SORT_FIELDS,
  type Sort,
  type SortField,
  STATUSES,
  type ViewLayout,
} from "@wrenautomation/aerie/core";
import { type ReactNode, useMemo, useState } from "react";
import type { Load } from "../../load.js";
import { navigate } from "../../route.js";
import { addressOf, GROUP, unfiltered, viewKey, withoutText } from "./address.js";
import { type Board, deleteView, type SavedView, saveView, type TaskRow } from "./data.js";
import { statusColor, who } from "./look.js";

const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const ROLES: readonly AreaRole[] = ["owner", "manager", "doer", "watcher"];
const LAYOUT_LABEL: Record<ViewLayout, string> = {
  list: "List",
  board: "Board",
  columns: "Columns",
};

/** what every editor reads: the rows, the screen, and where a pick goes */
interface Ctx {
  rows: TaskRow[];
  /** search ids, when `q` answered: counts run inside them */
  hits: ReadonlySet<string> | null;
  grants: RoleGrant[];
  view: AddressView;
  go: (next: AddressView) => void;
}

const withFilter = (c: Ctx, f: Filter) => c.go({ ...c.view, filter: f });
const without = (f: Filter, ...keys: (keyof Filter)[]) => {
  const out = { ...f };
  for (const k of keys) delete out[k];
  return out;
};
/** rows the screen would show under `f` */
const kept = (c: Ctx, f: Filter) =>
  c.rows.filter((t) => (!c.hits || c.hits.has(t.id)) && matches(t, f, { grants: c.grants }));
const tally = (ts: TaskRow[], values: (t: TaskRow) => string[]) => {
  const n: Record<string, number> = {};
  for (const t of ts) for (const v of values(t)) n[v] = (n[v] ?? 0) + 1;
  return n;
};
/** known values in their order, then the rows' others by name, then picks the rows lack */
function optionIds(
  known: readonly string[],
  rows: TaskRow[],
  values: (t: TaskRow) => string[],
  picked: readonly string[],
) {
  const seen = new Set(known);
  const rest = new Set<string>();
  for (const t of rows) for (const v of values(t)) if (!seen.has(v)) rest.add(v);
  for (const p of picked) if (!seen.has(p)) rest.add(p);
  return [...known, ...[...rest].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))];
}
/** a single choice from a `PickList` flip: the id just added, or none */
const pickOne = (on: string | undefined, next: string[]) => next.find((x) => x !== on) ?? null;

function NoValues({ label }: { label: string }) {
  return (
    <p className="px-3 py-3 text-[13px] text-(--ui-ink-2)">No task has a {label.toLowerCase()}.</p>
  );
}

function NotLoaded({ retry }: { retry: () => void }) {
  return (
    <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-(--ui-ink-2)">
      Did not load.
      <button
        type="button"
        onClick={retry}
        className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-(--ui-ink) underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </p>
  );
}

/** a row that switches one setting under a list (with sub-areas, open checks) */
function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 border-t border-(--ui-hair) bg-transparent px-3 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)"
    >
      <span
        className={cn(
          "flex size-4 flex-none items-center justify-center rounded-[4px] border border-(--ui-hair-strong)",
          on && "border-(--ui-accent) bg-(--ui-accent) text-(--ui-on-accent)",
        )}
      >
        {on ? <Icon name="check" className="size-3" /> : null}
      </span>
      {label}
    </button>
  );
}

type ManyKey = "status" | "priority" | "type" | "milestone" | "label";

interface ManyDef {
  key: ManyKey;
  label: string;
  icon: IconName;
  section: string;
  known: readonly string[];
  values: (t: TaskRow) => string[];
  face?: (id: string) => ReactNode;
  /** a task must have every pick (labels); else any of them */
  every?: boolean;
}

/** a list field's editor: its counts run here, so only while it is open */
function ManyEditor({ d, c }: { d: ManyDef; c: Ctx }) {
  const picked = c.view.filter[d.key] ?? [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: `picked` is the filter's, in `c`.
  const ids = useMemo(() => optionIds(d.known, c.rows, d.values, picked), [d, c]);
  const counts = useMemo(
    () => tally(kept(c, d.every ? c.view.filter : without(c.view.filter, d.key)), d.values),
    [c, d],
  );
  if (!ids.length) return <NoValues label={d.label} />;
  const options: PickListOption[] = ids.map((id) => ({ id, face: d.face?.(id) ?? id, text: id }));
  return (
    <PickList
      label={d.label}
      options={options}
      on={new Set(picked)}
      counts={counts}
      onChange={(next) =>
        withFilter(
          c,
          next.length ? { ...c.view.filter, [d.key]: next } : without(c.view.filter, d.key),
        )
      }
    />
  );
}

function manyField(d: ManyDef, c: Ctx): BarField {
  const picked = c.view.filter[d.key] ?? [];
  const op = d.every
    ? picked.length > 1
      ? "has all of"
      : "has"
    : picked.length > 1
      ? "is any of"
      : "is";
  const value = picked.join(", ");
  return {
    key: d.key,
    label: d.label,
    icon: d.icon,
    section: d.section,
    set: picked.length ? { op, value, say: `${d.label} ${op} ${value}` } : null,
    editor: <ManyEditor d={d} c={c} />,
    clear: () => withFilter(c, without(c.view.filter, d.key)),
  };
}

/** an area path: its parents dim, its own name in ink (one edge; depth by colour, not indent) */
function AreaFace({ path }: { path: string }) {
  const at = path.lastIndexOf("/");
  return (
    <span>
      {at >= 0 ? <span className="text-(--ui-ink-3)">{path.slice(0, at + 1)}</span> : null}
      {path.slice(at + 1)}
    </span>
  );
}

const homesOf = (t: TaskRow) => [t.area, ...t.aliases];

function AreaEditor({ c, known }: { c: Ctx; known: readonly string[] }) {
  const f = c.view.filter;
  const picked = f.area ?? [];
  const sub = f.subtree !== false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `picked` is the filter's, in `c`.
  const ids = useMemo(() => {
    const all = new Set<string>(known);
    for (const t of c.rows) for (const h of homesOf(t)) for (const a of lineage(h)) all.add(a);
    for (const p of picked) all.add(p);
    return [...all].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [known, c]);
  const counts = useMemo(() => {
    const base = kept(c, without(f, "area", "subtree"));
    return sub ? Object.fromEntries(areaCounts(base)) : tally(base, homesOf);
  }, [c, f, sub]);
  if (!ids.length) return <NoValues label="Area" />;
  return (
    <>
      <PickList
        label="Area"
        options={ids.map((id) => ({ id, face: <AreaFace path={id} />, text: id }))}
        on={new Set(picked)}
        counts={counts}
        onChange={(next) =>
          withFilter(
            c,
            next.length
              ? { ...without(f, "subtree"), area: next, ...(sub ? {} : { subtree: false }) }
              : without(f, "area", "subtree"),
          )
        }
      />
      <Toggle
        on={sub}
        label="With sub-areas"
        onChange={(on) => withFilter(c, on ? without(f, "subtree") : { ...f, subtree: false })}
      />
    </>
  );
}

/** Who + Role: tasks in areas where one actor holds a role (any role when none is picked) */
function WhoEditor({ c, board }: { c: Ctx; board: Board }) {
  const f = c.view.filter;
  const role = f.role;
  const ids = useMemo(() => {
    const all = new Set(board.actors.map((a) => a.id));
    for (const g of board.grants) all.add(g.actor);
    if (role) all.add(role.actor);
    return [...all].sort();
  }, [board, role]);
  const base = useMemo(() => kept(c, without(f, "role")), [c, f]);
  const counts = useMemo(() => {
    const ctx = { grants: c.grants };
    const roles = role?.roles;
    const n: Record<string, number> = {};
    for (const id of ids) {
      const r = { actor: id, ...(roles ? { roles } : {}) };
      n[id] = base.filter((t) => matches(t, { role: r }, ctx)).length;
    }
    return n;
  }, [ids, base, role, c.grants]);
  const roleCounts = useMemo(() => {
    if (!role) return undefined;
    const ctx = { grants: c.grants };
    return Object.fromEntries(
      ROLES.map((r) => [
        r,
        base.filter((t) => matches(t, { role: { actor: role.actor, roles: [r] } }, ctx)).length,
      ]),
    );
  }, [role, base, c.grants]);
  const name = (id: string) => board.actors.find((a) => a.id === id)?.name ?? who(id);
  if (!ids.length) return <NoValues label="Person" />;
  return (
    <>
      <PickList
        label="Person"
        options={ids.map((id) => ({ id, face: name(id), text: `${name(id)} ${id}` }))}
        on={new Set(role ? [role.actor] : [])}
        counts={counts}
        onChange={(next) => {
          const one = pickOne(role?.actor, next);
          withFilter(
            c,
            one
              ? { ...f, role: { actor: one, ...(role?.roles ? { roles: role.roles } : {}) } }
              : without(f, "role"),
          );
        }}
      />
      {role ? (
        <div className="border-t border-(--ui-hair)">
          <p className="px-3 pt-2 text-[12px] font-semibold text-(--ui-ink-3)">Role on the area</p>
          <PickList
            label="Role"
            options={ROLES.map((r) => ({ id: r, face: r, text: r }))}
            on={new Set(role.roles ?? [])}
            counts={roleCounts}
            onChange={(next) =>
              withFilter(c, {
                ...f,
                role: { actor: role.actor, ...(next.length ? { roles: next as AreaRole[] } : {}) },
              })
            }
          />
        </div>
      ) : null}
    </>
  );
}

type OneKey = "assignee" | "holder";

/** one person: an assignee, or the session that holds it */
function OneEditor({
  c,
  k,
  label,
  values,
}: {
  c: Ctx;
  k: OneKey;
  label: string;
  values: (t: TaskRow) => string[];
}) {
  const on = c.view.filter[k];
  const ids = useMemo(() => optionIds([], c.rows, values, on ? [on] : []), [c.rows, values, on]);
  const counts = useMemo(() => tally(kept(c, without(c.view.filter, k)), values), [c, k, values]);
  if (!ids.length) return <NoValues label={label} />;
  return (
    <PickList
      label={label}
      options={ids.map((id) => ({ id, face: who(id), text: id }))}
      on={new Set(on ? [on] : [])}
      counts={counts}
      onChange={(next) => {
        const one = pickOne(on, next);
        withFilter(c, one ? { ...c.view.filter, [k]: one } : without(c.view.filter, k));
      }}
    />
  );
}

const assigneesOf = (t: TaskRow) => t.assignees.filter((a) => !a.startsWith(MARK));

function fieldsOf(c: Ctx, board: Load<Board>): BarField[] {
  const f = c.view.filter;
  const b = board.data;
  const milestone = (id: string) => b?.milestones.find((m) => m.id === id)?.title;
  const many: ManyDef[] = [
    {
      key: "status",
      label: "Status",
      icon: "selected",
      section: "Task",
      known: STATUSES,
      values: (t) => [t.status],
      face: (id) => (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full bg-(--ui-ink-3)"
            style={statusColor(id) ? { background: statusColor(id) } : undefined}
          />
          {id}
        </span>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      icon: "gauge",
      section: "Task",
      known: PRIORITIES,
      values: (t) => (t.priority ? [t.priority] : []),
    },
    {
      key: "milestone",
      label: "Milestone",
      icon: "flag",
      section: "Task",
      known: b?.milestones.map((m) => m.id) ?? [],
      values: (t) => (t.milestone ? [t.milestone] : []),
      face: (id) => {
        const title = milestone(id);
        return title ? (
          <span>
            {title} <span className="text-(--ui-ink-3)">{id}</span>
          </span>
        ) : (
          id
        );
      },
    },
    {
      key: "label",
      label: "Label",
      icon: "tag",
      section: "Task",
      known: [],
      values: (t) => t.labels,
      every: true,
    },
    {
      key: "type",
      label: "Type",
      icon: "boxes",
      section: "Task",
      known: [],
      values: (t) => (t.type ? [t.type] : []),
    },
  ];
  const areas = f.area ?? [];
  const areaOp = f.subtree === false ? "is" : "in";
  const role = f.role;
  const roleWords = role
    ? `${who(role.actor)}${role.roles?.length ? ` as ${role.roles.join(", ")}` : ""}`
    : "";
  const fields: BarField[] = [
    ...many.map((d) => manyField(d, c)),
    {
      key: "open",
      label: "Open checks",
      icon: "check",
      section: "Task",
      set: f.openChecks
        ? { op: "", value: "has open checks", say: "Has an open AC or DoD item" }
        : null,
      editor: (
        <Toggle
          on={!!f.openChecks}
          label="An AC or DoD item is open"
          onChange={(on) =>
            withFilter(c, on ? { ...f, openChecks: true } : without(f, "openChecks"))
          }
        />
      ),
      clear: () => withFilter(c, without(f, "openChecks")),
    },
    {
      key: "area",
      label: "Area",
      icon: "folder",
      section: "Where",
      set: areas.length
        ? {
            op: areaOp,
            value: areas.join(", "),
            say: `Area ${areaOp} ${areas.join(", ")}${f.subtree === false ? " (not sub-areas)" : ", with sub-areas"}`,
          }
        : null,
      editor: <AreaEditor c={c} known={b?.areas.map((a) => a.path) ?? []} />,
      clear: () => withFilter(c, without(f, "area", "subtree")),
    },
    ...(f.parent
      ? [
          {
            key: "parent",
            label: "Parent",
            icon: "branch" as const,
            section: "Where",
            set: { op: "is", value: f.parent, say: `Sub-tasks of ${f.parent}` },
            editor: (
              <p className="px-3 py-3 text-[13px] text-(--ui-ink-2)">Sub-tasks of {f.parent}.</p>
            ),
            clear: () => withFilter(c, without(f, "parent")),
          },
        ]
      : []),
    {
      key: "who",
      label: "Role",
      icon: "people",
      section: "People",
      set: role ? { op: "is", value: roleWords, say: `Areas where ${roleWords}` } : null,
      editor: b ? <WhoEditor c={c} board={b} /> : <NotLoaded retry={board.retry} />,
      clear: () => withFilter(c, without(f, "role")),
    },
    {
      key: "assignee",
      label: "Assignee",
      icon: "user",
      section: "People",
      set: f.assignee
        ? { op: "is", value: who(f.assignee), say: `Assigned to ${f.assignee}` }
        : null,
      editor: <OneEditor c={c} k="assignee" label="Assignee" values={assigneesOf} />,
      clear: () => withFilter(c, without(f, "assignee")),
    },
    {
      key: "holder",
      label: "Held by",
      icon: "bot",
      section: "People",
      set: f.holder ? { op: "is", value: who(f.holder), say: `Held by ${f.holder}` } : null,
      editor: <OneEditor c={c} k="holder" label="Held by" values={holdersOf} />,
      clear: () => withFilter(c, without(f, "holder")),
    },
  ];
  return fields;
}

const sortLabel = (k: SortField) => fieldOf(k)?.label ?? k;
/** fields read newest or most first */
const DESC_FIRST: ReadonlySet<SortField> = new Set(["createdAt", "updatedAt"]);

/** Sort: board order, or one field; its own row again flips the direction */
function SortTool({ view, go }: { view: AddressView; go: (s: Sort[]) => void }) {
  const [open, setOpen] = useState(false);
  const on = view.sort[0];
  const row =
    "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:font-semibold";
  const pick = (next: Sort[]) => {
    go(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(CHIP, on && CHIP_ON)}
        {...tipProps(
          on
            ? `Sorted by ${sortLabel(on.field)}, ${on.dir === "asc" ? "ascending" : "descending"}`
            : "Board order",
        )}
      >
        <Icon name="sort" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>{on ? sortLabel(on.field) : "Sort"}</span>
        {on ? <Icon name={on.dir === "asc" ? "up" : "down"} className="size-3.5" /> : null}
      </PopoverTrigger>
      <PopoverContent aria-label="Sort" align="end" className={cn(POP, "w-56 p-1")}>
        <button type="button" aria-current={!on} className={row} onClick={() => pick([])}>
          <span className="flex-1">Board order</span>
        </button>
        {SORT_FIELDS.filter((k) => k !== "ordinal").map((k) => {
          const here = on?.field === k;
          return (
            <button
              key={k}
              type="button"
              aria-current={here}
              className={row}
              onClick={() =>
                pick([
                  {
                    field: k,
                    dir: here
                      ? on.dir === "asc"
                        ? "desc"
                        : "asc"
                      : DESC_FIRST.has(k)
                        ? "desc"
                        : "asc",
                  },
                ])
              }
            >
              <span className="flex-1">{sortLabel(k)}</span>
              {here ? (
                <Icon
                  name={on.dir === "asc" ? "up" : "down"}
                  className="size-3.5 text-(--ui-ink-2)"
                />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** Group: the field whose values fold the rows */
function GroupTool({ group, go }: { group: string; go: (g: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = (k: string) => fieldOf(k)?.label ?? k;
  const row =
    "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:font-semibold";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={CHIP} {...tipProps(`Grouped by ${label(group).toLowerCase()}`)}>
        <Icon name="rows" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>By {label(group).toLowerCase()}</span>
      </PopoverTrigger>
      <PopoverContent aria-label="Group by" align="start" className={cn(POP, "w-52 p-1")}>
        {GROUP_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-current={k === group}
            className={row}
            onClick={() => {
              go(k);
              setOpen(false);
            }}
          >
            <span className="flex-1">{label(k)}</span>
            {k === group ? <Icon name="check" className="size-3.5 text-(--ui-ink-2)" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** the open saved view's menu: delete it (rename = save under the new name) */
function ViewMenu({ view, onGone }: { view: SavedView; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setSaid(null);
      }}
    >
      <PopoverTrigger
        aria-label={`${view.name}: options`}
        {...tipProps("Options", { as: "none" })}
        className="inline-flex size-6 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
      >
        <Icon name="more" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        aria-label={`${view.name}: options`}
        align="start"
        className="w-52 gap-0 p-1.5"
      >
        <button
          type="button"
          disabled={busy}
          className="flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center border-0 bg-transparent px-1.5 text-left text-[13px] text-(--ui-bad) hover:bg-(--ui-hover) disabled:opacity-40"
          onClick={async () => {
            setBusy(true);
            try {
              await deleteView(view.name);
              setOpen(false);
              onGone();
            } catch (err) {
              setSaid(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete view
        </button>
        {said ? <p className="px-1.5 pt-1 text-[12px] text-(--ui-bad)">{said}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

const viewOfSaved = (v: SavedView): AddressView => ({
  filter: v.filter,
  sort: v.sort,
  layout: v.layout,
  ...(v.groupBy ? { group: v.groupBy } : {}),
});
const ALL: AddressView = { filter: {}, sort: [], layout: "list" };

/** a save over a stored view keeps what the address cannot say: its columns, its later sorts */
function savedOf(
  name: string,
  view: AddressView,
  stored: SavedView | undefined,
): Omit<SavedView, "id"> {
  const first = view.sort[0];
  const keepTail =
    !!first && stored?.sort[0]?.field === first.field && stored.sort[0]?.dir === first.dir;
  return {
    name,
    filter: view.filter,
    sort: keepTail && stored ? stored.sort : view.sort,
    layout: view.layout,
    ...(view.group ? { groupBy: view.group } : {}),
    ...(stored?.columns ? { columns: stored.columns } : {}),
  };
}

export function AerieBar({
  params,
  view,
  board,
  rows,
  hits,
  search,
  narrow,
  layouts,
}: {
  params: URLSearchParams;
  view: AddressView;
  board: Load<Board>;
  rows: TaskRow[];
  hits: ReadonlySet<string> | null;
  /** the search read: its ring and its failure */
  search: { loading: boolean; error: unknown; retry: () => void };
  narrow: boolean;
  /** the layouts that draw; the switch shows past one */
  layouts: readonly ViewLayout[];
}) {
  const grants = board.data?.grants;
  // one ctx per screen: an open editor's counts run again only when it changes
  const c = useMemo<Ctx>(
    () => ({
      rows,
      hits,
      grants: grants ?? [],
      view,
      go: (next) => navigate(addressOf(params, next), true),
    }),
    [rows, hits, grants, view, params],
  );
  const go = c.go;
  const fields = fieldsOf(c, board);
  const on = fields.filter((f) => f.set);
  const narrowed = on.length > 0 || !!view.text;
  const tools = useFilterTools({
    fields,
    narrow,
    search: { many: "tasks", ask: (text) => go({ ...view, text }) },
    say: on.map((f) => f.set?.say).join(" · ") || undefined,
    clearAll: () => go(unfiltered(view)),
  });

  const saved = board.data?.views ?? [];
  const now = viewKey(view);
  const openView = saved.find((v) => viewKey(viewOfSaved(v)) === now);
  const tabs: ViewTab[] = [
    {
      id: "all",
      label: "All tasks",
      href: addressOf(params, ALL),
      count: rows.filter((t) => t.place === "tasks").length,
      on: viewKey(ALL) === now,
    },
    ...saved.map((v) => ({
      id: `sv:${v.id}`,
      label: v.name,
      href: addressOf(params, viewOfSaved(v)),
      on: v === openView,
      saved: true,
    })),
  ];
  const menu = openView ? <ViewMenu view={openView} onGone={() => board.retry()} /> : null;
  const differs = !tabs.some((t) => t.on);
  const save =
    board.data && differs ? (
      <SaveViewPop<SavedView>
        record="aerie:tasks"
        share={false}
        names={saved.map((v) => v.name)}
        save={(v) => {
          const name = v.name ?? "";
          return saveView(
            savedOf(
              name,
              view,
              saved.find((s) => s.name === name),
            ),
          );
        }}
        onSaved={() => board.retry()}
      />
    ) : null;

  const group = view.group ?? GROUP;
  const shape = (
    <div className="flex flex-none items-center gap-0.5">
      {layouts.length > 1 ? (
        <Segmented
          label="Layout"
          items={layouts.map(
            (l): Segment => ({
              id: l,
              label: LAYOUT_LABEL[l],
              href: addressOf(params, { ...view, layout: l }),
              on: view.layout === l,
            }),
          )}
        />
      ) : null}
      <GroupTool group={group} go={(g) => go({ ...view, group: g })} />
      <SortTool view={view} go={(sort) => go({ ...view, sort })} />
    </div>
  );
  const clear = narrowed ? (
    <a href={addressOf(params, unfiltered(view))} className={CHIP}>
      Clear
    </a>
  ) : null;
  const searchBox = (
    <SearchField
      asked={view.text ?? ""}
      ask={(text) => go(text ? { ...view, text } : withoutText(view))}
      label="tasks"
      busy={search.loading}
      failed={view.text && search.error ? { retry: search.retry } : undefined}
    />
  );
  const strip = (
    <ViewStrip tabs={tabs} more={[]} menu={menu} row="views:aerie-tasks" narrow={narrow} />
  );

  if (!narrow)
    return (
      <div className="grid gap-2">
        {strip}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {shape}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
            {tools.pills()}
            {clear}
            {tools.tool}
            {searchBox}
            {save}
          </div>
        </div>
      </div>
    );
  return (
    <div className="grid gap-2">
      {strip}
      <div className="flex min-w-0 items-center gap-2">
        {shape}
        <div className="ml-auto flex min-w-0 items-center gap-0.5 [&_[data-hp]]:sr-only">
          {clear}
          {tools.tool}
          {searchBox}
          {save}
        </div>
      </div>
      {on.length ? <div className="flex flex-wrap gap-0.5">{tools.pills()}</div> : null}
      {tools.sheet}
    </div>
  );
}
