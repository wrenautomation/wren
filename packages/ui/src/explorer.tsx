/**
 * Explorer: one route through a product's tree, as Columns (the default), a folding List or a
 * Gallery, beside the adapter's preview (designs/2026-11-12-explorer.md, "The part"). It knows no
 * server: `read` brings the answers; `hrefFor` and `onRoute` move. Rows are links.
 */
import {
  type Column,
  type Item,
  isFolder,
  type Page,
  type PathErrorCode,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import { cn } from "cn";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Seg, type TagTone } from "./controls.js";
import { useCopy } from "./copy.js";
import { useLoad } from "./data/query.js";
import { FindResults, Narrow, WideColumns, WideGallery, WideList } from "./explorer-panes.js";
import { type Ctx, follow, within } from "./explorer-rows.js";
import { LoadFailed } from "./feedback.js";
import { Icon, type IconName } from "./icons.js";

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
export type Pager = ReturnType<typeof useMore>;

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
