/**
 * A board: lanes of cards (aerie D16 "Board"). Wide: lanes side by side, the board fills what is left of
 * the page's height and each lane scrolls itself, so a lane of 400 draws only the cards in its view
 * (`useLines` on the lane). A shut lane is a 44 px strip. Narrow: a strip of lanes picks one, and the
 * page scrolls it. A card is a link: a plain click opens it in place, a modified one in a new tab.
 * Moving cards is a later prop; without it the board reads only.
 */

import { cn } from "cn";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { CHIP } from "./filter-bar.js";
import { Icon } from "./icons.js";
import { Pill } from "./rows.js";
import { TabBar } from "./tab-bar.js";
import { scrollerOf, useLines } from "./table.js";

export interface BoardCard<T> {
  /** unique on the board: a card in two lanes keys `id@lane` */
  key: string;
  item: T;
}

export interface BoardLane<T> {
  /** its fold key */
  key: string;
  label: string;
  color?: string | undefined;
  cards: BoardCard<T>[];
  /** what an empty lane says: "No tasks" */
  empty: string;
}

export interface BoardProps<T> {
  /** what the cards are, for a screen reader: "tasks" */
  label: string;
  lanes: BoardLane<T>[];
  /** a card's face */
  card: (item: T) => ReactNode;
  href: (item: T) => string;
  /** the open card (its key) and what a plain click does */
  open: { id: string | null; onOpen: (item: T) => void };
  /** shut lanes (wide only) */
  shut: ReadonlySet<string>;
  onShut: (key: string) => void;
  /** a card that changed behind the viewer washes once */
  changed?: ((item: T) => boolean) | undefined;
  onSettled?: (() => void) | undefined;
  narrow: boolean;
}

const LANE_W = 288;
const STRIP_W = 44;
/** least height a wide board keeps when the window is short: the page scrolls past it */
const LEAST = 420;
const FADE = "animate-[ui-fade_150ms_var(--ui-ease)] motion-reduce:animate-none";
// DESIGN.md cards: the panel leaf, paper, raise; one hover signal (a fill)
const CARD =
  "group/card block rounded-(--ui-leaf-panel) bg-(--ui-paper) p-3 text-(--ui-ink) no-underline shadow-(--ui-raise) transition-[background-color] duration-150 ease-(--ui-ease) hover:bg-[color-mix(in_srgb,var(--ui-accent)_4%,var(--ui-paper))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) motion-reduce:transition-none";
const CARD_OPEN = "bg-[color-mix(in_srgb,var(--ui-ink)_5%,var(--ui-paper))]!";

/** a plain click opens in place; a modified one keeps the link's own way (new tab, window) */
function plain(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** the board's height: from its top to the bottom of what scrolls the page, at the top of the page */
function useFill(el: HTMLElement | null, on: boolean) {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!on || !el) return;
    const sc = scrollerOf(el);
    const size = () => {
      const bottom = sc === "window" ? innerHeight : sc.getBoundingClientRect().bottom;
      const top = el.getBoundingClientRect().top + (sc === "window" ? 0 : sc.scrollTop);
      const pad =
        sc === "window" ? 16 : Number.parseFloat(getComputedStyle(sc).paddingBottom) || 16;
      setH(Math.max(LEAST, Math.round(bottom - top - pad)));
    };
    size();
    // the bar above can wrap (pills); the window can resize
    const ro = new ResizeObserver(size);
    if (el.parentElement) ro.observe(el.parentElement);
    if (sc !== "window") ro.observe(sc);
    addEventListener("resize", size);
    return () => {
      ro.disconnect();
      removeEventListener("resize", size);
    };
  }, [el, on]);
  return h;
}

function Card<T>({
  c,
  p,
  index,
  measure,
}: {
  c: BoardCard<T>;
  p: BoardProps<T>;
  index: number;
  measure: (el: Element | null) => void;
}) {
  const isOpen = p.open.id === c.key;
  const washes = p.changed?.(c.item) ?? false;
  return (
    <li data-index={index} ref={measure} className="pb-2">
      <a
        href={p.href(c.item)}
        aria-current={isOpen ? "true" : undefined}
        onClick={(e) => {
          if (!plain(e)) return;
          e.preventDefault();
          p.open.onOpen(c.item);
        }}
        onAnimationEnd={(e) => {
          if (e.animationName === "ui-changed") p.onSettled?.();
        }}
        className={cn(CARD, isOpen && CARD_OPEN, washes && "animate-ui-changed")}
      >
        {p.card(c.item)}
      </a>
    </li>
  );
}

