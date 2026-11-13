/**
 * A board: lanes of cards (aerie D16 "Board"). Wide: lanes side by side, the board fills what is left of
 * the page's height and each lane scrolls itself, so a lane of 400 draws only the cards in its view
 * (`useLines` on the lane). A shut lane is a 44 px strip. Narrow: a strip of lanes picks one, and the
 * page scrolls it. A card is a link: a plain click opens it in place, a modified one in a new tab.
 * `move`: a Move button beside each card's link opens one menu of the lanes (one detached menu per board);
 * without it the board reads only.
 */

import { cn } from "cn";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Ring } from "./busy.js";
import {
  createMenuHandle,
  Menu,
  MenuContent,
  type MenuHandle,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./components/ui/menu.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { CHIP } from "./filter-bar.js";
import { Icon } from "./icons.js";
import { Pill } from "./rows.js";
import { TabBar } from "./tab-bar.js";
import { scrollerOf, useLines } from "./table.js";

export interface BoardCard<T> {
  /** unique on the board: a card in two lanes keys `id@lane` */
  key: string;
  /** the item's id, the same in every lane: the Move button's name, focus after a move */
  id: string;
  item: T;
}

export interface BoardMove<T> {
  /** the lanes' field: "Move to Status" */
  label: string;
  /** lane keys; the page writes, the card shows in `to` at once */
  onMove: (item: T, from: string, to: string) => void;
  /** a move in flight: dimmed, a busy ring, no second move */
  busy: (item: T) => boolean;
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
  move?: BoardMove<T> | undefined;
}

/** the Move menu's card and the lane it opened from */
interface MovePayload<T> {
  card: BoardCard<T>;
  lane: string;
}

/** what a board shares with its lanes for moves */
interface Moves<T> {
  handle: MenuHandle<MovePayload<T>>;
  /** `id\0lane` of cards that just came into a lane: they fade in once */
  arriving: ReadonlySet<string>;
  arrived: (at: string) => void;
  /** a lane's `reveal`, so a moved card scrolls into its lane's view */
  reveals: Map<string, (i: number) => void>;
}

const LANE_W = 288;
const STRIP_W = 44;
/** least height a wide board keeps when the window is short: the page scrolls past it */
const LEAST = 420;
const FADE = "animate-[ui-fade_150ms_var(--ui-ease)] motion-reduce:animate-none";
// DESIGN.md cards: the panel leaf, paper, raise; one hover signal (a fill)
const CARD =
  "group/card block rounded-(--ui-leaf-panel) bg-(--ui-paper) p-3 text-(--ui-ink) no-underline shadow-(--ui-raise) transition-[background-color,opacity] duration-150 ease-(--ui-ease) hover:bg-[color-mix(in_srgb,var(--ui-accent)_4%,var(--ui-paper))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) motion-reduce:transition-none";
const CARD_OPEN = "bg-[color-mix(in_srgb,var(--ui-ink)_5%,var(--ui-paper))]!";
// wide: shows on the card's hover and focus within; a coarse pointer has no hover, so always
const MOVE =
  "absolute top-2 right-2 inline-flex size-7 cursor-pointer items-center justify-center rounded-(--ui-leaf-field) border-0 bg-transparent text-(--ui-ink-3) opacity-0 transition-opacity duration-150 ease-(--ui-ease) group-hover/card:opacity-100 group-focus-within/card:opacity-100 hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-(--ui-focus) data-popup-open:opacity-100 data-popup-open:bg-(--ui-hover) disabled:cursor-default pointer-coarse:opacity-100 pointer-coarse:size-11 pointer-coarse:top-0 pointer-coarse:right-0 motion-reduce:transition-none";
const arrival = (id: string, lane: string) => `${id}\u0000${lane}`;

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
  lane,
  p,
  moves,
  index,
  measure,
}: {
  c: BoardCard<T>;
  lane: string;
  p: BoardProps<T>;
  moves: Moves<T> | null;
  index: number;
  measure: (el: Element | null) => void;
}) {
  const isOpen = p.open.id === c.key;
  const washes = p.changed?.(c.item) ?? false;
  const busy = p.move?.busy(c.item) ?? false;
  const at = arrival(c.id, lane);
  const arrives = moves?.arriving.has(at) ?? false;
  return (
    <li data-index={index} ref={measure} className="pb-2">
      {/* the Move button is the link's sibling: a button inside a link is not valid */}
      <div
        className={cn("group/card relative", arrives && FADE)}
        aria-busy={busy || undefined}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && e.animationName === "ui-fade") moves?.arrived(at);
        }}
      >
        <a
          href={p.href(c.item)}
          data-id={c.id}
          aria-current={isOpen ? "true" : undefined}
          onClick={(e) => {
            if (!plain(e)) return;
            e.preventDefault();
            p.open.onOpen(c.item);
          }}
          onAnimationEnd={(e) => {
            if (e.animationName === "ui-changed") p.onSettled?.();
          }}
          className={cn(
            CARD,
            moves && "pr-10 pointer-coarse:pr-12",
            busy && "opacity-60",
            isOpen && CARD_OPEN,
            washes && "animate-ui-changed",
          )}
        >
          {p.card(c.item)}
        </a>
        {moves ? (
          <MenuTrigger
            handle={moves.handle}
            payload={{ card: c, lane }}
            disabled={busy}
            aria-label={`Move ${c.id}`}
            className={cn(MOVE, busy && "opacity-100")}
          >
            {busy ? <Ring /> : <Icon name="more" size={16} />}
          </MenuTrigger>
        ) : null}
      </div>
    </li>
  );
}

