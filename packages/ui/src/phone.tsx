/**
 * A phone's own moves, as iOS makes them: a sheet that rests at half or full height and follows
 * the finger, rows that swipe to their actions, pull to refresh, and the segmented control. Each
 * move tracks a real touch and settles on transform alone. Reduced motion keeps the gestures and
 * drops the travel: the stylesheet strips transform transitions, so everything lands at once.
 */

import { cn } from "cn";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Busy } from "./busy.js";
import { refreshAll } from "./data/query.js";
import { num } from "./format.js";
import { tipProps } from "./hint.js";
import { rubber, settle, swipeEnd } from "./phone-nav.js";

/** Apple's sheet curve: quick off the mark, long soft landing. */
export const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SETTLE_MS = 420;
/** A touch this close to the left edge is the system's back swipe: rows and pulls leave it be. */
export const EDGE = 24;

/** Motion turned down here, by the device or by Layout's "Less". */
export const still = () =>
  typeof window !== "undefined" &&
  (matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.motion === "less");

/**
 * Back to `to`: one step back when the last move came from there (so the browser's history stays
 * as he walked it), else a swap to it.
 */
export function goBack(to: string, go: (to: string, replace?: boolean) => void) {
  const from = (history.state as { from?: unknown } | null)?.from;
  if (from === to) history.back();
  else go(to, true);
}

// --- Sheets ---------------------------------------------------------------------------------

export type Stop = "medium" | "large";

const SheetContext = createContext<{ close: () => void } | null>(null);
/** Inside a sheet: shuts it with its slide down. */
export const useSheet = () => useContext(SheetContext);

/**
 * A sheet from the bottom of a phone: a grabber, a head that drags it, then what scrolls. It
 * rests at half height (`medium`) or full (`large`); a drag or a flick moves it between them, and
 * past the lowest it shuts. With its content scrolled to the top, pulling the content down drags
 * the sheet too, and pushing it up at half height opens it full, as iOS does.
 */