/** a lane's cards: past the kit's threshold only those in view of `scroller` draw */
function Cards<T>({
  lane,
  p,
  scroller,
}: {
  lane: BoardLane<T>;
  p: BoardProps<T>;
  scroller: HTMLElement | "window" | null;
}) {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const root = useCallback(() => list, [list]);
  const lines = useLines({ count: lane.cards.length, scroller, root, estimate: 112 });
  if (!lane.cards.length)
    return <p className="m-0 px-1 py-2 text-[13px] text-(--ui-ink-3)">{lane.empty}</p>;
  return (
    <ul ref={setList} className="m-0 list-none p-0" aria-label={`${lane.label}: ${p.label}`}>
      {lines.before ? <li aria-hidden style={{ height: lines.before }} /> : null}
      {lines.shown.map((n) => {
        const c = lane.cards[n];
        return c ? <Card key={c.key} c={c} p={p} index={n} measure={lines.measure} /> : null;
      })}
      {lines.after ? <li aria-hidden style={{ height: lines.after }} /> : null}
    </ul>
  );
}

function Count({ n }: { n: number }) {
  return <b className="flex-none font-semibold text-(--ui-ink) tabular-nums">{n}</b>;
}

function Lane<T>({ lane, p }: { lane: BoardLane<T>; p: BoardProps<T> }) {
  const shut = p.shut.has(lane.key);
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  // opened by the viewer: once wide, the lane scrolls whole into the board's view
  const reveal = useRef(false);
  const toggle = () => {
    reveal.current = shut;
    p.onShut(lane.key);
  };
  const show = (el: Element, smooth: boolean) => {
    reveal.current = false;
    el.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: smooth ? "smooth" : "auto",
    });
  };
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    // reduced motion: no width transition, so no transitionend
    const el = section.current;
    if (!shut && reveal.current && el && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reveal.current = false;
      el.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }, [shut]);
  return (
    <section
      ref={section}
      aria-label={lane.label}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width" && reveal.current)
          show(e.currentTarget, true);
      }}
      style={{ width: shut ? STRIP_W : LANE_W } as CSSProperties}
      className="flex h-full flex-none flex-col rounded-(--ui-leaf-panel) bg-(--ui-fill) transition-[width] duration-200 ease-(--ui-ease) motion-reduce:transition-none"
    >
      {shut ? (
        <button
          type="button"
          aria-expanded={false}
          aria-label={`${lane.label}, ${lane.cards.length}`}
          onClick={toggle}
          className={cn(
            FADE,
            "flex h-full w-full cursor-pointer flex-col items-center gap-2.5 rounded-(--ui-leaf-panel) border-0 bg-transparent px-0 pt-3.5 text-[13px] text-(--ui-ink-3) select-none hover:bg-(--ui-accent-wash) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-focus)",
          )}
        >
          <Icon name="down" size={15} className="-rotate-90 [stroke-width:1.8]" />
          <Count n={lane.cards.length} />
          <Pill color={lane.color} className="[writing-mode:vertical-rl]">
            {lane.label}
          </Pill>
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-expanded
            onClick={toggle}
            className="flex w-full flex-none cursor-pointer items-center gap-2.5 rounded-t-(--ui-leaf-panel) border-0 bg-transparent px-3 pt-3 pb-2 text-left text-[13px] text-(--ui-ink-3) select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-focus)"
          >
            <Icon name="down" size={15} className="[stroke-width:1.8]" />
            <Pill color={lane.color} className="min-w-0 shrink">
              {lane.label}
            </Pill>
            <Count n={lane.cards.length} />
          </button>
          <div
            ref={setScroll}
            className={cn(
              FADE,
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 [scrollbar-width:thin]",
            )}
          >
            <Cards lane={lane} p={p} scroller={scroll} />
          </div>
        </>
      )}
    </section>
  );
}

