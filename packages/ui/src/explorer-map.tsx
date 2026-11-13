/**
 * Explorer's Map view: the root's boxes and lines beside the preview, under it on a phone
 * (designs/2026-11-12-explorer.md, Map). The fold lives here, not in the address: a link names a
 * place, not a fold.
 */
import {
  type Column,
  isFolder,
  type LineEnd,
  type LinePage,
  type PathEdge,
  type PathMap,
  RELATIONS,
  rootOf,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./controls.js";
import { useLoad } from "./data/query.js";
import { type Ctx, follow, lastOf, PathFailed, Preview, Rows } from "./explorer-rows.js";
import { LoadFailed } from "./feedback.js";
import { num } from "./format.js";
import { ExplorerMap, type MapLineIn, type MapPick } from "./graph/index.js";
import { Icon } from "./icons.js";

/** The Map's reads: PathsConsole's `map` and `line`, or an adapter in the browser. */
export interface MapRead {
  map(root: string, fold: { depth: number; open: Record<string, boolean> }): Promise<PathMap>;
  line(from: LineEnd, to: LineEnd, after?: string): Promise<LinePage>;
}

/** The root and its first level open; deeper by hand. */
const DEPTH = 2;
/** A phone's map: tall enough to pan, short enough that the preview shows under it. */
const NARROW_H = 480;

/** The boxes on the way to `route`, open: its own box shows. */
const reveal = (route: string) => {
  const s = segments(route);
  const open: Record<string, boolean> = {};
  for (let k = 2; k < s.length; k++) open[s.slice(0, k).join("/")] = true;
  return open;
};

export function MapPane({
  ctx,
  read,
  route,
  home,
  cols,
  whole,
  aside,
  dim,
  error,
  onRetry,
  wide,
  height,
}: {
  ctx: Ctx;
  read: MapRead;
  route: string;
  /** where the route's row lives: an alias's own box */
  home: string;
  cols: Column[];
  whole: Whole | undefined;
  aside: ReactNode;
  dim: boolean;
  /** the walk stopped short: said beside the map, which picks where it stopped */
  error: Shown["error"];
  onRetry: () => void;
  wide: boolean;
  height: number | null;
}) {
  const root = rootOf(route);
  const [hand, setHand] = useState<Record<string, boolean>>(() => reveal(home));
  const [lineId, setLineId] = useState<string | null>(null);
  // another root: its own fold
  const rootWas = useRef(root);
  if (rootWas.current !== root) {
    rootWas.current = root;
    setHand(reveal(home));
    setLineId(null);
  }
  const fold = { depth: DEPTH, open: hand };
  const key = `paths:map:${root}:${JSON.stringify(Object.entries(hand).sort())}`;
  const got = useLoad<PathMap>(key, () => read.map(root, fold), ctx.p.scope);
  const map = got.data;

  // a route the map does not show (a find pick, a link): open the boxes on its way
  useEffect(() => {
    if (!map || got.placeholder || home === root) return;
    if (map.boxes.some((b) => b.path === home)) return;
    const want = reveal(home);
    setHand((h) => (Object.keys(want).every((k) => h[k]) ? h : { ...h, ...want }));
  }, [map, got.placeholder, home, root]);

  const line = lineId ? map?.lines.find((l) => l.id === lineId) : undefined;
  const picked: MapPick | null = line
    ? { kind: "line", id: line.id }
    : map?.boxes.some((b) => b.path === home)
      ? { kind: "box", path: home }
      : null;

  // one cause, said once: the walk's error stands for the map's too
  const failedToo = !!error && !!got.error && !map;
  const frame = failedToo ? (
    <div className="p-4">
      <PathFailed ctx={ctx} error={error} onRetry={onRetry} />
    </div>
  ) : got.error && !map ? (
    <div className="p-4">
      <LoadFailed error={got.error} onRetry={got.retry} what="map" className="mb-0" />
    </div>
  ) : !map ? (
    <div
      role="status"
      aria-busy="true"
      className="grid w-full place-items-center bg-(--ui-graph) text-[13px] text-(--ui-ink-3)"
      style={{ height: wide ? (height ?? 560) : NARROW_H }}
    >
      Laying out the map
    </div>
  ) : !map.boxes.length ? (
    <div className="p-4 text-[14px] text-(--ui-ink-2)">
      {(cols[0] && ctx.p.emptyText?.(cols[0])) ?? "Nothing here yet."}
    </div>
  ) : (
    <ExplorerMap
      map={map}
      label={`${ctx.p.name}, as a map`}
      flush={wide}
      height={wide ? (height ?? 560) : NARROW_H}
      picked={picked}
      onOpen={(path, open) => setHand((h) => ({ ...h, [path]: open }))}
      onPick={(p) => {
        if (p?.kind === "line") return setLineId(p.id);
        setLineId(null);
        if (p?.kind === "box" && p.path !== home) ctx.go(p.path);
      }}
    />
  );

  // the root's rows are the map's own boxes: no list again
  const last = cols.at(-1);
  const folder =
    last && route !== root && last.route === route && isFolder(last.item) ? last : null;
  const side = failedToo ? null : error && !line ? (
    <PathFailed ctx={ctx} error={error} onRetry={onRetry} />
  ) : line && map ? (
    <LinePreview ctx={ctx} read={read} map={map} line={line} />
  ) : whole ? (
    <Preview ctx={ctx} whole={whole} step={cols.at(-1)} route={route} dim={dim} />
  ) : aside ? (
    <div className="transition-opacity duration-150 starting:opacity-0">{aside}</div>
  ) : folder ? (
    // a picked folder: its rows, as its column would show them; the header names it
    <section
      aria-label={folder.item.name}
      className="-mx-2 transition-opacity duration-150 starting:opacity-0"
    >
      <Rows ctx={ctx} c={folder} route={route} />
    </section>
  ) : map?.boxes.length ? (
    <p className="m-0 text-[13px] text-(--ui-ink-3)">Pick an item or a line to read it here.</p>
  ) : null;

  return wide ? (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1">{frame}</div>
      {side ? (
        <div className="min-h-0 w-[min(40%,26rem)] flex-none overflow-y-auto border-l border-(--ui-hair) p-5">
          {side}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="min-w-0 overflow-hidden rounded-(--ui-radius-panel)">{frame}</div>
      {side ? <div className="min-w-0">{side}</div> : null}
    </div>
  );
}

const relName = (rel: string) => RELATIONS[rel] ?? rel.charAt(0).toUpperCase() + rel.slice(1);

/** A picked line: its edges by rel, a page at a time, each end a link. */
function LinePreview({
  ctx,
  read,
  map,
  line,
}: {
  ctx: Ctx;
  read: MapRead;
  map: PathMap;
  line: MapLineIn;
}) {
  const box = (p: string) => map.boxes.find((b) => b.path === p);
  const end = (p: string): LineEnd => ({ path: p, open: !!box(p)?.open });
  const from = end(line.from);
  const to = end(line.to);
  const first = useLoad<LinePage>(
    `paths:line:${line.id}:${from.open}:${to.open}`,
    () => read.line(from, to),
    ctx.p.scope,
  );
  // pages past the first, read on "Show more"
  const [more, setMore] = useState<{ edges: PathEdge[]; next?: string; busy?: boolean }>({
    edges: [],
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new line starts its pages over
  useEffect(() => setMore({ edges: [] }), [line.id, from.open, to.open]);
  const page = first.data;
  const edges = page ? [...page.edges, ...more.edges] : [];
  const next = more.edges.length ? more.next : page?.next;
  const nameOf = (p: string) => box(p)?.name ?? lastOf(p);
  const byRel = new Map<string, PathEdge[]>();
  for (const e of edges) byRel.set(e.rel, [...(byRel.get(e.rel) ?? []), e]);

  const link = (p: string) => (
    <a
      href={ctx.p.hrefFor(p, ctx.p.view)}
      onClick={follow(() => ctx.go(p))}
      className="min-w-0 wrap-anywhere"
    >
      {nameOf(p)}
    </a>
  );
  return (
    <article
      key={line.id}
      className="flex min-w-0 flex-col gap-4 transition-opacity duration-150 starting:opacity-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="m-0 flex flex-wrap items-center gap-x-1.5 text-[19px]/[1.3] font-semibold text-(--ui-ink) wrap-anywhere">
          <span>{nameOf(line.from)}</span>
          <Icon name="right" size={16} className="flex-none text-(--ui-ink-3)" />
          <span>{nameOf(line.to)}</span>
        </h2>
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          {num(line.count)} {line.count === 1 ? "link" : "links"}
        </p>
      </header>
      {first.error && !page ? (
        <LoadFailed error={first.error} onRetry={first.retry} what="links" className="mb-0" />
      ) : !page ? (
        <p role="status" aria-busy="true" className="m-0 text-[13px] text-(--ui-ink-3)">
          Reading the links…
        </p>
      ) : (
        [...byRel].map(([rel, es]) => (
          <section key={rel} aria-label={relName(rel)} className="flex flex-col gap-1">
            <h3 className="m-0 text-[12px] font-medium text-(--ui-ink-3)">
              {relName(rel)}{" "}
              <span className="tabular-nums">{num(line.rels[rel] ?? es.length)}</span>
            </h3>
            <ul className="m-0 grid list-none gap-1 p-0 text-[13.5px]/[1.45]">
              {es.map((e) => (
                <li key={e.id} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  {link(e.from)}
                  <Icon name="right" size={12} className="flex-none text-(--ui-ink-3)" />
                  {link(e.to)}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {next ? (
        <Button
          size="dense"
          tone="secondary"
          className="self-start"
          disabled={more.busy}
          onClick={() => {
            setMore((m) => ({ ...m, busy: true }));
            read.line(from, to, next).then(
              (p) =>
                setMore((m) => ({
                  edges: [...m.edges, ...p.edges],
                  ...(p.next ? { next: p.next } : {}),
                })),
              () => setMore((m) => ({ ...m, busy: false })),
            );
          }}
        >
          {more.busy ? "Reading…" : "Show more"}
        </Button>
      ) : null}
    </article>
  );
}
