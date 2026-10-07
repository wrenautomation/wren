/**
 * What a viewer arranges for himself, kept in his prefs (`KeepApi`): pages pinned to the rail
 * in his order, and which Overview tiles show in what order. Reset puts the defaults back. The
 * screen changes at once; the server hears each change after.
 */
import { cn } from "cn";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import type { KeepApi } from "./list-bar.js";

/** The rail's pins: page paths ("/inbox/replies"), in his order. */
export const RAIL_PREF = "rail";
export interface RailPref {
  pins: string[];
}
/** One pin as the rail draws it: its label and mark come from the app, never the pref. */
export interface PinLine {
  href: string;
  label: string;
  icon: IconName;
}
export const MAX_PINS = 12;

/** An Overview's tiles: their order by label, and the ones he hid. New tiles show, last. */
export interface TilesPref {
  order: string[];
  hidden: string[];
}

export interface Pref<T> {
  value: T | undefined;
  ready: boolean;
  set: (value: T | null) => void;
}

/** One pref, read once and changed in place; a failed write reads it back. */
export function usePref<T>(keep: KeepApi | undefined, key: string): Pref<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const read = useCallback(() => {
    if (!keep) return;
    keep
      .prefs([key])
      .then((p) => setValue(p[key] as T | undefined))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [keep, key]);
  useEffect(() => {
    setValue(undefined);
    setReady(false);
    read();
  }, [read]);
  const set = useCallback(
    (next: T | null) => {
      if (!keep) return;
      setValue(next ?? undefined);
      keep.setPref(key, next).catch(read);
    },
    [keep, key, read],
  );
  return { value, ready: ready || !keep, set };
}

/** Pins this page, or unpins it; a pin past the cap drops the oldest. */
export function togglePin(pins: readonly string[], href: string): string[] {
  if (pins.includes(href)) return pins.filter((p) => p !== href);
  return [...pins, href].slice(-MAX_PINS);
}

/** The list with the one at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [it] = next.splice(from, 1);
  if (it !== undefined) next.splice(to, 0, it);
  return next;
}

/** Tiles in his order, the hidden ones apart; one he never placed keeps its code order, last. */
export function arrangeTiles<T extends { label: string }>(
  tiles: readonly T[],
  pref: TilesPref | undefined,
): { all: T[]; shown: T[]; hidden: T[] } {
  if (!pref) return { all: [...tiles], shown: [...tiles], hidden: [] };
  const at = (t: T) => {
    const i = pref.order.indexOf(t.label);
    return i < 0 ? pref.order.length + tiles.indexOf(t) : i;
  };
  const sorted = [...tiles].sort((a, b) => at(a) - at(b));
  const off = new Set(pref.hidden);
  return {
    all: sorted,
    shown: sorted.filter((t) => !off.has(t.label)),
    hidden: sorted.filter((t) => off.has(t.label)),
  };
}

const GROUP =
  "px-2.5 pt-3 pb-1 text-[11.5px] font-medium tracking-[0.04em] text-(--ui-ink-3) uppercase";
const ROW =
  "flex h-[34px] min-w-0 items-center gap-[11px] rounded-(--ui-radius) px-2.5 text-[14px] font-medium text-(--ui-ink-2) no-underline transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-[current=page]:text-(--ui-ink)";
const QUIET =
  "inline-flex items-center border-0 bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink) focus-visible:text-(--ui-ink)";

/**
 * The rail's Pinned group: drag a pin, or Alt with an arrow key, to move it; × unpins it.
 * "Unpin all" is the reset.
 */