/** narrow: the strip picks a lane; the page scrolls its cards */
function OneLane<T>({ p }: { p: BoardProps<T> }) {
  const [picked, setPicked] = useState<string | null>(null);
  // no pick yet: the first lane with cards, never an empty To Do over a full lane
  const lane =
    p.lanes.find((l) => l.key === picked) ?? p.lanes.find((l) => l.cards.length) ?? p.lanes[0];
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const scroller = panel ? scrollerOf(panel) : null;
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const at = lane?.key;
  const first = useRef(true);
  useLayoutEffect(() => {
    // the picked tab sits whole in the strip (first paint: no motion)
    const tab = at && strip?.querySelector<HTMLElement>(`[data-lane="${CSS.escape(at)}"]`);
    if (!strip || !tab) return;
    const left = tab.offsetLeft; // the sticky strip is the offset parent
    const right = left + tab.offsetWidth;
    const pad = 16;
    const to =
      left - pad < strip.scrollLeft
        ? left - pad
        : right + pad > strip.scrollLeft + strip.clientWidth
          ? right + pad - strip.clientWidth
          : null;
    if (to !== null) strip.scrollTo({ left: to, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [strip, at]);
  if (!lane) return null;
  return (
    <div className="grid min-w-0 gap-2">
      <div
        ref={setStrip}
        role="tablist"
        aria-label="Lanes"
        onKeyDown={(e) => {
          // the tab pattern: ← → move the pick and the focus
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const at = p.lanes.indexOf(lane);
          const next = p.lanes[(at + step + p.lanes.length) % p.lanes.length];
          if (!next) return;
          setPicked(next.key);
          e.currentTarget
            .querySelector<HTMLElement>(`[data-lane="${CSS.escape(next.key)}"]`)
            ?.focus();
        }}
        className="sticky top-(--phone-bar,0px) z-2 -mx-4 flex gap-1 overflow-x-auto bg-(--ui-paper) px-4 py-1.5 [scrollbar-width:none]"
      >
        {p.lanes.map((l) => {
          const on = l.key === lane.key;
          return (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-label={`${l.label}, ${l.cards.length}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              data-lane={l.key}
              onClick={() => setPicked(l.key)}
              className={cn(CHIP, "relative isolate", on && "text-(--ui-active)")}
            >
              {on ? <TabBar row="board-lanes" /> : null}
              <span
                aria-hidden
                className="size-2 flex-none rounded-full"
                style={{ background: l.color ?? "var(--ui-ink-3)" }}
              />
              {l.label}
              <span className="tabular-nums text-(--ui-ink-3)">{l.cards.length}</span>
            </button>
          );
        })}
      </div>
      <div key={lane.key} ref={setPanel} role="tabpanel" aria-label={lane.label} className={FADE}>
        <Cards lane={lane} p={p} scroller={scroller} />
      </div>
    </div>
  );
}

/** placeholder lanes: one on a phone; wide, three at the board's full height */
function LoadingLanes({ narrow }: { narrow: boolean }) {
  return Array.from({ length: narrow ? 1 : 3 }, (_, i) => (
    <div
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
      key={i}
      style={{ width: narrow ? "100%" : LANE_W }}
      className={cn(
        "grid flex-none content-start gap-2 rounded-(--ui-leaf-panel) bg-(--ui-fill) p-2",
        !narrow && "h-full",
      )}
    >
      <Skeleton className="m-1 h-5 w-24" />
      {[0, 1, 2].map((k) => (
        <div key={k} className="grid gap-2 rounded-(--ui-leaf-panel) bg-(--ui-paper) p-3">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-11/12" />
        </div>
      ))}
    </div>
  ));
}

/** The board: see the file's head. `lanes` null: it is loading. */
export function Board<T>(p: Omit<BoardProps<T>, "lanes"> & { lanes: BoardLane<T>[] | null }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // loading fills the same height, so the lanes land without a jump
  const height = useFill(root, !p.narrow);
  const loading = !p.lanes;
  const q = p as BoardProps<T>;
  if (p.narrow && !loading) return <OneLane p={q} />;
  return (
    <div
      ref={p.narrow ? undefined : setRoot}
      style={height && !p.narrow ? { height } : undefined}
      className={cn(
        "flex min-w-0 gap-3 pb-1",
        loading ? "overflow-hidden" : "overflow-x-auto overscroll-x-contain [scrollbar-width:thin]",
      )}
    >
      {loading ? (
        <div role="status" aria-label="Loading" className="contents">
          <LoadingLanes narrow={p.narrow} />
        </div>
      ) : (
        q.lanes.map((l) => <Lane key={l.key} lane={l} p={q} />)
      )}
    </div>
  );
}