export function BottomSheet({
  label,
  onClose,
  stops = ["medium", "large"],
  start,
  head,
  children,
  modal = true,
  escape: shutsOnEscape = true,
  className,
  bodyClassName,
}: {
  label: string;
  /** After it slid away. */
  onClose: () => void;
  stops?: readonly Stop[];
  start?: Stop | undefined;
  /** Under the grabber, and dragged with it. */
  head?: ReactNode;
  children: ReactNode;
  /** It holds the focus and dims what's under it. */
  modal?: boolean;
  /** Escape shuts it; off where the page takes Escape itself (a list's open record). */
  escape?: boolean;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}) {
  const sheet = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  const stop = useRef<Stop>(start ?? stops[0] ?? "large");
  const at = useRef(0);
  const shutting = useRef(false);
  const [mounted, setMounted] = useState(false);

  /** The sheet's height, and where each stop puts its top edge (0 is full height). */
  const geometry = useCallback(() => {
    const h = sheet.current?.offsetHeight ?? innerHeight;
    const medium = Math.max(0, Math.round(h - innerHeight * 0.52));
    return { h, of: (s: Stop) => (s === "large" ? 0 : medium), medium };
  }, []);

  const place = useCallback(
    (y: number, ms = 0) => {
      const el = sheet.current;
      if (!el) return;
      at.current = y;
      const g = geometry();
      const ease = ms ? `transform ${ms}ms ${SPRING}` : "none";
      el.style.transition = ease;
      el.style.transform = `translate3d(0, ${y}px, 0)`;
      // The record's action bar stays at the thumb down to half height, then rides along.
      el.style.setProperty("--sheet-y", `${Math.max(0, y)}px`);
      el.style.setProperty("--sheet-mid", `${g.medium}px`);
      el.style.setProperty("--sheet-t", `${ms}ms`);
      const s = scrim.current;
      if (s) {
        s.style.transition = ms ? `opacity ${ms}ms ${SPRING}` : "none";
        // Dimmest at full height, lighter at half, gone as it leaves.
        const open = g.h ? 1 - Math.min(1, Math.max(0, y) / g.h) : 1;
        s.style.opacity = String(open);
      }
    },
    [geometry],
  );

  const close = useCallback(() => {
    if (shutting.current) return;
    shutting.current = true;
    if (still()) return done.current();
    place(geometry().h + 16, SETTLE_MS);
    setTimeout(() => done.current(), SETTLE_MS - 60);
  }, [geometry, place]);

  // In from below, to its first stop.
  useLayoutEffect(() => {
    setMounted(true);
  }, []);
  useLayoutEffect(() => {
    if (!mounted) return;
    const g = geometry();
    if (still()) return place(g.of(stop.current));
    place(g.h);
    const raf = requestAnimationFrame(() => place(g.of(stop.current), SETTLE_MS));
    return () => cancelAnimationFrame(raf);
  }, [mounted, geometry, place]);

  // The focus goes in, and comes back where it was when the sheet goes.
  useEffect(() => {
    if (!mounted || !modal) return;
    const was = document.activeElement as HTMLElement | null;
    sheet.current?.focus({ preventScroll: true });
    return () => was?.focus?.({ preventScroll: true });
  }, [mounted, modal]);

  useEffect(() => {
    if (!shutsOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A popup open inside takes its own Escape first.
      if (document.querySelector("[data-slot=popover-content]")) return;
      e.preventDefault();
      close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [shutsOnEscape, close]);

  // Drags: touch on a phone, a mouse on the grabber anywhere.
  useEffect(() => {
    const el = sheet.current;
    if (!el || !mounted) return;
    const g = {
      mode: "" as "" | "drag" | "no",
      x0: 0,
      y0: 0,
      base: 0,
      lastY: 0,
      lastT: 0,
      v: 0,
      handle: false,
      body: null as HTMLElement | null,
    };
    const begin = (x: number, y: number, t: number, target: EventTarget | null) => {
      const on = target instanceof Element ? target : null;
      g.mode = "";
      g.x0 = x;
      g.y0 = y;
      g.base = at.current;
      g.lastY = y;
      g.lastT = t;
      g.v = 0;
      g.handle = !!on?.closest("[data-sheet-handle]");
      g.body = on?.closest<HTMLElement>("[data-sheet-body]") ?? null;
    };
    /** True once the move is the sheet's. */
    const follow = (x: number, y: number, t: number): boolean => {
      if (g.mode === "no") return false;
      const dx = x - g.x0;
      const dy = y - g.y0;
      if (!g.mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return false;
        if (Math.abs(dx) > Math.abs(dy)) {
          g.mode = "no";
          return false;
        }
        const top = !g.body || g.body.scrollTop <= 0;
        const highest = stops.includes("large") ? "large" : stops[0];
        g.mode =
          g.handle || (top && dy > 0) || (top && dy < 0 && stop.current !== highest)
            ? "drag"
            : "no";
        if (g.mode === "no") return false;
        g.y0 = y;
      }
      let to = g.base + (y - g.y0);
      const least = geometry().of(stops.includes("large") ? "large" : (stops[0] ?? "large"));
      if (to < least) to = least - rubber(least - to);
      place(to);
      const dt = t - g.lastT;
      if (dt > 0) g.v = ((y - g.lastY) / dt) * 0.8 + g.v * 0.2;
      g.lastY = y;
      g.lastT = t;
      return true;
    };
    const release = () => {
      if (g.mode !== "drag") {
        g.mode = "";
        return;
      }
      g.mode = "";
      const geo = geometry();
      const spots = stops.map((s) => ({ s, y: geo.of(s) }));
      const y = settle(at.current, g.v, [...spots.map((p) => p.y), geo.h]);
      const hit = spots.find((p) => p.y === y);
      if (!hit) return close();
      stop.current = hit.s;
      place(hit.y, SETTLE_MS);
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) {
        g.mode = "no";
        return;
      }
      begin(t.clientX, t.clientY, e.timeStamp, e.target);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && follow(t.clientX, t.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (!(e.target instanceof Element) || !e.target.closest("[data-sheet-handle]")) return;
      if (e.target.closest("a, button, input, select, textarea")) return;
      begin(e.clientX, e.clientY, e.timeStamp, e.target);
      const move = (m: PointerEvent) => {
        if (follow(m.clientX, m.clientY, m.timeStamp)) m.preventDefault();
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        release();
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", release);
    el.addEventListener("touchcancel", release);
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", release);
      el.removeEventListener("touchcancel", release);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [mounted, stops, geometry, place, close]);

  // A turned phone or a keyboard: the sheet keeps its stop at the new size.
  useEffect(() => {
    const again = () => !shutting.current && place(geometry().of(stop.current));
    addEventListener("resize", again);
    return () => removeEventListener("resize", again);
  }, [geometry, place]);

  if (!mounted) return null;
  return createPortal(
    <SheetContext.Provider value={{ close }}>
      {modal ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the dimmed page; Escape and the grabber shut it too.
        // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
        <div
          ref={scrim}
          className="fixed inset-0 z-40 touch-none bg-(--ui-scrim)"
          style={{ opacity: 0 }}
          onClick={close}
        />
      ) : null}
      <section
        ref={sheet}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={label}
        tabIndex={-1}
        data-sheet=""
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[calc(100dvh-env(safe-area-inset-top)-10px)] w-full max-w-[640px] flex-col overflow-hidden border-t border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink) shadow-(--ui-shadow) outline-none will-change-transform sm:border-x",
          className,
        )}
        style={{ transform: "translate3d(0, 100%, 0)" }}
      >
        <div data-sheet-handle="" className="flex-none cursor-grab touch-none select-none">
          <div className="mx-auto mt-2 mb-1 h-[5px] w-9 rounded-full bg-(--ui-ink-3) opacity-50" />
          {head}
        </div>
        <div
          data-sheet-body=""
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </section>
    </SheetContext.Provider>,
    document.body,
  );
}

// --- Swipe rows -----------------------------------------------------------------------------

/** One button behind a row: what a swipe shows, and runs when swiped all the way. */
export interface SwipeAct {
  id: string;
  label: string;
  tone: "accent" | "bad" | "ink" | "warn";
  run: () => void;
}

/** A row's buttons: one under a swipe right, up to two under a swipe left. */
export interface Swipes {
  lead?: SwipeAct | undefined;
  /** The far one first: a full swipe left runs it. */
  trail: SwipeAct[];
}

const REVEAL = 84;
const TONE: Record<SwipeAct["tone"], string> = {
  accent: "bg-(--ui-primary) text-(--ui-on-accent)",
  bad: "bg-(--ui-bad) text-white",
  ink: "bg-(--ui-ink-2) text-(--ui-paper)",
  warn: "bg-(--ui-warn) text-white",
};

const OPENED = "ui-swipe-opened";

/**
 * A row that swipes sideways to its actions, as Mail's do: right shows the first, left the rest.
 * A swipe past the line runs the far one; a short one leaves the buttons out to tap. A tap on an
 * open row shuts it. Up and down still scroll; a touch at the left edge is the back swipe's.
 */
export function SwipeRow({
  swipes,
  className,
  onTap,
  children,
  measure,
  ...rest
}: {
  swipes: Swipes | null;
  className?: string | undefined;
  onTap?: ((e: React.MouseEvent<HTMLLIElement>) => void) | undefined;
  children: ReactNode;
  /** Told the row's element: a long list measures each row it draws. */
  measure?: ((el: HTMLLIElement | null) => void) | undefined;
} & Omit<React.LiHTMLAttributes<HTMLLIElement>, "onClick" | "className">) {
  const li = useRef<HTMLLIElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLButtonElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const x = useRef(0);
  const acts = useRef(swipes);
  acts.current = swipes;
  const has = !!swipes && (!!swipes.lead || swipes.trail.length > 0);

  const move = useCallback((to: number, ms = 0) => {
    x.current = to;
    const ease = ms ? `transform ${ms}ms ${SPRING}, width ${ms}ms ${SPRING}` : "none";
    if (face.current) {
      face.current.style.transition = ease;
      face.current.style.transform = to ? `translate3d(${to}px, 0, 0)` : "";
    }
    if (lead.current) {
      lead.current.style.transition = ease;
      lead.current.style.width = `${Math.max(0, to)}px`;
    }
    if (trail.current) {
      trail.current.style.transition = ease;
      trail.current.style.width = `${Math.max(0, -to)}px`;
    }
  }, []);

  useEffect(() => {
    const el = li.current;
    if (!el || !has) return;
    const g = { mode: "" as "" | "swipe" | "no", x0: 0, y0: 0, base: 0, lastX: 0, lastT: 0, v: 0 };
    const shownOf = (dir: number) =>
      dir > 0 ? REVEAL : REVEAL * Math.max(1, acts.current?.trail.length ?? 1);
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || t.clientX < EDGE) {
        g.mode = "no";
        return;
      }
      g.mode = "";
      g.x0 = t.clientX;
      g.y0 = t.clientY;
      g.base = x.current;
      g.lastX = t.clientX;
      g.lastT = e.timeStamp;
      g.v = 0;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || g.mode === "no") return;
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = "no";
          return;
        }
        g.mode = "swipe";
        g.x0 = t.clientX;
        dispatchEvent(new CustomEvent(OPENED, { detail: el }));
      }
      if (e.cancelable) e.preventDefault();
      let to = g.base + (t.clientX - g.x0);
      const s = acts.current;
      // No button that way: it only gives a little.
      if (to > 0 && !s?.lead) to = rubber(to, 24);
      if (to < 0 && !s?.trail.length) to = -rubber(-to, 24);
      move(to);
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) g.v = ((t.clientX - g.lastX) / dt) * 0.8 + g.v * 0.2;
      g.lastX = t.clientX;
      g.lastT = e.timeStamp;
    };
    const onEnd = () => {
      if (g.mode !== "swipe") {
        g.mode = "";
        return;
      }
      g.mode = "";
      const s = acts.current;
      const to = x.current;
      const dir = Math.sign(to);
      const act = dir > 0 ? s?.lead : s?.trail[0];
      if (!act) return move(0, 300);
      const end = swipeEnd(to, g.v, el.offsetWidth, shownOf(dir));
      if (end === "full") {
        move(dir * el.offsetWidth, 260);
        setTimeout(
          () => {
            act.run();
            move(0);
          },
          still() ? 0 : 240,
        );
      } else if (end === "open") move(dir * shownOf(dir), 300);
      else move(0, 300);
    };
    // Another row opening, or a scroll, shuts this one.
    const others = (e: Event) => {
      if ((e as CustomEvent).detail !== el && x.current) move(0, 300);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    addEventListener(OPENED, others);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      removeEventListener(OPENED, others);
    };
  }, [has, move]);

  const button = (a: SwipeAct, fill = false) => (
    <button
      key={a.id}
      type="button"
      tabIndex={-1}
      className={cn(
        "flex h-full min-w-0 items-center justify-center overflow-hidden border-0 px-3 text-[13px] font-semibold whitespace-nowrap",
        fill ? "flex-1" : "w-[84px] flex-none",
        TONE[a.tone],
      )}
      onClick={(e) => {
        e.stopPropagation();
        move(0, 300);
        a.run();
      }}
    >
      {a.label}
    </button>
  );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the row's title is its link; this widens the tap.
    <li
      ref={(el) => {
        li.current = el;
        measure?.(el);
      }}
      {...rest}
      className={cn("relative overflow-hidden", className)}
      onClick={(e) => {
        // Open on its buttons, a tap anywhere shuts it.
        if (x.current) {
          e.preventDefault();
          move(0, 300);
          return;
        }
        onTap?.(e);
      }}
    >
      {has && swipes?.lead ? (
        <button
          ref={lead}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start overflow-hidden border-0 px-5 text-[13px] font-semibold whitespace-nowrap",
            TONE[swipes.lead.tone],
          )}
          style={{ width: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            move(0, 300);
            swipes.lead?.run();
          }}
        >
          {swipes.lead.label}
        </button>
      ) : null}
      {has && swipes?.trail.length ? (
        <div
          ref={trail}
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex flex-row-reverse overflow-hidden"
          style={{ width: 0 }}
        >
          {swipes.trail.map((a, i) => button(a, i === 0))}
        </div>
      ) : null}
      <div ref={face} data-face="" className="relative bg-(--ui-paper)">
        {children}
      </div>
    </li>
  );
}

