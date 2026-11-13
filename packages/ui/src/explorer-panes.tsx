/**
 * Explorer's panes: Columns, List and Gallery when wide, one pane when narrow, and Find's results
 * (designs/2026-11-12-explorer.md, "The part").
 */
import {
  type Column,
  homeOf,
  type Item,
  isFolder,
  type Page,
  parentOf,
  type Shown,
  type Whole,
} from "@wren/core/paths";
import { type Fold, type FoldNode, openSet, toggle } from "@wrenautomation/orrery";
import { cn } from "cn";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./controls.js";
import { useLoad } from "./data/query.js";
import {
  AliasMark,
  aliased,
  type Ctx,
  follow,
  iconOf,
  lastOf,
  MarkOf,
  PathFailed,
  Preview,
  quietMark,
  Row,
  Rows,
  rowsOf,
  ShowMore,
  Slow,
  within,
} from "./explorer-rows.js";
import { LoadFailed } from "./feedback.js";
import { FoldChevron } from "./folders.js";
import { num } from "./format.js";
import { Icon } from "./icons.js";
import { Img } from "./image.js";

// --- wide: columns -----------------------------------------------------------------------------

interface PaneProps {
  ctx: Ctx;
  cols: Column[];
  whole: Whole | undefined;
  /** the adapter's page beside a folder */
  aside: ReactNode;
  dim: boolean;
  error: Shown["error"];
  waiting: boolean;
  route: string;
  onRetry: () => void;
}

/** The preview's place at the right of a wide frame: an item whole, or a folder's page. */
function PreviewSide({
  ctx,
  cols,
  whole,
  aside,
  dim,
  route,
  width,
}: PaneProps & { width?: string }) {
  if (!whole && !aside) return null;
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 overflow-y-auto border-l border-(--ui-hair) p-5",
        width ?? "flex-1",
      )}
    >
      {whole ? (
        <Preview ctx={ctx} whole={whole} step={cols.at(-1)} route={route} dim={dim} />
      ) : (
        <div className="transition-opacity duration-150 starting:opacity-0">{aside}</div>
      )}
    </div>
  );
}

export function WideColumns(props: PaneProps & { first: boolean }) {
  const { ctx, cols, whole, aside, error, waiting, first, route, onRetry } = props;
  const side = !!whole || !!aside;
  const strip = useRef<HTMLDivElement>(null);
  // the column a → opened: its first row takes focus once it reads
  const focusNext = useRef<{ into: string } | null>(null);
  // a column with no rows under an item that has a body draws nothing: the preview speaks
  const shownCols = cols.filter((c, n) => c.items.length || n < cols.length - 1 || !whole);

  // the last column stays in view: a new column, or the skeleton going
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the strip grows or settles
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: el.scrollWidth, behavior: still ? "auto" : "smooth" });
  }, [shownCols.length, waiting]);
  useEffect(() => {
    const f = focusNext.current;
    const el = strip.current;
    if (!f || !el) return;
    const to = el.querySelector<HTMLElement>(`[data-col="${CSS.escape(f.into)}"] a[data-row]`);
    if (to) {
      to.focus();
      focusNext.current = null;
    }
  });

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-row]");
    const col = a?.closest<HTMLElement>("[data-col]");
    if (!a || !col) return;
    const rows = [...col.querySelectorAll<HTMLAnchorElement>("a[data-row]")];
    const n = rows.indexOf(a);
    const path = a.dataset.path ?? "";
    const colRoute = col.dataset.col ?? "";
    const el = strip.current;
    if (e.key === "ArrowDown") rows[n + 1]?.focus();
    else if (e.key === "ArrowUp") rows[n - 1]?.focus();
    else if (e.key === "ArrowRight" && a.dataset.leaf === undefined) {
      // an open column takes focus now; a new one once it reads
      const open = el?.querySelector<HTMLElement>(`[data-col="${CSS.escape(path)}"] a[data-row]`);
      if (open) open.focus();
      else focusNext.current = { into: path };
      ctx.go(path);
    } else if (e.key === "ArrowLeft" && parentOf(colRoute)) {
      // the column's own row is on screen already, one column left
      el?.querySelector<HTMLElement>(`a[data-row][data-path="${CSS.escape(colRoute)}"]`)?.focus();
      ctx.go(colRoute);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrows move between the rows, each a link */}
      <div
        ref={strip}
        onKeyDown={onKeys}
        className={cn(
          "flex min-h-0 overflow-x-auto overscroll-x-contain",
          // whole columns only, never a sliver; the preview's own hairline ends the last one
          side
            ? "max-w-[round(down,calc(100%_-_22rem),240px)] flex-none [&>:last-child]:border-r-0"
            : "flex-1",
        )}
      >
        {first
          ? [0, 1, 2].map((n) => (
              <div key={n} className="w-[240px] flex-none border-r border-(--ui-hair)">
                <Slow on what="this place" />
              </div>
            ))
          : shownCols.map((c) => (
              <section
                key={c.route}
                data-col={c.route}
                aria-label={c.item.name}
                className="flex w-[240px] flex-none flex-col overflow-y-auto border-r border-(--ui-hair) p-1.5 transition-[opacity,translate] duration-150 ease-out starting:-translate-x-2 starting:opacity-0"
              >
                <Rows ctx={ctx} c={c} route={route} />
              </section>
            ))}
        {waiting && !first ? (
          <div className="w-[240px] flex-none border-r border-(--ui-hair)">
            <Slow on what={lastOf(route)} />
          </div>
        ) : null}
        {error ? (
          <div className="w-[280px] flex-none border-r border-(--ui-hair) transition-opacity duration-150 starting:opacity-0">
            <PathFailed ctx={ctx} error={error} onRetry={onRetry} />
          </div>
        ) : null}
      </div>
      <PreviewSide {...props} />
    </>
  );
}

