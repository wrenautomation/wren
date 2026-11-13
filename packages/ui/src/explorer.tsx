/**
 * Explorer: one route through a product's tree, as Columns (the default), a folding List or a
 * Gallery, beside the adapter's preview (designs/2026-11-12-explorer.md, "The part"). It knows no
 * server: `read` brings the answers; `hrefFor` and `onRoute` move. Rows are links.
 */
import {
  type Column,
  homeOf,
  type Item,
  isFolder,
  type Page,
  type PathErrorCode,
  parentOf,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import { type Fold, type FoldNode, openSet, toggle } from "@wrenautomation/orrery";
import { cn } from "cn";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { Button, Seg, Tag, type TagTone } from "./controls.js";
import { useCopy } from "./copy.js";
import { useLoad } from "./data/query.js";
import { LoadFailed } from "./feedback.js";
import { FoldChevron } from "./folders.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { Img } from "./image.js";

export type ExplorerView = "columns" | "list" | "gallery";
export const EXPLORER_VIEWS: readonly ExplorerView[] = ["columns", "list", "gallery"];

/** The answers Explorer reads: PathsConsole's routes, or an adapter in the browser. */
export interface ExplorerRead {
  columns(route: string): Promise<Shown>;
  children(path: string, after?: string): Promise<Page>;
  find(q: string, under: string): Promise<Item[]>;
}

export interface ExplorerProps {
  /** where it stands: `canon/topics/ui-design` */
  route: string;
  view: ExplorerView;
  /** the root's name in the breadcrumb: "Canon" */
  name: string;
  /** a route's address, in this view or another */
  hrefFor: (route: string, view?: ExplorerView) => string;
  /** go there: a plain click on a row, a key, Back, a find pick, the view switch */
  onRoute: (route: string, view?: ExplorerView) => void;
  read: ExplorerRead;
  /** the app's cache scope: a route seen before shows at once */
  scope?: object | undefined;
  /** the adapter's body for an item; the default shows its text */
  preview?: ((w: Whole, route: string) => ReactNode) | undefined;
  /** beside a folder's rows (Canon's root: its overview); none leaves the rows alone */
  folderPage?: ((c: Column) => ReactNode) | undefined;
  /** the adapter's picture for a Gallery tile; the default is the poster, else the kind's icon */
  tile?: ((i: Item) => ReactNode) | undefined;
  /** how a row's `mark` reads: a line's backing, `retired` */
  marks?: Readonly<Record<string, { label: string; tone?: TagTone }>> | undefined;
  /** the way out of each path error, in the product's words */
  errorText?: Partial<Record<PathErrorCode, ReactNode>> | undefined;
  className?: string | undefined;
}

// the part goes one pane under this width (its own, not the window's)
const WIDE = 720;
const KIND_ICON: Record<string, IconName> = {
  root: "home",
  area: "folder",
  folder: "folder",
  type: "folder",
  layer: "stack",
  relation: "link",
  topic: "book",
  skill: "bolt",
  guide: "doc",
  notes: "note",
  set: "list",
  rule: "list",
  line: "lines",
  reference: "video",
  source: "globe",
  finding: "sparkle",
  pattern: "chart",
  verdict: "approve",
  conflict: "alert",
  file: "page",
  run: "pulse",
  page: "globe",
  sample: "image",
};
const iconOf = (kind: string): IconName => KIND_ICON[kind] ?? "dot";
const within = (outer: string, inner: string) => inner === outer || inner.startsWith(`${outer}/`);
const lastOf = (path: string) => segments(path).at(-1) ?? path;

/** A plain click goes through `onRoute`; a modified one (new tab) stays the browser's. */
const follow = (go: () => void) => (e: MouseEvent) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  go();
};

/** Whether the part is at least `min` wide; measured before paint. */
function useWide(ref: RefObject<HTMLElement | null>, min: number) {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= min,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const at = () => setWide(el.getBoundingClientRect().width >= min);
    at();
    const ro = new ResizeObserver(at);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}

/** The frame's height: from its top to the window's foot. */
function useFrameHeight(ref: RefObject<HTMLElement | null>, on: boolean) {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const at = () =>
      setH(
        Math.max(420, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 16),
      );
    at();
    window.addEventListener("resize", at);
    return () => window.removeEventListener("resize", at);
  }, [ref, on]);
  return h;
}

