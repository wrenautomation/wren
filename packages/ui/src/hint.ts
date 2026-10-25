/**
 * Hover text, the pure half. Any element that carries `data-tip` says that text after a short
 * rest of the pointer, or on keyboard focus (`HintLayer`, hint.tsx, draws it once for the whole
 * page). A caller writes `{...tipProps("Hide pages", { keys: "]" })}` and nothing else, so a table
 * of a thousand dates costs no more than one. No React.
 */

/** How long the pointer rests before the first tip shows, in ms. */
const HINT_DELAY = 400;
/** After a tip, the next one shows at once while the pointer moves along inside this many ms. */
const HINT_WARM = 300;

export type TipSide = "top" | "bottom" | "left" | "right";

export interface TipOptions {
  /** The key that does the same, shown beside the words ("]", "Esc", "⌥ ↓"). */
  keys?: string;
  /** Which side of the element it opens on; it flips if there is no room. Default below. */
  side?: TipSide;
  /** Say it only when the element's own text is cut short (an ellipsis or a clamp). */
  clip?: boolean;
  /**
   * What a screen reader makes of the words. `description` (the default) adds them to the element;
   * `name` makes them its name, for an icon alone; `none` leaves it to the element's own label or
   * text, which already says the same.
   */
  as?: "description" | "name" | "none";
}

/** The attributes that put `text` on hover and, for a screen reader, on the element. */
export interface TipProps {
  "data-tip"?: string;
  "data-tip-keys"?: string;
  "data-tip-side"?: TipSide;
  "data-tip-clip"?: "";
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-keyshortcuts"?: string;
}

/**
 * The props that give an element hover text. Nothing for empty text, so a caller passes what it
 * has and an absent tip is simply none. Spread them on any element or component that forwards
 * its props to the DOM.
 */
export function tipProps(text: string | undefined | null, o: TipOptions = {}): TipProps {
  if (!text) return {};
  return {
    "data-tip": text,
    ...(o.keys ? { "data-tip-keys": o.keys, "aria-keyshortcuts": ariaKeys(o.keys) } : {}),
    ...(o.side ? { "data-tip-side": o.side } : {}),
    ...(o.clip ? { "data-tip-clip": "" as const } : {}),
    ...(o.as === "name"
      ? { "aria-label": text }
      : o.as === "none"
        ? {}
        : { "aria-description": text }),
  };
}

/**
 * "⌥ ↓" or "⌘⌥M" as `aria-keyshortcuts` reads it ("Alt+ArrowDown", "Meta+Alt+M"); a plain key
 * stays as it is.
 */
export function ariaKeys(keys: string): string {
  return keys
    .split(" ")
    .flatMap((k) => {
      const mods: string[] = [];
      let rest = k;
      while (rest.length > 1 && KEY_NAMES[rest.slice(0, 1)]) {
        mods.push(KEY_NAMES[rest.slice(0, 1)] as string);
        rest = rest.slice(1);
      }
      return [...mods, KEY_NAMES[rest] ?? rest];
    })
    .join("+");
}
const KEY_NAMES: Record<string, string> = {
  "⌥": "Alt",
  "⌘": "Meta",
  "⌃": "Control",
  "⇧": "Shift",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  Esc: "Escape",
};

/** A box on screen. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a tip of `size` goes beside the `anchor` inside a `view`: on the asked side, flipped to the
 * other when that side has no room and the other does, centered on the anchor and kept `pad` from
 * the view's edges (so beside an anchor taller than the view it sits over it, in sight). Returns
 * the tip's top-left and the side it took.
 */
