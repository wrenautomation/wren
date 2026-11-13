/**
 * Explorer's rows, the preview and the path errors: what every pane draws
 * (designs/2026-11-12-explorer.md, "The part").
 */
import {
  type Column,
  homeOf,
  type Item,
  type PathErrorCode,
  parentOf,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import { cn } from "cn";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { Button, Tag, type TagTone } from "./controls.js";
import type { ExplorerProps, Pager } from "./explorer.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";

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
export const iconOf = (kind: string): IconName => KIND_ICON[kind] ?? "dot";
export const within = (outer: string, inner: string) =>
  inner === outer || inner.startsWith(`${outer}/`);
export const lastOf = (path: string) => segments(path).at(-1) ?? path;

/** A plain click goes through `onRoute`; a modified one (new tab) stays the browser's. */
export const follow = (go: () => void) => (e: MouseEvent) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  go();
};
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

/** What every pane needs from the frame. */
export interface Ctx {
  p: ExplorerProps;
  pager: Pager;
  go: (route: string) => void;
}

// --- rows --------------------------------------------------------------------------------------

/** A row read under `home` whose own home sits elsewhere: the edge into an alias, not a row inside one. */
export const aliased = (i: Item, home: string) => !!i.original && parentOf(i.original) !== home;

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

export const AliasMark = () => (
  <Icon
    name="open"
    size={12}
    label="shown here from its home"
    className="ml-1 inline align-[-1px] text-(--ui-ink-3)"
  />
);

/** A row's mark: a toned one is a tag; a neutral one reads as quiet words beside the name. */
export function MarkOf({ mark }: { mark: { label: string; tone?: TagTone } }) {
  return mark.tone && mark.tone !== "neutral" ? (
    <Tag tone={mark.tone} className="self-start">
      {mark.label}
    </Tag>
  ) : null;
}
export const quietMark = (mark: { label: string; tone?: TagTone } | undefined) =>
  mark && (!mark.tone || mark.tone === "neutral") ? (
    <span className="ml-1.5 text-[11.5px] font-normal text-(--ui-ink-3)">{mark.label}</span>
  ) : null;

/** One row: icon, name (↗ on an alias edge), its mark, the sub, the count and a chevron if it opens. */
export function Row({
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

export function ShowMore({ ctx, route, next }: { ctx: Ctx; route: string; next: string | null }) {
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
export function rowsOf(ctx: Ctx, c: Column) {
  return ctx.pager.rowsOf(c.route, c.items, c.next);
}

/** The rows of one level as a list; the row on the route is marked. */
export function Rows({ ctx, c, route }: { ctx: Ctx; c: Column; route: string }) {
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

export function Slow({ on, what }: { on: boolean; what: string }) {
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
export function PathFailed({
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

export function Preview({
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
  // a rule line's sub is its body's first words: say it once, whoever draws the body
  const sub =
    whole.sub && whole.sub !== whole.name && !whole.body?.trimStart().startsWith(whole.sub.trim())
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