/** True once `ms` passed since `on` turned true. */
function useAfter(on: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return late;
}

/** Pages read past a column's first, by the column's route. */
type More = Record<string, { items: Item[]; next: string | null; busy: boolean; failed: boolean }>;
function useMore(read: ExplorerRead) {
  const [more, setMore] = useState<More>({});
  const rowsOf = (route: string, first: readonly Item[], next?: string) => {
    const m = more[route];
    return {
      items: m ? [...first, ...m.items] : [...first],
      next: m ? m.next : (next ?? null),
      busy: !!m?.busy,
      failed: !!m?.failed,
    };
  };
  const load = (route: string, after: string) => {
    setMore((s) => ({
      ...s,
      [route]: { items: s[route]?.items ?? [], next: after, busy: true, failed: false },
    }));
    read.children(route, after).then(
      (p) =>
        setMore((s) => ({
          ...s,
          [route]: {
            items: [...(s[route]?.items ?? []), ...p.items],
            next: p.next ?? null,
            busy: false,
            failed: false,
          },
        })),
      () =>
        setMore((s) => ({
          ...s,
          [route]: { items: s[route]?.items ?? [], next: after, busy: false, failed: true },
        })),
    );
  };
  return { rowsOf, load };
}
type Pager = ReturnType<typeof useMore>;

/** What every pane needs from the frame. */
interface Ctx {
  p: ExplorerProps;
  pager: Pager;
  go: (route: string) => void;
}