/** a lane's cards: past the kit's threshold only those in view of `scroller` draw */
function Cards<T>({
  lane,
  p,
  moves,
  scroller,
}: {
  lane: BoardLane<T>;
  p: BoardProps<T>;
  moves: Moves<T> | null;
  scroller: HTMLElement | "window" | null;
}) {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const root = useCallback(() => list, [list]);
  const lines = useLines({ count: lane.cards.length, scroller, root, estimate: 112 });
  const { reveal } = lines;
  useEffect(() => {
    if (!moves) return;
    moves.reveals.set(lane.key, reveal);
    return () => {
      if (moves.reveals.get(lane.key) === reveal) moves.reveals.delete(lane.key);
    };
  }, [moves, lane.key, reveal]);
  if (!lane.cards.length)
    return <p className="m-0 px-1 py-2 text-[13px] text-(--ui-ink-3)">{lane.empty}</p>;
  return (
    <ul ref={setList} className="m-0 list-none p-0" aria-label={`${lane.label}: ${p.label}`}>
      {lines.before ? <li aria-hidden style={{ height: lines.before }} /> : null}
      {lines.shown.map((n) => {
        const c = lane.cards[n];
        return c ? (
          <Card
            key={c.key}
            c={c}
            lane={lane.key}
            p={p}
            moves={moves}
            index={n}
            measure={lines.measure}
          />
        ) : null;
      })}
      {lines.after ? <li aria-hidden style={{ height: lines.after }} /> : null}
    </ul>
  );
}

function Count({ n }: { n: number }) {
  return <b className="flex-none font-semibold text-(--ui-ink) tabular-nums">{n}</b>;
}

function Lane<T>({
  lane,
  p,
  moves,
}: {
  lane: BoardLane<T>;
  p: BoardProps<T>;
  moves: Moves<T> | null;
}) {
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
      data-lane={lane.key}
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
          data-lane-head
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
            data-lane-head
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
            <Cards lane={lane} p={p} moves={moves} scroller={scroll} />
          </div>
        </>
      )}
    </section>
  );
}

/** narrow: the strip picks a lane; the page scrolls its cards */
function OneLane<T>({
  p,
  moves,
  held,
}: {
  p: BoardProps<T>;
  moves: Moves<T> | null;
  /** the lane a move left from: the strip stays on it, though its last card left */
  held: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // no pick yet: the first lane with cards, never an empty To Do over a full lane
  const lane =
    p.lanes.find((l) => l.key === picked) ??
    p.lanes.find((l) => l.key === held) ??
    p.lanes.find((l) => l.cards.length) ??
    p.lanes[0];
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
              data-lane-head
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
      <div
        key={lane.key}
        ref={setPanel}
        role="tabpanel"
        aria-label={lane.label}
        data-lane={lane.key}
        className={FADE}
      >
        <Cards lane={lane} p={p} moves={moves} scroller={scroller} />
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

/** a move's focus, kept until the lanes draw the moved card */
interface Landing {
  id: string;
  from: string;
  to: string;
  /** the source lane's cards after and before it: where focus goes when the card leaves the view */
  next: string | null;
  prev: string | null;
  at: number;
}

const css = (s: string) => CSS.escape(s);

/**
 * Focus after a move (D16 Move "Focus"): wide, the card's link at its new place (a shut lane: its strip);
 * a phone, or a card the filter no longer shows: the next card, else the previous, else the lane's head.
 */
function land<T>(
  root: HTMLElement,
  l: Landing,
  lanes: BoardLane<T>[],
  narrow: boolean,
  shut: ReadonlySet<string>,
  reveals: Map<string, (i: number) => void>,
) {
  const head = (key: string) =>
    root.querySelector<HTMLElement>(
      `[data-lane="${css(key)}"][data-lane-head], [data-lane="${css(key)}"] [data-lane-head]`,
    );
  const to = lanes.find((x) => x.key === l.to);
  const i = to?.cards.findIndex((c) => c.id === l.id) ?? -1;
  if (!narrow && to && i >= 0) {
    if (shut.has(to.key)) return head(to.key)?.focus();
    reveals.get(to.key)?.(i);
    // a windowed lane draws the card a frame after the scroll
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const a = root.querySelector<HTMLElement>(
          `[data-lane="${css(to.key)}"] a[data-id="${css(l.id)}"]`,
        );
        (a ?? head(to.key))?.focus();
      }),
    );
    return;
  }
  const from = lanes.find((x) => x.key === l.from);
  for (const id of [l.next, l.prev]) {
    if (!id || !from?.cards.some((c) => c.id === id)) continue;
    const a = root.querySelector<HTMLElement>(
      `[data-lane="${css(l.from)}"] a[data-id="${css(id)}"]`,
    );
    if (a) return a.focus();
  }
  head(l.from)?.focus();
}