export function PinnedRail({
  pins,
  current,
  onMove,
  onRemove,
  onClear,
}: {
  pins: PinLine[];
  current: string | undefined;
  onMove: (from: number, to: number) => void;
  onRemove: (href: string) => void;
  onClear: () => void;
}) {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  if (!pins.length) return null;
  const key = (i: number) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const to = i + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= pins.length) return;
    onMove(i, to);
    requestAnimationFrame(() => links.current[to]?.focus());
  };
  return (
    <nav aria-label="Pinned">
      <div className="group/pins flex items-center justify-between pr-1">
        <span className={GROUP}>Pinned</span>
        <button
          type="button"
          className={cx(
            QUIET,
            "pt-2 text-[12px] opacity-0 group-hover/pins:opacity-100 focus-visible:opacity-100",
          )}
          onClick={onClear}
        >
          Unpin all
        </button>
      </div>
      <ul className="flex list-none flex-col gap-0.5">
        {pins.map((p, i) => (
          <li
            key={p.href}
            draggable
            onDragStart={(e) => {
              from.current = i;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (from.current === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (from.current !== null) onMove(from.current, i);
              from.current = null;
              setOver(null);
            }}
            onDragEnd={() => {
              from.current = null;
              setOver(null);
            }}
            className={cn(
              "group/pin relative flex items-center",
              over === i && from.current !== null && from.current !== i
                ? from.current < i
                  ? "shadow-[inset_0_-2px_0_var(--ui-accent)]"
                  : "shadow-[inset_0_2px_0_var(--ui-accent)]"
                : "",
            )}
          >
            <a
              ref={(el) => {
                links.current[i] = el;
              }}
              className={cx(ROW, "flex-1 pr-7")}
              href={p.href}
              aria-current={p.href === current ? "page" : undefined}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onKeyDown={key(i)}
            >
              <Icon name={p.icon} size={15} />
              <span className="truncate">{p.label}</span>
            </a>
            <button
              type="button"
              aria-label={`Unpin ${p.label}`}
              className={cx(
                QUIET,
                "absolute right-1.5 size-6 justify-center opacity-0 group-hover/pin:opacity-100 focus-visible:opacity-100",
              )}
              onClick={() => onRemove(p.href)}
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Pins the page on screen to the rail, or unpins it. `compact`: the icon alone (a phone's head). */
export function PinButton({
  pinned,
  onToggle,
  compact = false,
}: {
  pinned: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const label = pinned ? "Unpin page" : "Pin page";
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={cx(
        QUIET,
        "h-8 gap-2 rounded-(--ui-radius) px-2.5 text-[13px] font-medium text-(--ui-ink-2) hover:bg-(--ui-hover) aria-pressed:text-(--ui-accent)",
        compact ? "w-8 justify-center px-0" : "",
      )}
      onClick={onToggle}
    >
      <Icon name="pin" size={15} />
      {compact ? null : label}
    </button>
  );
}

/** The launcher's pins, as a row of links: the rail's, on every screen. */
export function PinnedRow({ pins }: { pins: PinLine[] }) {
  if (!pins.length) return null;
  return (
    <nav aria-label="Pinned" className="mb-8 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[12.5px] font-medium text-(--ui-ink-3)">Pinned</span>
      {pins.map((p) => (
        <a
          key={p.href}
          href={p.href}
          className="inline-flex h-8 items-center gap-2 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-2.5 text-[13.5px] font-medium text-(--ui-ink) no-underline transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-hover)"
        >
          <Icon name={p.icon} size={15} />
          {p.label}
        </a>
      ))}
    </nav>
  );
}

const ITEM =
  "flex h-8 w-full items-center gap-2 border-0 bg-transparent px-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) disabled:opacity-40";
const STEP =
  "inline-flex size-7 flex-none items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30";

/** An Overview's Customize: tick the tiles to show, move them up or down, Reset. */
export function TilesMenu({
  labels,
  pref,
  onChange,
}: {
  /** Every tile's label, in the code's order. */
  labels: string[];
  pref: TilesPref | undefined;
  onChange: (pref: TilesPref | null) => void;
}) {
  // A hidden tile keeps its place here, so a tick never moves the row under the pointer.
  const order = arrangeTiles(
    labels.map((label) => ({ label })),
    pref,
  ).all.map((t) => t.label);
  const off = new Set(pref?.hidden ?? []);
  const put = (next: string[], gone: Set<string>) =>
    onChange({ order: next, hidden: next.filter((l) => gone.has(l)) });
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-8 items-center gap-2 rounded-(--ui-radius) border-0 bg-transparent px-2.5 text-[13px] font-medium text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)">
        <Icon name="sliders" size={15} />
        Customize
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 gap-0 rounded-none p-1.5 ring-(--ui-hair) shadow-lg"
      >
        <p className="px-1.5 pt-1 pb-2 text-[12px] text-(--ui-ink-3)">Tiles to show, in order.</p>
        <ul className="grid list-none gap-px">
          {order.map((label, i) => (
            <li key={label} className="flex items-center gap-1">
              <label className={cx(ITEM, "min-w-0 flex-1 cursor-pointer")}>
                <input
                  type="checkbox"
                  className="size-3.5 accent-(--ui-accent)"
                  checked={!off.has(label)}
                  // One tile always shows.
                  disabled={!off.has(label) && order.length - off.size <= 1}
                  onChange={(e) => {
                    const gone = new Set(off);
                    if (e.target.checked) gone.delete(label);
                    else gone.add(label);
                    put(order, gone);
                  }}
                />
                <span className="truncate">{label}</span>
              </label>
              <button
                type="button"
                className={STEP}
                aria-label={`Move ${label} up`}
                disabled={i === 0}
                onClick={() => put(moved(order, i, i - 1), off)}
              >
                <Icon name="down" size={14} className="rotate-180" />
              </button>
              <button
                type="button"
                className={STEP}
                aria-label={`Move ${label} down`}
                disabled={i === order.length - 1}
                onClick={() => put(moved(order, i, i + 1), off)}
              >
                <Icon name="down" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 border-t border-(--ui-hair) pt-1.5">
          <button type="button" className={ITEM} disabled={!pref} onClick={() => onChange(null)}>
            Reset to default
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