/** A tone for an action by what it does: stopping ones read red, the rest neutral. */
export const toneOf = (label: string, first: boolean): SwipeAct["tone"] =>
  first
    ? "accent"
    : /skip|reject|delete|remove|archive|pass|dismiss|decline|stop|cancel|block/i.test(label)
      ? "bad"
      : "ink";

// --- Pull to refresh ------------------------------------------------------------------------

/** Where a touch landed: a sheet, a dialog, or something that scrolls itself. */
const ownScroll = (t: EventTarget | null) => {
  if (!(t instanceof Element)) return true;
  if (t.closest("[role=dialog], [data-sheet], [data-no-pull], input, textarea, select"))
    return true;
  for (let e: Element | null = t; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollTop > 0) return true;
  }
  return false;
};

const PULL_ARM = 56;
const PULL_MAX = 84;

/**
 * Pull the page down at its top to read it again: a mark comes down with the finger, turns as it
 * nears the line, and spins while the reads run. The page's own bounce still shows.
 */
export function PullToRefresh({ on, top }: { on: boolean; top: string }) {
  const mark = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!on) return;
    const g = { mode: "" as "" | "pull" | "no", y0: 0, x0: 0, pull: 0 };
    const show = (pull: number, ms = 0) => {
      const el = mark.current;
      if (!el) return;
      g.pull = pull;
      el.style.transition = ms ? `transform ${ms}ms ${SPRING}, opacity ${ms}ms` : "none";
      el.style.transform = `translate3d(-50%, ${pull - 40}px, 0) rotate(${pull * 4}deg)`;
      el.style.opacity = String(Math.min(1, pull / PULL_ARM));
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      g.mode =
        busyRef.current ||
        e.touches.length !== 1 ||
        !t ||
        t.clientX < EDGE ||
        scrollY > 0 ||
        ownScroll(e.target)
          ? "no"
          : "";
      if (t) {
        g.y0 = t.clientY;
        g.x0 = t.clientX;
      }
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || g.mode === "no") return;
      const dy = t.clientY - g.y0;
      if (!g.mode) {
        if (Math.abs(dy) < 6 && Math.abs(t.clientX - g.x0) < 6) return;
        g.mode =
          dy > 0 && Math.abs(dy) > Math.abs(t.clientX - g.x0) && scrollY <= 0 ? "pull" : "no";
        if (g.mode === "no") return;
      }
      show(Math.min(PULL_MAX, Math.max(0, dy) * 0.5));
    };
    const onEnd = () => {
      if (g.mode !== "pull") return;
      g.mode = "";
      if (g.pull < PULL_ARM) return show(0, 300);
      show(PULL_ARM, 200);
      busyRef.current = true;
      setBusy(true);
      const least = new Promise((r) => setTimeout(r, 600));
      Promise.all([refreshAll(), least]).finally(() => {
        busyRef.current = false;
        setBusy(false);
        show(0, 300);
      });
    };
    addEventListener("touchstart", onStart, { passive: true });
    addEventListener("touchmove", onMove, { passive: true });
    addEventListener("touchend", onEnd);
    addEventListener("touchcancel", onEnd);
    return () => {
      removeEventListener("touchstart", onStart);
      removeEventListener("touchmove", onMove);
      removeEventListener("touchend", onEnd);
      removeEventListener("touchcancel", onEnd);
    };
  }, [on]);
  if (!on) return null;
  return (
    <div
      ref={mark}
      role="status"
      aria-label={busy ? "Refreshing" : undefined}
      className="pointer-events-none fixed left-1/2 z-20 grid size-9 place-items-center rounded-full border border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink-2) shadow-(--ui-shadow)"
      style={{ top, opacity: 0, transform: "translate3d(-50%, -40px, 0)" }}
    >
      {/* The ring shows still while it pulls, and turns once the page reads again. */}
      <span className="grid place-items-center [&>.ui-busy]:opacity-100">
        <Busy on={busy} size="step" />
      </span>
    </div>
  );
}