export function Explorer(p: ExplorerProps) {
  const { view, read, scope, hrefFor, onRoute } = p;
  const box = useRef<HTMLDivElement>(null);
  const wide = useWide(box, WIDE);
  const got = useLoad<Shown>(`paths:columns:${p.route}`, () => read.columns(p.route), scope);
  const pager = useMore(read);
  const shown = got.data;
  // the answer is this route's; else another's, held while this one reads (Moving)
  const settled = shown !== null && !got.placeholder;
  const cols = useMemo(
    () =>
      !shown ? [] : settled ? shown.columns : shown.columns.filter((c) => within(c.route, p.route)),
    [shown, settled, p.route],
  );
  // a moved path walks on from its new home: show that route, not the old name
  const walked = settled && !shown.error ? shown.columns.at(-1)?.route : undefined;
  const route = walked ?? p.route;
  const error = settled ? shown?.error : undefined;
  const whole = shown?.whole;
  const last = cols.at(-1);
  const aside =
    settled && !error && !whole && last && isFolder(last.item) ? p.folderPage?.(last) : undefined;
  const go = (r: string) => onRoute(r, view);
  const ctx: Ctx = { p, pager, go };

  // the side a narrow pane slides in from: deeper comes from the right
  const depth = segments(route).length;
  const was = useRef(depth);
  const deeper = depth >= was.current;
  useEffect(() => {
    was.current = depth;
  }, [depth]);

  // Find: 250 ms after the last key, under the route; a new route ends it
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<{ q: string; under: string } | null>(null);
  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setAsked(null);
      return;
    }
    const t = setTimeout(() => setAsked((a) => (a?.q === q ? a : { q, under: route })), 250);
    return () => clearTimeout(t);
  }, [text, route]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route clears the box
  useEffect(() => {
    setText("");
    setAsked(null);
  }, [p.route]);
  const found = useLoad<Item[]>(
    asked ? `paths:find:${asked.under}:${asked.q}` : null,
    () => (asked ? read.find(asked.q, asked.under) : Promise.resolve([])),
    scope,
  );

  // a step that failed has no column: its row above still names it
  const names = new Map(cols.flatMap((c) => c.items.map((i) => [i.path, i.name] as const)));
  for (const c of cols) names.set(c.route, c.item.name);
  const segs = segments(route);
  const crumbs = segs.map((s, i) => {
    const r = segs.slice(0, i + 1).join("/");
    return { route: r, name: i === 0 ? p.name : (names.get(r) ?? s) };
  });
  const here = crumbs.at(-1)?.name ?? p.name;
  const home = settled && last ? last.home : route;

  const frameBox = useRef<HTMLDivElement>(null);
  const frame = useFrameHeight(frameBox, wide);
  const body = asked ? (
    <FindResults
      ctx={ctx}
      q={asked.q}
      underName={asked.under === route ? here : p.name}
      atRoot={asked.under === segs[0]}
      load={found}
      onAll={() => setAsked({ q: asked.q, under: segs[0] ?? route })}
      onPick={() => {
        setText("");
        setAsked(null);
      }}
    />
  ) : got.error && !settled ? (
    // the frame's body, not a card in it: the retry sits under its message
    <div className="min-w-0 flex-1 p-4">
      <LoadFailed error={got.error} onRetry={got.retry} className="mb-0" />
    </div>
  ) : !wide ? (
    <Narrow
      ctx={ctx}
      cols={cols}
      whole={settled ? whole : undefined}
      aside={aside}
      error={error}
      waiting={!settled}
      deeper={deeper}
      route={route}
      onRetry={got.retry}
    />
  ) : view === "list" ? (
    <WideList
      ctx={ctx}
      cols={cols}
      whole={whole}
      aside={aside}
      dim={!settled}
      error={error}
      waiting={!settled}
      route={route}
      onRetry={got.retry}
    />
  ) : view === "gallery" ? (
    <WideGallery
      ctx={ctx}
      cols={cols}
      whole={whole}
      aside={aside}
      dim={!settled}
      error={error}
      waiting={!settled}
      route={route}
      onRetry={got.retry}
    />
  ) : (
    <WideColumns
      ctx={ctx}
      cols={cols}
      whole={whole}
      aside={aside}
      dim={!settled}
      error={error}
      waiting={!settled}
      first={!shown}
      route={route}
      onRetry={got.retry}
    />
  );

  return (
    <div ref={box} className={cn("flex min-w-0 flex-col gap-3", p.className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* narrow: the pane's Back row names the parent; the crumb names only where it stands */}
        <Crumbs crumbs={wide ? crumbs : crumbs.slice(-1)} ctx={ctx} />
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            wide ? "flex-none" : "flex-1 basis-full",
          )}
        >
          <FindBox text={text} onText={setText} where={here} wide={wide} />
          <Seg
            dense
            label="View"
            value={view}
            onChange={(v) => onRoute(route, v)}
            items={[
              {
                value: "columns",
                label: <ViewLabel icon="columns" text="Columns" short={!wide} />,
              },
              { value: "list", label: <ViewLabel icon="list" text="List" short={!wide} /> },
              { value: "gallery", label: <ViewLabel icon="apps" text="Gallery" short={!wide} /> },
            ]}
          />
          <CopyLink href={hrefFor(home)} />
        </div>
      </div>
      <div
        ref={frameBox}
        // wide: one frame as tall as the window; each pane scrolls inside it
        style={wide && frame ? { height: frame } : undefined}
        className={cn(
          "min-w-0",
          wide && "flex overflow-hidden rounded-(--ui-radius-panel) border border-(--ui-hair)",
        )}
      >
        <div
          key={`${view}:${asked ? "find" : "body"}`}
          className="flex min-h-0 min-w-0 flex-1 transition-opacity duration-150 ease-out starting:opacity-0"
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function ViewLabel({ icon, text, short }: { icon: IconName; text: string; short: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon} size={14} />
      <span className={short ? "sr-only" : undefined}>{text}</span>
    </span>
  );
}