// --- wide: list --------------------------------------------------------------------------------

/** The deepest folder on the route: List draws the tree under it, the breadcrumb the rest. */
const baseOf = (cols: Column[]) => [...cols].reverse().find((c) => isFolder(c.item)) ?? cols[0];

/** Fold nodes for these routes and each one's parents, up to `base`. */
function nodesFor(ids: Iterable<string>, base: string): FoldNode[] {
  const out = new Map<string, FoldNode>();
  for (const id of ids)
    for (let r = id; r !== base && within(base, r) && !out.has(r); r = parentOf(r)) {
      const up = parentOf(r);
      out.set(r, { id: r, label: lastOf(r), ...(up !== base ? { parent: up } : {}) });
    }
  return [...out.values()];
}

interface TreeCtx extends Ctx {
  open: ReadonlySet<string>;
  setOpen: (path: string, on: boolean) => void;
  /** rows already read by the columns answer, by route */
  known: ReadonlyMap<string, Column>;
  route: string;
}

function Tree({ ctx, cols, route }: { ctx: Ctx; cols: Column[]; route: string }) {
  const base = baseOf(cols);
  const baseRoute = base?.route ?? route;
  const [fold, setFold] = useState<Fold>(() =>
    toggle(nodesFor([route], baseRoute), { depth: 0, open: {} }, route, true),
  );
  // a new route opens its way down
  useEffect(() => {
    setFold((f) => {
      const nodes = nodesFor([...Object.keys(f.open), route], baseRoute);
      return nodes.some((n) => n.id === route) ? toggle(nodes, f, route, true) : f;
    });
  }, [route, baseRoute]);
  const nodes = useMemo(() => nodesFor(Object.keys(fold.open), baseRoute), [fold, baseRoute]);
  const open = useMemo(() => openSet(nodes, fold), [nodes, fold]);
  const tree = useRef<HTMLDivElement>(null);
  const t: TreeCtx = {
    ...ctx,
    open,
    route,
    known: new Map(cols.map((c) => [c.route, c])),
    setOpen: (path, on) =>
      setFold((f) => toggle(nodesFor([...Object.keys(f.open), path], baseRoute), f, path, on)),
  };

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = tree.current;
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-row]");
    if (!el || !a) return;
    const rows = [...el.querySelectorAll<HTMLAnchorElement>("a[data-row]")].filter(
      (r) => !r.closest("[inert]"),
    );
    const n = rows.indexOf(a);
    const path = a.dataset.path ?? "";
    const foldable = a.dataset.foldable !== undefined;
    if (e.key === "ArrowDown") rows[n + 1]?.focus();
    else if (e.key === "ArrowUp") rows[n - 1]?.focus();
    else if (e.key === "ArrowRight" && foldable) {
      if (!open.has(path)) t.setOpen(path, true);
      else rows.find((r) => r.dataset.parent === path)?.focus();
    } else if (e.key === "ArrowLeft") {
      if (foldable && open.has(path)) t.setOpen(path, false);
      else rows.find((r) => r.dataset.path === a.dataset.parent)?.focus();
    } else return;
    e.preventDefault();
  };

  if (!base) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrows move and fold the rows, each a link
    <div ref={tree} onKeyDown={onKeys} className="p-1.5">
      <TreeLevel t={t} c={base} level={0} />
    </div>
  );
}

