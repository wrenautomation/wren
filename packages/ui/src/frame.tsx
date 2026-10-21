/**
 * The frame as the viewer sets it (`display.ts`): kept in his prefs and mirrored in the browser
 * so the first paint is already his; the edge he drags a panel by; the Layout panel; and the
 * keys sheet on ?, which lists the frame's keys and each page's own (designs/2026-10-11-portal-polish.md).
 */
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Seg } from "./controls.js";
import { usePref } from "./customize.js";
import {
  DISPLAY,
  DISPLAY_PREF,
  type Display,
  displayDiff,
  dragged,
  readDisplay,
} from "./display.js";
import { cx } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";
import { GROUP_LABEL } from "./layout.js";
import type { KeepApi } from "./list-bar.js";

const MIRROR = "wren.display";
const recall = (): unknown => {
  try {
    return JSON.parse(localStorage.getItem(MIRROR) ?? "null");
  } catch {
    return null;
  }
};
const mirror = (d: Display) => {
  try {
    const kept = displayDiff(d);
    if (kept) localStorage.setItem(MIRROR, JSON.stringify(kept));
    else localStorage.removeItem(MIRROR);
  } catch {}
};

export interface DisplayControl {
  display: Display;
  /** Changes some of it; null puts every default back. */
  set: (patch: Partial<Display> | null) => void;
}

const FrameContext = createContext<DisplayControl | null>(null);
/** The frame the shell draws, for a settings page that changes it. Null outside a shell with one. */
export const FrameProvider = FrameContext.Provider;
export const useFrame = () => useContext(FrameContext);

/**
 * His frame: the browser's copy at once, then his prefs' once read, so it's the same on every
 * device. Without a keep (the demo) it lives in the browser alone.
 */
export function useDisplay(keep: KeepApi | undefined): DisplayControl {
  const pref = usePref<Partial<Display>>(keep, DISPLAY_PREF);
  const [display, setDisplay] = useState(() => readDisplay(recall()));
  const now = useRef(display);
  now.current = display;
  const kept = JSON.stringify(pref.value ?? null);
  useEffect(() => {
    if (!keep || !pref.ready) return;
    const d = readDisplay(JSON.parse(kept));
    setDisplay(d);
    mirror(d);
  }, [keep, pref.ready, kept]);
  const write = pref.set;
  const set = useCallback(
    (patch: Partial<Display> | null) => {
      const d = patch ? readDisplay({ ...now.current, ...patch }) : DISPLAY;
      now.current = d;
      setDisplay(d);
      mirror(d);
      write(displayDiff(d));
    },
    [write],
  );
  return { display, set };
}

/** A key the frame or a page answers, as the sheet on ? lists it. */
export type KeyLine = [keys: string, what: string];
export interface KeySection {
  title: string;
  keys: KeyLine[];
}

export const FRAME_KEYS: KeySection = {
  title: "Anywhere",
  keys: [
    ["⌘ K", "Open anything: a page, a record, an action"],
    ["⌥ ↑ ↓", "The app's page above or below"],
    ["G, then a letter", "A page of the app you're in"],
    ["[", "Fold or open the sidebar"],
    ["]", "Hide or show the app's pages"],
    ["N", "A quick note"],
    ["?", "These keys"],
  ],
};

export const LIST_KEYS: KeySection = {
  title: "On a list",
  keys: [
    ["↑  ↓", "The row above or below (J and K too)"],
    ["Enter", "Open it"],
    ["Esc", "Close it"],
    ["/", "Search"],
  ],
};

// The page on screen names its own keys; the sheet reads them as it opens.
let pageKeys: KeySection[] = [];
const heard = new Set<() => void>();
const subscribe = (fn: () => void) => {
  heard.add(fn);
  return () => heard.delete(fn);
};
const snapshot = () => pageKeys;

/** The page's own keys, in the sheet while it's on screen. */
export function usePageKeys(section: KeySection | null) {
  const key = JSON.stringify(section);
  useEffect(() => {
    const s = JSON.parse(key) as KeySection | null;
    if (!s) return;
    pageKeys = [...pageKeys, s];
    for (const fn of heard) fn();
    return () => {
      pageKeys = pageKeys.filter((x) => x !== s);
      for (const fn of heard) fn();
    };
  }, [key]);
}