/** the one Move menu: the lanes in board order, the card's own ticked */
function MoveMenu<T>({
  p,
  moves,
  onPick,
}: {
  p: BoardProps<T>;
  moves: Moves<T>;
  onPick: (m: MovePayload<T>, to: string) => void;
}) {
  // a pick moves focus itself (`land`); Escape and a click outside give it back to the button
  const picked = useRef(false);
  return (
    <Menu<MovePayload<T>>
      handle={moves.handle}
      onOpenChange={(open) => {
        if (open) picked.current = false;
      }}
    >
      {({ payload }) =>
        payload ? (
          <MenuContent finalFocus={() => !picked.current}>
            <MenuRadioGroup
              value={payload.lane}
              onValueChange={(to: string) => {
                picked.current = true;
                onPick(payload, to);
              }}
            >
              <MenuLabel>Move to {p.move?.label}</MenuLabel>
              {p.lanes.map((l) => (
                <MenuRadioItem key={l.key} value={l.key} label={l.label}>
                  <Pill color={l.color}>{l.label}</Pill>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        ) : null
      }
    </Menu>
  );
}

/** The board: see the file's head. `lanes` null: it is loading. */
export function Board<T>(p: Omit<BoardProps<T>, "lanes"> & { lanes: BoardLane<T>[] | null }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // loading fills the same height, so the lanes land without a jump
  const height = useFill(root, !p.narrow);
  const loading = !p.lanes;
  const q = p as BoardProps<T>;

  const [handle] = useState(() => createMenuHandle<MovePayload<T>>());
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  const reveals = useRef(new Map<string, (i: number) => void>()).current;
  const arrived = useCallback(
    (at: string) =>
      setArriving((s) => {
        const next = new Set(s);
        next.delete(at);
        return next;
      }),
    [],
  );
  const moves = useMemo<Moves<T> | null>(
    () => (p.move ? { handle, arriving, arrived, reveals } : null),
    [p.move, handle, arriving, arrived, reveals],
  );

  // a card in a lane it was not in before (a move, a refusal, a write elsewhere) fades in there
  const placed = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    if (!p.lanes) return;
    const now = new Set(p.lanes.flatMap((l) => l.cards.map((c) => arrival(c.id, l.key))));
    const was = placed.current;
    placed.current = now;
    if (!was || !p.move) return;
    const ids = new Set([...was].map((k) => k.split("\u0000")[0]));
    const fresh = [...now].filter((k) => !was.has(k) && ids.has(k.split("\u0000")[0] as string));
    if (fresh.length) setArriving((s) => new Set([...s, ...fresh]));
  }, [p.lanes, p.move]);

  const landing = useRef<Landing | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const onPick = (m: MovePayload<T>, to: string) => {
    if (to === m.lane || !p.move) return;
    const from = q.lanes.find((l) => l.key === m.lane);
    const i = from?.cards.findIndex((c) => c.id === m.card.id) ?? -1;
    landing.current = {
      id: m.card.id,
      from: m.lane,
      to,
      next: from?.cards[i + 1]?.id ?? null,
      prev: from?.cards[i - 1]?.id ?? null,
      at: performance.now(),
    };
    if (p.narrow) setHeld(m.lane);
    setSaid(`${m.card.id} moved to ${q.lanes.find((l) => l.key === to)?.label ?? to}`);
    p.move.onMove(m.card.item, m.lane, to);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on the lanes a move draws.
  useLayoutEffect(() => {
    const l = landing.current;
    if (!l || !p.lanes || !box.current) return;
    landing.current = null;
    // a page that wrote nothing leaves the lanes as they were: stale after a second
    if (performance.now() - l.at > 1000) return;
    land(box.current, l, p.lanes, p.narrow, p.shut, reveals);
  }, [p.lanes]);

  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {said}
    </p>
  );
  const menu = moves && !loading ? <MoveMenu p={q} moves={moves} onPick={onPick} /> : null;
  if (p.narrow && !loading)
    return (
      <div ref={box} className="contents">
        <OneLane p={q} moves={moves} held={held} />
        {menu}
        {live}
      </div>
    );
  return (
    <div ref={box} className="contents">
      <div
        ref={p.narrow ? undefined : setRoot}
        style={height && !p.narrow ? { height } : undefined}
        className={cn(
          "flex min-w-0 gap-3 pb-1",
          loading
            ? "overflow-hidden"
            : "overflow-x-auto overscroll-x-contain [scrollbar-width:thin]",
        )}
      >
        {loading ? (
          <div role="status" aria-label="Loading" className="contents">
            <LoadingLanes narrow={p.narrow} />
          </div>
        ) : (
          q.lanes.map((l) => <Lane key={l.key} lane={l} p={q} moves={moves} />)
        )}
      </div>
      {menu}
      {live}
    </div>
  );
}