function Crumbs({ crumbs, ctx }: { crumbs: { route: string; name: string }[]; ctx: Ctx }) {
  return (
    <nav aria-label="Path" className="min-w-0 flex-[1_1_24rem]">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-0.5 p-0 text-[13.5px]/[1.4]">
        {crumbs.map((c, i) => {
          const end = i === crumbs.length - 1;
          return (
            // the separator trails its crumb: a wrapped line never opens on one
            <li key={c.route} className="flex min-w-0 items-center gap-1">
              {end ? (
                <span aria-current="page" className="font-semibold text-(--ui-ink) wrap-anywhere">
                  {c.name}
                </span>
              ) : (
                <a
                  href={ctx.p.hrefFor(c.route, ctx.p.view)}
                  onClick={follow(() => ctx.go(c.route))}
                  className="text-(--ui-ink-2) no-underline wrap-anywhere hover:text-(--ui-ink) hover:underline"
                >
                  {c.name}
                </a>
              )}
              {end ? null : <Icon name="right" size={12} className="flex-none text-(--ui-ink-3)" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FindBox({
  text,
  onText,
  where,
  wide,
}: {
  text: string;
  onText: (t: string) => void;
  where: string;
  wide: boolean;
}) {
  return (
    <label
      className={cn(
        "flex h-8 min-w-0 cursor-text items-center gap-1.5 rounded-[8px] bg-(--ui-fill) pr-1 pl-2.5 text-(--ui-ink-2) focus-within:outline-2 focus-within:outline-(--ui-focus)",
        wide ? "w-56 flex-none" : "flex-1",
      )}
    >
      <Icon name="search" size={15} className="flex-none" />
      <input
        // edit-ok: search box
        type="search"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            onText("");
          }
        }}
        // a placeholder can't wrap: a long name or a phone gets the short one
        placeholder={wide && where.length <= 20 ? `Find in ${where}` : "Find here"}
        aria-label={`Find in ${where}`}
        className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear find"
          onClick={() => onText("")}
          className="grid size-6 flex-none cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink)"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </label>
  );
}

function CopyLink({ href }: { href: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : "Copy link"}
      onClick={() => copy(new URL(href, location.href).href)}
      className="relative grid size-8 flex-none cursor-pointer place-items-center rounded-[8px] border-0 bg-transparent text-(--ui-ink-2) transition-[background-color,color] duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
    >
      <Icon
        name="link"
        size={15}
        className={cn(
          "col-start-1 row-start-1 transition-opacity duration-150",
          copied && "opacity-0",
        )}
      />
      <Icon
        name="check"
        size={15}
        className={cn(
          "col-start-1 row-start-1 text-(--ui-good) transition-opacity duration-150",
          !copied && "opacity-0",
        )}
      />
    </button>
  );
}

// --- rows --------------------------------------------------------------------------------------

/** A row read under `home` whose own home sits elsewhere: the edge into an alias, not a row inside one. */
const aliased = (i: Item, home: string) => !!i.original && parentOf(i.original) !== home;

/** The name, with the found words marked. */
function Hit({ text, q }: { text: string; q?: string | undefined }) {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (!q || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-(--ui-accent-tint) text-inherit">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

const AliasMark = () => (
  <Icon
    name="open"
    size={12}
    label="shown here from its home"
    className="ml-1 inline align-[-1px] text-(--ui-ink-3)"
  />
);

/** A row's mark: a toned one is a tag; a neutral one reads as quiet words beside the name. */
function MarkOf({ mark }: { mark: { label: string; tone?: TagTone } }) {
  return mark.tone && mark.tone !== "neutral" ? (
    <Tag tone={mark.tone} className="self-start">
      {mark.label}
    </Tag>
  ) : null;
}
const quietMark = (mark: { label: string; tone?: TagTone } | undefined) =>
  mark && (!mark.tone || mark.tone === "neutral") ? (
    <span className="ml-1.5 text-[11.5px] font-normal text-(--ui-ink-3)">{mark.label}</span>
  ) : null;

/** One row: icon, name (↗ on an alias edge), its mark, the sub, the count and a chevron if it opens. */
function Row({
  i,
  ctx,
  alias,
  on,
  current,
  chevron = true,
  hit,
}: {
  i: Item;
  ctx: Ctx;
  /** the edge into an alias: ↗ and "from" */
  alias?: boolean;
  /** on the route */
  on?: boolean;
  /** the route's own row */
  current?: boolean;
  chevron?: boolean;
  /** the words a find matched */
  hit?: string;
}) {
  const mark = i.mark ? ctx.p.marks?.[i.mark] : undefined;
  return (
    <a
      data-row=""
      data-path={i.path}
      data-leaf={i.leaf ? "" : undefined}
      href={ctx.p.hrefFor(i.path, ctx.p.view)}
      onClick={follow(() => ctx.go(i.path))}
      aria-current={current ? "page" : on ? "true" : undefined}
      className={cn(
        "grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2 rounded-[8px] px-2 py-1.5 text-(--ui-ink) no-underline transition-[background-color] duration-150 hover:bg-(--ui-fill) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-focus)",
        on && "bg-(--ui-fill)",
        current && "bg-(--ui-accent-tint) hover:bg-(--ui-accent-tint)",
      )}
    >
      <Icon name={iconOf(i.kind)} size={15} className="mt-[2px] text-(--ui-ink-3)" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span dir="auto" className="text-[13.5px]/[1.4] font-medium wrap-anywhere">
          <Hit text={i.name} q={hit} />
          {alias ? <AliasMark /> : null}
          {quietMark(mark)}
        </span>
        {mark ? <MarkOf mark={mark} /> : null}
        {i.sub ? (
          <span dir="auto" className="text-[12px]/[1.4] text-(--ui-ink-3) wrap-anywhere">
            {i.sub}
          </span>
        ) : null}
        {alias && i.from ? (
          <span className="text-[12px]/[1.4] text-(--ui-ink-3) wrap-anywhere">from {i.from}</span>
        ) : null}
      </span>
      <span className="mt-[3px] flex items-center gap-1 text-[11.5px] text-(--ui-ink-3) tabular-nums">
        {i.count != null ? num(i.count) : null}
        {chevron && !i.leaf ? <Icon name="right" size={12} /> : null}
      </span>
    </a>
  );
}

function ShowMore({ ctx, route, next }: { ctx: Ctx; route: string; next: string | null }) {
  const m = ctx.pager.rowsOf(route, [], next ?? undefined);
  if (!m.next) return null;
  const after = m.next;
  return (
    <div className="px-2 py-1.5">
      <Button size="dense" tone="quiet" busy={m.busy} onClick={() => ctx.pager.load(route, after)}>
        {m.failed ? "Couldn't read more. Try again" : "Show more"}
      </Button>
    </div>
  );
}

/** A column's rows with their later pages. */
function rowsOf(ctx: Ctx, c: Column) {
  return ctx.pager.rowsOf(c.route, c.items, c.next);
}

/** The rows of one level as a list; the row on the route is marked. */
function Rows({ ctx, c, route }: { ctx: Ctx; c: Column; route: string }) {
  const r = rowsOf(ctx, c);
  if (!r.items.length)
    return (
      <p className="m-0 px-3 py-2 text-[13px] text-(--ui-ink-3) wrap-anywhere">
        {c.item.name} holds nothing yet.
      </p>
    );
  return (
    <>
      <ul className="m-0 grid list-none gap-px p-0">
        {r.items.map((i) => (
          <li key={i.path} className="transition-opacity duration-150 starting:opacity-0">
            <Row
              i={i}
              ctx={ctx}
              alias={aliased(i, c.home)}
              on={within(i.path, route)}
              current={i.path === route}
            />
          </li>
        ))}
      </ul>
      <ShowMore ctx={ctx} route={c.route} next={r.next} />
    </>
  );
}

function Slow({ on, what }: { on: boolean; what: string }) {
  const late = useAfter(on, 1000);
  return (
    <div role="status" className="flex flex-col gap-3.5 px-3 py-3">
      <span className="sr-only">Reading {what}</span>
      {/* the rows' shape: icon, name, sub */}
      {["w-[70%]", "w-[52%]", "w-[62%]"].map((w) => (
        <span key={w} className="flex items-start gap-2">
          <Skeleton className="size-4 flex-none rounded-[4px]" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3", w)} />
            <Skeleton className="h-2.5 w-[40%]" />
          </span>
        </span>
      ))}
      {late ? (
        <span
          aria-hidden
          className="text-[12px] text-(--ui-ink-3) transition-opacity duration-150 starting:opacity-0 wrap-anywhere"
        >
          Reading {what}…
        </span>
      ) : null}
    </div>
  );
}

/** A walk that stopped: what failed and the way out. */
function PathFailed({
  ctx,
  error,
  onRetry,
}: {
  ctx: Ctx;
  error: NonNullable<Shown["error"]>;
  onRetry: () => void;
}) {
  const up = parentOf(error.route);
  const own = ctx.p.errorText?.[error.code];
  const said: Record<PathErrorCode, ReactNode> = {
    "unknown-path": <>Nothing is at “{lastOf(error.route)}”.</>,
    "not-indexed": <>This has no index yet.</>,
    offline: <>{ctx.p.name} doesn't answer.</>,
    blind: <>Hidden while its batch is open.</>,
  };
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[13.5px]/[1.5] text-(--ui-ink-2)">
      <b className="font-semibold text-(--ui-ink)">{said[error.code]}</b>
      {own ? <span className="text-pretty">{own}</span> : null}
      {error.code === "unknown-path" && up ? (
        <a
          href={ctx.p.hrefFor(up, ctx.p.view)}
          onClick={follow(() => ctx.go(up))}
          className="self-start"
        >
          Go up one level
        </a>
      ) : null}
      {error.code === "offline" ? (
        <Button size="dense" tone="secondary" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// --- preview -----------------------------------------------------------------------------------

function Preview({
  ctx,
  whole,
  step,
  route,
  dim,
}: {
  ctx: Ctx;
  whole: Whole;
  step: Column | undefined;
  route: string;
  dim: boolean;
}) {
  const moved = step?.item.was;
  const alias = step && !moved && step.route !== step.home;
  const links = whole.links.filter((l) => l.items.length);
  const body = ctx.p.preview ? undefined : whole.body;
  // a rule line's sub is its body's first words: say it once
  const sub =
    whole.sub && whole.sub !== whole.name && !body?.trimStart().startsWith(whole.sub.trim())
      ? whole.sub
      : undefined;
  return (
    <article
      key={whole.path}
      className={cn(
        "flex min-w-0 flex-col gap-4 transition-opacity duration-150 starting:opacity-0",
        dim && "opacity-50",
      )}
    >
      {moved ? (
        // the one sign the address changed: content, not a caption
        <p className="m-0 flex items-start gap-2 self-start rounded-[8px] bg-(--ui-band) px-2.5 py-1.5 text-[13px]/[1.45] text-(--ui-ink-2) wrap-anywhere">
          <Icon name="moveTo" size={15} className="mt-[2px] flex-none text-(--ui-ink-3)" />
          <span>
            “{lastOf(moved)}” moved: this is {whole.name}.
          </span>
        </p>
      ) : null}
      <header className="flex flex-col gap-1">
        <h2
          dir="auto"
          className="m-0 text-[19px]/[1.3] font-semibold text-(--ui-ink) wrap-anywhere"
        >
          {whole.name}
        </h2>
        {sub ? (
          <p dir="auto" className="m-0 text-[13px]/[1.45] text-(--ui-ink-2) wrap-anywhere">
            {sub}
          </p>
        ) : null}
        {alias && step ? (
          <a
            href={ctx.p.hrefFor(step.home, ctx.p.view)}
            onClick={follow(() => ctx.go(step.home))}
            className="self-start text-[13px]"
          >
            Show original
          </a>
        ) : null}
      </header>
      {ctx.p.preview ? (
        ctx.p.preview(whole, route)
      ) : body ? (
        <div className="max-w-[72ch] text-[14px]/[1.6] whitespace-pre-wrap text-(--ui-ink-2) wrap-anywhere">
          {body}
        </div>
      ) : null}
      {links.map((l) => (
        <section key={`${l.dir}:${l.rel}`} aria-label={l.label} className="flex flex-col gap-1">
          <h3 className="m-0 text-[12px] font-medium text-(--ui-ink-3)">
            {l.label} <span className="tabular-nums">{num(l.items.length)}</span>
          </h3>
          <ul className="m-0 grid list-none gap-px p-0">
            {/* every link leads elsewhere: the heading says so, no ↗ per row */}
            {l.items.map((i) => (
              <li key={i.path}>
                <Row i={{ ...i, path: homeOf(i) }} ctx={ctx} chevron={false} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}

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

function WideColumns(props: PaneProps & { first: boolean }) {
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

function WideList(props: PaneProps) {
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
                  current && "bg-(--ui-accent-tint) outline-2 outline-(--ui-accent)",
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

function WideGallery(props: PaneProps) {
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
function Narrow({
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

function FindResults({
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