const SHOW_KEYS = "wren:keys";
/** Opens the keys sheet from a page's own button. */
export const showKeys = () => dispatchEvent(new Event(SHOW_KEYS));
/** The sheet's opener hears a page's button. */
export function useShowKeys(open: () => void) {
  useEffect(() => {
    addEventListener(SHOW_KEYS, open);
    return () => removeEventListener(SHOW_KEYS, open);
  }, [open]);
}

/** A key cap. */
export function Key({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-(--ui-radius) border border-b-2 border-(--ui-hair) bg-(--ui-paper) px-1 font-[inherit] text-[11px] font-medium text-(--ui-ink-2) [font-variant-numeric:tabular-nums]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** "⌘ K" as caps; "G, then a letter" stays words with its key capped. */
function Keys({ keys }: { keys: string }) {
  const [caps, after] = keys.split(", ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {(caps ?? "").split(/\s+/).map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a key may repeat in one line.
        <Key key={i}>{k}</Key>
      ))}
      {after ? <span className="text-[12.5px] text-(--ui-ink-2)">{after}</span> : null}
    </span>
  );
}

/** One section of keys: its title, then each key beside what it does. */
export function KeyList({ section }: { section: KeySection }) {
  return (
    <section className="grid gap-2">
      <h3 className={GROUP_LABEL}>{section.title}</h3>
      <dl className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-2 text-[13.5px]">
        {section.keys.map(([k, what]) => (
          <div key={k} className="contents">
            <dt>
              <Keys keys={k} />
            </dt>
            <dd className="m-0 self-center text-(--ui-ink-2)">{what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Every key: the frame's, a list's, and the page's own. */
export function KeysSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const own = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85dvh] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard</DialogTitle>
          <DialogDescription>Keys work anywhere you aren't typing.</DialogDescription>
        </DialogHeader>
        {[FRAME_KEYS, LIST_KEYS, ...own].map((s) => (
          <KeyList key={s.title} section={s} />
        ))}
      </DialogContent>
    </Dialog>
  );
}

/** Not while typing, or with a modifier the browser or the OS owns. */
export const typingAt = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true]");
};

/**
 * The edge a panel is dragged by: its right border. Drag it, or focus it and use ← and →; past
 * the fold line it folds the panel, Enter folds or opens it, a double click puts the width back.
 * While dragging it sets `cssVar` on `host` alone, so nothing re-renders until it lets go.
 */
export function Resizer({
  label,
  width,
  shut,
  shutPx,
  range,
  host,
  cssVar,
  onDone,
  onReset,
  className,
  style,
}: {
  label: string;
  /** Its width open, kept while it's folded. */
  width: number;
  shut: boolean;
  /** Its width folded. */
  shutPx: number;
  range: { min: number; max: number; fold: number };
  host: () => HTMLElement | null;
  cssVar: string;
  onDone: (next: { width: number; shut: boolean }) => void;
  onReset: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const drag = useRef<{ x: number; from: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = shut ? shutPx : width;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, from: shown, last: shown };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = d.from + e.clientX - d.x;
    const at = dragged(d.last, range);
    host()?.style.setProperty(cssVar, `${at.shut ? shutPx : at.width}px`);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    // A click with no drag leaves it as it was.
    if (d && Math.abs(d.last - d.from) >= 2) onDone(dragged(d.last, range));
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const to =
      e.key === "ArrowLeft"
        ? shown - step
        : e.key === "ArrowRight"
          ? shown + step
          : e.key === "Home"
            ? range.min
            : e.key === "End"
              ? range.max
              : null;
    if (to !== null) {
      e.preventDefault();
      onDone({ width: Math.min(range.max, Math.max(range.min, to)), shut: false });
    } else if (e.key === "Enter") {
      e.preventDefault();
      onDone({ width, shut: !shut });
    }
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a splitter is a focusable separator (WAI-ARIA window splitter).
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={shown}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      {...tipProps(`${label}: drag, or double-click to reset`, { side: "right", as: "none" })}
      className={cx(
        "group/edge absolute top-0 bottom-0 z-20 w-2.5 cursor-col-resize touch-none outline-none max-[900px]:hidden",
        className,
      )}
      style={style}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={key}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-(--ui-focus) opacity-0 transition-opacity duration-150 ease-(--ui-ease) group-hover/edge:opacity-60 group-focus-visible/edge:opacity-100",
          dragging && "opacity-100",
        )}
      />
    </div>
  );
}