// every level's text starts on one edge: chevron (28) + icon (15) + gap (8); markers hang left of it
const TEXT_EDGE = "pl-[51px]";

function TreeLevel({ t, c, level }: { t: TreeCtx; c: Column; level: number }) {
  const r = rowsOf(t, c);
  if (!r.items.length)
    return (
      <p className={cn("m-0 py-1.5 text-[12.5px] text-(--ui-ink-3)", TEXT_EDGE)}>
        {c.item.name} holds nothing yet.
      </p>
    );
  return (
    <>
      <ul className="m-0 grid list-none gap-px p-0">
        {r.items.map((i) => (
          <TreeNode
            key={i.path}
            t={t}
            i={i}
            level={level}
            parent={c.route}
            alias={aliased(i, c.home)}
          />
        ))}
      </ul>
      <div className="pl-[43px]">
        <ShowMore ctx={t} route={c.route} next={r.next} />
      </div>
    </>
  );
}

function TreeNode({
  t,
  i,
  level,
  parent,
  alias,
}: {
  t: TreeCtx;
  i: Item;
  level: number;
  parent: string;
  alias: boolean;
}) {
  // relation folders never open in the tree: their row goes there
  const foldable = !i.leaf && i.kind !== "relation";
  const isOpen = foldable && t.open.has(i.path);
  const [seen, setSeen] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setSeen(true);
  }, [isOpen]);
  const mark = i.mark ? t.p.marks?.[i.mark] : undefined;
  const current = i.path === t.route;
  return (
    <li className="grid">
      <div
        className={cn(
          // no indent (ST-14, ST-15): depth reads by weight and color; the open chevrons and the
          // breadcrumb carry the way down, so only the current row is filled
          "flex items-start rounded-[8px] transition-[background-color] duration-150 hover:bg-(--ui-fill)",
          current && "bg-(--ui-accent-tint) hover:bg-(--ui-accent-tint)",
        )}
      >
        {foldable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Close" : "Open"} ${i.name}`}
            onClick={() => t.setOpen(i.path, !isOpen)}
            className="grid size-7 flex-none cursor-pointer place-items-center rounded-[8px] border-0 bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink)"
          >
            <FoldChevron open={isOpen} />
          </button>
        ) : (
          <span className="size-7 flex-none" />
        )}
        <a
          data-row=""
          data-path={i.path}
          data-parent={level ? parent : undefined}
          data-foldable={foldable ? "" : undefined}
          href={t.p.hrefFor(i.path, t.p.view)}
          onClick={follow(() => t.go(i.path))}
          aria-current={current ? "page" : undefined}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-[8px] py-1.5 pr-2 text-(--ui-ink) no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-focus)"
        >
          <Icon name={iconOf(i.kind)} size={15} className="mt-[2px] flex-none text-(--ui-ink-3)" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              dir="auto"
              className={cn(
                "text-[13.5px]/[1.4] wrap-anywhere",
                level === 0 ? "font-semibold" : level === 1 ? "font-normal" : "text-(--ui-ink-2)",
              )}
            >
              {i.name}
              {alias ? <AliasMark /> : null}
              {quietMark(mark)}
            </span>
            {mark ? <MarkOf mark={mark} /> : null}
            {i.sub ? (
              <span dir="auto" className="text-[12px]/[1.4] text-(--ui-ink-3) wrap-anywhere">
                {i.sub}
              </span>
            ) : null}
          </span>
          {i.count != null ? (
            <span className="mt-[3px] flex-none text-[11.5px] text-(--ui-ink-3) tabular-nums">
              {num(i.count)}
            </span>
          ) : null}
        </a>
      </div>
      {foldable && (seen || isOpen) ? (
        <div
          inert={!isOpen}
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-(--ui-ease) starting:grid-rows-[0fr]",
            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <TreeKids t={t} i={i} level={level + 1} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The rows under an open node: from the columns answer when it has them, else read. */
function TreeKids({ t, i, level }: { t: TreeCtx; i: Item; level: number }) {
  const known = t.known.get(i.path);
  const got = useLoad<Page>(
    known ? null : `paths:children:${i.path}`,
    () => t.p.read.children(i.path),
    t.p.scope,
  );
  const c: Column | null = known
    ? known
    : got.data
      ? {
          route: i.path,
          home: homeOf(i),
          item: i,
          items: got.data.items,
          ...(got.data.next ? { next: got.data.next } : {}),
        }
      : null;
  if (c) return <TreeLevel t={t} c={c} level={level} />;
  if (got.error)
    return (
      <p className={cn("m-0 py-1.5 text-[12.5px] text-(--ui-ink-3)", TEXT_EDGE)}>
        Couldn't read {i.name}.{" "}
        <button
          type="button"
          onClick={got.retry}
          className="cursor-pointer border-0 bg-transparent p-0 text-(--ui-link) underline"
        >
          Try again
        </button>
      </p>
    );
  return (
    <div className="pl-[39px]">
      <Slow on what={i.name} />
    </div>
  );
}

export function WideList(props: PaneProps) {
  const { ctx, cols, whole, aside, error, waiting, route, onRetry } = props;
  return (
    <>
      <div
        className={cn(
          "min-h-0 overflow-y-auto",
          whole || aside ? "w-[min(24rem,45%)] flex-none" : "min-w-0 flex-1",
        )}
      >
        {cols.length ? <Tree ctx={ctx} cols={cols} route={route} /> : <Slow on what="this place" />}
        {waiting && cols.length ? <Slow on what={lastOf(route)} /> : null}
        {error ? <PathFailed ctx={ctx} error={error} onRetry={onRetry} /> : null}
      </div>
      <PreviewSide {...props} />
    </>
  );
}

// --- wide: gallery -----------------------------------------------------------------------------

/** The level a gallery shows: the open item's rows, or its siblings when it holds only links. */
const galleryLevel = (cols: Column[], whole: Whole | undefined) => {
  const last = cols.at(-1);
  const own =
    last && (isFolder(last.item) || !whole || last.items.some((i) => i.kind !== "relation"));
  return own ? last : cols.at(-2);
};

function DefaultTile({ i }: { i: Item }) {
  return (
    // the hairline keeps a tile with no poster from melting into the page
    <span className="relative block aspect-[4/5] overflow-hidden bg-(--ui-band) shadow-[inset_0_0_0_1px_var(--ui-hair)] [border-radius:4px_10px_4px_10px]">
      {i.poster ? (
        <Img src={i.poster} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-(--ui-ink-3)">
          <Icon name={iconOf(i.kind)} size={24} />
        </span>
      )}
    </span>
  );
}

function Tiles({ ctx, c, route }: { ctx: Ctx; c: Column; route: string }) {
  const r = rowsOf(ctx, c);
  if (!r.items.length)
    return (
      <p className="m-0 p-4 text-[13px] text-(--ui-ink-3) wrap-anywhere">
        {c.item.name} holds nothing yet.
      </p>
    );
  return (
    <div className="flex flex-col gap-2 p-3">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-0">
        {r.items.map((i) => {
          const current = within(i.path, route);
          return (
            <li key={i.path} className="min-w-0 transition-opacity duration-150 starting:opacity-0">
              <a
                data-row=""
                data-path={i.path}
                href={ctx.p.hrefFor(i.path, ctx.p.view)}
                onClick={follow(() => ctx.go(i.path))}
                aria-current={i.path === route ? "page" : current ? "true" : undefined}
                className={cn(
                  "flex h-full flex-col gap-1.5 rounded-[12px] p-1.5 text-(--ui-ink) no-underline transition-[background-color,outline-color] duration-150 hover:bg-(--ui-fill) focus-visible:outline-2 focus-visible:outline-(--ui-focus)",
                  current && "bg-(--ui-accent-tint) outline-2 outline-(--ui-active)",
                )}
              >
                {ctx.p.tile ? ctx.p.tile(i) : <DefaultTile i={i} />}
                <span dir="auto" className="text-[13px]/[1.35] font-medium wrap-anywhere">
                  {i.name}
                  {aliased(i, c.home) ? <AliasMark /> : null}
                </span>
                {i.sub ? (
                  <span dir="auto" className="text-[12px]/[1.35] text-(--ui-ink-3) wrap-anywhere">
                    {i.sub}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
      <ShowMore ctx={ctx} route={c.route} next={r.next} />
    </div>
  );
}

export function WideGallery(props: PaneProps) {
  const { ctx, cols, whole, error, waiting, route, onRetry } = props;
  const level = galleryLevel(cols, whole);
  return (
    <>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {level ? <Tiles ctx={ctx} c={level} route={route} /> : <Slow on what="this place" />}
        {waiting && level ? <Slow on what={lastOf(route)} /> : null}
        {error ? <PathFailed ctx={ctx} error={error} onRetry={onRetry} /> : null}
      </div>
      <PreviewSide {...props} width="w-[min(30rem,50%)] flex-none" />
    </>
  );
}

// --- narrow ------------------------------------------------------------------------------------

/** One pane: Back with the parent's name, then the folder's rows, or the preview and its rows. */
export function Narrow({
  ctx,
  cols,
  whole,
  aside,
  error,
  waiting,
  deeper,
  route,
  onRetry,
}: Omit<PaneProps, "dim"> & { deeper: boolean }) {
  const last = cols.at(-1);
  const at = last?.route === route ? last : undefined;
  const up = at ? cols.at(-2) : last;
  const view = ctx.p.view;
  const listing = (c: Column) =>
    view === "list" ? (
      <Tree ctx={ctx} cols={cols} route={route} />
    ) : view === "gallery" ? (
      <Tiles ctx={ctx} c={c} route={route} />
    ) : (
      <Rows ctx={ctx} c={c} route={route} />
    );
  return (
    <div
      key={route}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-3 transition-[opacity,translate] duration-150 ease-out starting:opacity-0",
        deeper ? "starting:translate-x-2" : "starting:-translate-x-2",
      )}
    >
      {up ? (
        <a
          href={ctx.p.hrefFor(up.route, view)}
          onClick={follow(() => ctx.go(up.route))}
          className="flex min-h-11 items-center gap-1.5 self-start pr-2 text-[14px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
        >
          <Icon name="left" size={16} className="flex-none" />
          <span className="wrap-anywhere">
            {up.route === cols[0]?.route ? ctx.p.name : up.item.name}
          </span>
        </a>
      ) : null}
      {error ? (
        <PathFailed ctx={ctx} error={error} onRetry={onRetry} />
      ) : !at || waiting ? (
        <Slow on what={lastOf(route)} />
      ) : whole ? (
        <>
          <Preview ctx={ctx} whole={whole} step={at} route={route} dim={false} />
          <ItemRows ctx={ctx} at={at} whole={whole} route={route} />
        </>
      ) : (
        <>
          {listing(at)}
          {aside ? <div className="border-t border-(--ui-hair) pt-5">{aside}</div> : null}
        </>
      )}
    </div>
  );
}

/** An item's rows under its preview, less the relations the preview lists already. */
function ItemRows({
  ctx,
  at,
  whole,
  route,
}: {
  ctx: Ctx;
  at: Column;
  whole: Whole;
  route: string;
}) {
  const listed = new Set(whole.links.filter((l) => l.items.length).map((l) => l.rel));
  const items = at.items.filter((i) => !(i.kind === "relation" && listed.has(lastOf(i.path))));
  return items.length ? <Rows ctx={ctx} c={{ ...at, items }} route={route} /> : null;
}

// --- find --------------------------------------------------------------------------------------

export function FindResults({
  ctx,
  q,
  underName,
  atRoot,
  load,
  onAll,
  onPick,
}: {
  ctx: Ctx;
  q: string;
  underName: string;
  atRoot: boolean;
  load: { data: Item[] | null; error: Error | null; retry: () => void; pending: boolean };
  onAll: () => void;
  onPick: () => void;
}) {
  if (load.error && !load.data)
    return <LoadFailed error={load.error} onRetry={load.retry} className="m-4" />;
  if (!load.data) return <Slow on={load.pending} what={`“${q}”`} />;
  if (!load.data.length)
    return (
      <div className="flex flex-col gap-2 p-4 text-[13.5px] text-(--ui-ink-2)">
        <p className="m-0 wrap-anywhere">
          No match for “{q}” in {underName}.
        </p>
        {atRoot ? null : (
          <Button size="dense" tone="secondary" className="self-start" onClick={onAll}>
            Search all of {ctx.p.name}
          </Button>
        )}
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
      {/* the scope in sight: the crumb still names the route; the list carries the same name */}
      <p
        aria-hidden
        className="m-0 px-2 pt-1 pb-1.5 text-[12px] font-medium text-(--ui-ink-3) wrap-anywhere"
      >
        Found in {underName}
      </p>
      <ul aria-label={`Found in ${underName}`} className="m-0 grid list-none gap-px p-0">
        {load.data.map((i) => (
          <li key={i.path} className="transition-opacity duration-150 starting:opacity-0">
            <Row
              i={{ ...i, sub: [i.sub, i.path].filter(Boolean).join(" · ") }}
              hit={q}
              ctx={{
                ...ctx,
                go: (r) => {
                  onPick();
                  ctx.go(r);
                },
              }}
              chevron={false}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