export function placeTip(
  anchor: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
  side: TipSide = "bottom",
  gap = 6,
  pad = 8,
): { left: number; top: number; side: TipSide } {
  const room: Record<TipSide, number> = {
    top: anchor.top - gap - pad,
    bottom: view.height - (anchor.top + anchor.height) - gap - pad,
    left: anchor.left - gap - pad,
    right: view.width - (anchor.left + anchor.width) - gap - pad,
  };
  const across = side === "top" || side === "bottom";
  const need = across ? size.height : size.width;
  const opposite: Record<TipSide, TipSide> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  const at = room[side] >= need || room[opposite[side]] < need ? side : opposite[side];
  const clamp = (n: number, span: number, limit: number) =>
    Math.max(pad, Math.min(n, limit - span - pad));
  const midX = anchor.left + anchor.width / 2 - size.width / 2;
  const midY = anchor.top + anchor.height / 2 - size.height / 2;
  switch (at) {
    case "top":
      return {
        side: at,
        left: clamp(midX, size.width, view.width),
        top: clamp(anchor.top - gap - size.height, size.height, view.height),
      };
    case "bottom":
      return {
        side: at,
        left: clamp(midX, size.width, view.width),
        top: clamp(anchor.top + anchor.height + gap, size.height, view.height),
      };
    case "left":
      return {
        side: at,
        left: clamp(anchor.left - gap - size.width, size.width, view.width),
        top: clamp(midY, size.height, view.height),
      };
    case "right":
      return {
        side: at,
        left: clamp(anchor.left + anchor.width + gap, size.width, view.width),
        top: clamp(midY, size.height, view.height),
      };
  }
}

/** What the page gives the flow: timers, a clock, and the two things it does. */
interface HintHost<T> {
  now(): number;
  /** Runs `fn` after `ms`; the return cancels it. */
  after(ms: number, fn: () => void): () => void;
  show(target: T): void;
  hide(): void;
}

/**
 * When a tip shows and hides, apart from the page: aim at an element and it shows after a rest;
 * aim at another while one shows (or just after) and it shows at once; aim at nothing, or press, and
 * it goes. After a press it stays gone until the pointer leaves the element, so a click does not
 * bring it back.
 */
export function hintFlow<T>(host: HintHost<T>, delay = HINT_DELAY, warm = HINT_WARM) {
  let target: T | null = null;
  let cancel: (() => void) | null = null;
  let open = false;
  let closedAt = Number.NEGATIVE_INFINITY;
  const stop = () => {
    cancel?.();
    cancel = null;
  };
  const close = () => {
    stop();
    if (!open) return;
    open = false;
    closedAt = host.now();
    host.hide();
  };
  return {
    /** The element the pointer or the focus is on now, or null for none. */
    aim(next: T | null) {
      if (next === target) return;
      stop();
      target = next;
      if (next === null) return close();
      const go = () => {
        cancel = null;
        open = true;
        host.show(next);
      };
      if (open || host.now() - closedAt < warm) go();
      else cancel = host.after(delay, go);
    },
    /** A press, a scroll, Escape: the tip goes and stays gone for this element. */
    dismiss: close,
    get open() {
      return open;
    },
    get target() {
      return target;
    },
  };
}

/** The viewer's zone as a short generic name ("ET"), for a time that names its zone. */
function zoneName(d: Date, zone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "shortGeneric",
    ...(zone ? { timeZone: zone } : {}),
  }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/**
 * A moment in full on hover: "Sep 30, 2026, 5:08 PM ET · 3 days ago". A bare day (midnight, no
 * time) shows without the time or the zone. `zone` is the viewer's by default.
 */
export function whenTip(d: Date, relative: string, zone?: string): string {
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString("en-US", { ...o, ...(zone ? { timeZone: zone } : {}) });
  const hms = fmt({ hour: "numeric", minute: "numeric", second: "numeric", hour12: false });
  const bare = /^(24|00):00:00$/.test(hms);
  const full = bare
    ? fmt({ dateStyle: "medium" })
    : `${fmt({ dateStyle: "medium", timeStyle: "short" })} ${zoneName(d, zone)}`.trim();
  return `${full} · ${relative}`;
}