/** A choice of a few, side by side: radios under the hood, so the arrows and a reader work. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span aria-hidden="true" className="text-[12.5px] font-medium text-(--ui-ink-2)">
        {label}
      </span>
      <Seg
        label={label}
        fill
        value={value}
        items={options.map(([v, text]) => ({ value: v, label: text }))}
        onChange={onChange}
      />
    </div>
  );
}

const onOff = [
  ["on", "On"],
  ["off", "Off"],
] as const;

/** Every frame setting, in one column: the Layout popover and a settings page both draw it. */
export function DisplayPanel({
  control,
  more,
  onKeys,
}: {
  control: DisplayControl;
  /** Below the settings: a link to his own look, where there is one. */
  more?: ReactNode;
  onKeys?: (() => void) | undefined;
}) {
  const { display: d, set } = control;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Segmented
          label="Sidebar"
          value={d.sideShut ? "icons" : "full"}
          options={[
            ["full", "Full"],
            ["icons", "Icons"],
          ]}
          onChange={(v) => set({ sideShut: v === "icons" })}
        />
        <Segmented
          label="App's pages"
          value={d.pagesShut ? "off" : "on"}
          options={[
            ["on", "Shown"],
            ["off", "Hidden"],
          ]}
          onChange={(v) => set({ pagesShut: v === "off" })}
        />
      </div>
      <Segmented
        label="Rows"
        value={d.density}
        options={[
          ["roomy", "Roomy"],
          ["snug", "Snug"],
        ]}
        onChange={(density) => set({ density })}
      />
      <Segmented
        label="Text"
        value={d.text}
        options={[
          ["small", "Small"],
          ["normal", "Normal"],
          ["large", "Large"],
        ]}
        onChange={(text) => set({ text })}
      />
      <div className="grid grid-cols-3 gap-3">
        <Segmented
          label="Frame"
          value={d.frame ? "on" : "off"}
          options={onOff}
          onChange={(v) => set({ frame: v === "on" })}
        />
        <Segmented
          label="Counts"
          value={d.counts ? "on" : "off"}
          options={onOff}
          onChange={(v) => set({ counts: v === "on" })}
        />
        <Segmented
          label="Motion"
          value={d.motion === "less" ? "off" : "on"}
          options={[
            ["on", "Full"],
            ["off", "Less"],
          ]}
          onChange={(v) => set({ motion: v === "off" ? "less" : "system" })}
        />
      </div>
      <p className="text-[12.5px] text-(--ui-ink-2)">
        Drag a panel's edge to size it. <Key>[</Key> folds the sidebar, <Key>]</Key> hides the
        pages.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-(--ui-hair) pt-3 text-[13px]">
        {more}
        {onKeys ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-(--ui-ink-2) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:text-(--ui-ink)"
            onClick={onKeys}
          >
            <Icon name="keys" size={14} />
            All keys
          </button>
        ) : null}
        <button
          type="button"
          className="ml-auto border-0 bg-transparent p-0 text-(--ui-ink-2) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:text-(--ui-ink) disabled:no-underline disabled:opacity-50"
          disabled={!displayDiff(d)}
          onClick={() => set(null)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/** The Layout button and its popover, at the sidebar's foot. */
export function DisplayButton({
  control,
  more,
  onKeys,
  compact = false,
}: {
  control: DisplayControl;
  more?: ReactNode;
  onKeys?: () => void;
  /** The icon alone: a folded sidebar. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cx(
          "inline-flex h-8 items-center gap-1.5 rounded-(--ui-radius) border-0 bg-transparent px-2 text-[13px] font-medium text-(--ui-ink-2) transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-hover) hover:text-(--ui-ink) data-[popup-open]:bg-(--ui-hover) data-[popup-open]:text-(--ui-ink)",
          compact && "w-8 justify-center px-0",
        )}
        aria-label={compact ? "Layout" : undefined}
        {...(compact ? tipProps("Layout", { side: "right", as: "none" }) : {})}
      >
        <Icon name="sliders" />
        {compact ? null : "Layout"}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-[340px] p-4">
        <DisplayPanel
          control={control}
          more={more}
          onKeys={
            onKeys
              ? () => {
                  setOpen(false);
                  onKeys();
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
