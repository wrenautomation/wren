/**
 * Saved views of the Map (designs/2026-10-23-focus-view.md F2, 2026-11-06-views.md): a view is a
 * Map address kept in `saved_views` (record `map`). `parts=` makes it a focus page; else it holds
 * the whole Map's look (`look`, `floor`, `split`, `shut`) and folds (`depth`, `open`, `close`).
 * The viewer's `map.home` pref names the view "/" opens on.
 */
import { MAP_VIEW_RECORD, partsOf, partsParam } from "@wren/pipeline/metro-parts";
import {
  CHIP,
  CHIP_ON,
  Icon,
  type KeepApi,
  type Pref,
  type SavedViewLine,
  SaveViewPop,
  useSavedViews,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import type { MetroPart } from "@wren/ui/metro";
import { useState } from "react";
import { type PageProps, WREN } from "../module.js";
import { keepOf } from "../records.js";
import { href, navigate, type Params } from "../route.js";
import { focusHref } from "./focus.js";
import type { Kept } from "./kept.js";

export const MAP_HOME = "map.home";

/** Where the workspace keeps his views of its Map: Wren's team only, never on a demo. */
export const mapKeepOf = (props: PageProps): KeepApi | undefined =>
  props.team && !props.demo
    ? keepOf(props.client === WREN.id ? null : props.client, { app: "", asClient: false })
    : undefined;

/** The parts a saved view holds. */
export const viewPartsOf = (v: SavedViewLine): MetroPart[] =>
  partsOf(new URLSearchParams(v.params).get("parts"));

/** A set of parts as a saved view's params, as the server keeps them. */
export const viewParamsOf = (parts: readonly MetroPart[]) =>
  new URLSearchParams({ parts: partsParam(parts) }).toString();

/** The workspace's views of its Map, his own and the shared ones, in tab order. */
export const useMapViews = (keep: KeepApi | undefined) => useSavedViews(keep, MAP_VIEW_RECORD);

/** The address keys of the whole Map's look; depth and folds live in the kept store. */
const LOOK = ["look", "floor", "split", "shut"] as const;
const FOLDS = ["depth", "open", "close"] as const;

/** Keys in a fixed order: two equal views give one string. */
const norm = (q: URLSearchParams) =>
  new URLSearchParams(
    [...q].filter(([, v]) => v !== "").sort(([a], [b]) => a.localeCompare(b)),
  ).toString();

/** The whole Map as it is drawn: the address's look and this browser's folds, as view params. */
export function mapParamsOf(params: URLSearchParams, kept: Kept): string {
  const q = new URLSearchParams();
  for (const k of LOOK) {
    const v = params.get(k);
    // shut plates as a set: the order they were shut in is no part of the view
    if (v) q.set(k, k === "shut" ? v.split(",").filter(Boolean).sort().join(",") : v);
  }
  if (kept.depth !== undefined) q.set("depth", String(kept.depth));
  const open = Object.entries(kept.open ?? {});
  const ids = (b: boolean) =>
    open
      .filter(([, o]) => o === b)
      .map(([id]) => id)
      .sort()
      .join(",");
  if (ids(true)) q.set("open", ids(true));
  if (ids(false)) q.set("close", ids(false));
  return norm(q);
}

/** The folds a view writes to the kept store, or null when it names none. */
export function foldsOf(params: URLSearchParams): Kept | null {
  if (!FOLDS.some((k) => params.has(k))) return null;
  const depth = Number(params.get("depth"));
  const open: Record<string, boolean> = {};
  for (const id of (params.get("open") ?? "").split(",")) if (id) open[id] = true;
  for (const id of (params.get("close") ?? "").split(",")) if (id) open[id] = false;
  return {
    ...(Number.isInteger(depth) && depth >= 0 && params.has("depth") ? { depth } : {}),
    open,
  };
}

/** Where a view opens: a focus page for parts, else "/" with its look and folds. */
export function viewHref(v: SavedViewLine, keep: URLSearchParams): string {
  const q = new URLSearchParams(v.params);
  if (q.get("parts")) return focusHref({ view: v.id }, keep);
  const p: Params = { window: keep.get("window"), client: keep.get("client"), sv: v.id };
  for (const k of [...LOOK, ...FOLDS]) p[k] = q.get(k);
  // always one fold key: the view's folds replace the kept ones, even when it names none
  p.depth ??= "base";
  return href("/", p);
}

/** Is the Map on screen the view: the same look and folds. */
export const isViewOf = (v: SavedViewLine, now: string) =>
  !new URLSearchParams(v.params).get("parts") && norm(new URLSearchParams(v.params)) === now;

/** A view's look in one word, for its row. */
function lookOf(v: SavedViewLine): string {
  const q = new URLSearchParams(v.params);
  const n = viewPartsOf(v).length;
  if (n) return n === 1 ? "1 part" : `${n} parts`;
  return q.get("look") === "layers" ? "Layers" : "Flat";
}

/**
 * The Views tool of a map bar: the view on screen by name; in its pop, the whole Map, each saved
 * view, and Home for the one on screen. Save view sits beside it while the screen differs.
 */
export function ViewsMenu({
  views,
  home,
  current,
  save,
  params,
  keep,
  onSaved,
}: {
  views: { lines: readonly SavedViewLine[]; ready: boolean; reload: () => void };
  home: Pref<number>;
  /** The saved view on screen, when the screen is it. */
  current: SavedViewLine | null;
  /** The screen as view params; null hides Save view. */
  save: { params: string; from: SavedViewLine | null } | null;
  params: URLSearchParams;
  keep: KeepApi;
  onSaved?: ((v: SavedViewLine) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const isHome = !!current && home.value === current.id;
  const whole = href("/", { window: params.get("window"), client: params.get("client"), whole: 1 });
  const row =
    "flex min-h-8 pointer-coarse:min-h-11 w-full items-center gap-2 rounded-(--ui-leaf-nav) px-1.5 py-1 text-left text-[13px] text-(--ui-ink) no-underline hover:bg-(--ui-accent-wash)";
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={CHIP} aria-label={`Views: ${current?.name ?? "none open"}`}>
          <Icon name="bookmark" size={15} />
          <span className="max-w-[16ch] wrap-anywhere whitespace-normal text-left">
            {current?.name ?? "Views"}
          </span>
          <Icon name="down" size={13} />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Views"
          className="w-72 gap-0.5 bg-(--ui-paper) p-2 text-(--ui-ink)"
        >
          <a href={whole} className={row} aria-current={!current || undefined}>
            <span className="min-w-0 flex-1 font-semibold">Whole map</span>
          </a>
          {views.lines.length ? (
            <ul className="grid list-none gap-0.5 border-t border-(--ui-hair) pt-1">
              {views.lines.map((v) => (
                <li key={v.id}>
                  <a
                    href={viewHref(v, params)}
                    className={`${row} ${v.id === current?.id ? CHIP_ON : ""}`}
                    aria-current={v.id === current?.id || undefined}
                  >
                    <span className="min-w-0 flex-1 font-semibold wrap-anywhere">{v.name}</span>
                    <span className="text-[12px] text-(--ui-ink-3)">
                      {[lookOf(v), v.id === home.value ? "Home" : null, v.shared ? "Shared" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1.5 py-1 text-[12.5px] text-(--ui-ink-3)">
              No saved views yet. Set the map as you want it, then Save view.
            </p>
          )}
          {current ? (
            <button
              type="button"
              aria-pressed={isHome}
              className={`${row} mt-1 border-t border-(--ui-hair) pt-1.5`}
              onClick={() => {
                home.set(isHome ? null : current.id);
                setOpen(false);
              }}
            >
              <Icon name={isHome ? "check" : "home"} size={15} />
              <span className="flex-1">
                {isHome ? 'Home view: "/" opens it' : "Make it the home view"}
              </span>
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
      {save && views.ready ? (
        <SaveViewPop
          record={MAP_VIEW_RECORD}
          params={save.params}
          keep={keep}
          open={save.from ?? undefined}
          onSaved={(v) => {
            views.reload();
            if (onSaved) onSaved(v);
            else navigate(viewHref(v, params));
          }}
        />
      ) : null}
    </div>
  );
}