// --- Segmented control ----------------------------------------------------------------------

export interface Segment {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
  on: boolean;
  /** Its data still reads: the ring turns after the label. Set it to keep the slot. */
  busy?: boolean | undefined;
  /** What it keeps, in words, on hover (a narrow desktop window). */
  tip?: string | undefined;
}

/**
 * The iOS segmented control: one track, the choice on screen raised out of it. Each segment is a
 * link (the address is the state). Too many to fit, the track scrolls sideways, the one on
 * screen scrolled into view.
 */
export function Segmented({
  label,
  items,
  className,
}: {
  label: string;
  items: Segment[];
  className?: string | undefined;
}) {
  const track = useRef<HTMLDivElement>(null);
  const on = items.find((i) => i.on)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new choice scrolls again.
  useEffect(() => {
    const el = track.current;
    const hit = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (!el || !hit || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = hit.offsetLeft - (el.clientWidth - hit.offsetWidth) / 2;
  }, [on]);
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <div
        ref={track}
        className="flex overflow-x-auto rounded-lg bg-(--ui-fill) p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((i) => (
          <a
            key={i.id}
            href={i.href}
            aria-current={i.on ? "page" : undefined}
            {...tipProps(i.tip)}
            className="flex min-h-9 min-w-fit flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[14px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline transition-[background-color,color,box-shadow] duration-200 ease-(--ui-ease) aria-[current=page]:bg-(--ui-paper) aria-[current=page]:font-semibold aria-[current=page]:text-(--ui-ink) aria-[current=page]:shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_var(--ui-hair)]"
          >
            {i.label}
            {i.count !== undefined ? (
              <span className="text-[12.5px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
                {num(i.count)}
              </span>
            ) : null}
            {i.busy === undefined ? null : <Busy on={i.busy} />}
          </a>
        ))}
      </div>
    </nav>
  );
}
