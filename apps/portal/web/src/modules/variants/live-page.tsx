/**
 * A page sample that runs code (WebGL, scroll scenes): a link on its own origin, framed as is
 * (vireo D8). In a batch every frame on screen runs, so a person can use all the pages in view
 * (WA-1438). A frame that scrolls off stays loaded, up to `KEEP` in all; past that the least
 * recently seen one drops to its still (WA-1441). At most `LOADS` pages load at once; a frame
 * waits on its still, then fades in when its page posts `READY` or a beat after onLoad (WA-1444).
 * Stop holds a frame on its still until play. Stage: the card over the whole window.
 */
import { Button, cx, Icon, Img, PLAY_MARK, Ring, Seg } from "@wren/ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type FrameWidth = "desktop" | "phone";
export const WIDTHS = [
  { value: "desktop", label: "Desktop" },
  { value: "phone", label: "Phone" },
] as const;
/** The viewport the page gets, whatever room the card has: it is drawn scaled to fit. */
const VIEW = { desktop: { w: 1280, h: 800 }, phone: { w: 390, h: 700 } } as const;
/** A phone starts at phone width: a 1280 page scaled into 390 reads as a thumbnail. */
const first = (): FrameWidth =>
  typeof window !== "undefined" && window.innerWidth < 700 ? "phone" : "desktop";

/** The page's own viewport and its scale, for the room `slot` gives. On stage a wide window is used as is. */
function frameFit(width: FrameWidth, slot: { w: number; h: number }, staged: boolean) {
  const v = VIEW[width];
  if (staged && width === "desktop" && slot.w >= 1024) return { w: slot.w, h: slot.h, scale: 1 };
  const scale = Math.min(1, slot.w / v.w);
  return { w: v.w, h: staged ? slot.h / scale : v.h, scale };
}

/** Frames loaded at once, on screen first, then the most recently seen: ~30-60 MB each for a static page. */
const KEEP = 9;
/** A frame starts well before it scrolls in, so it is loaded when seen. */
const NEAR = "600px 0px";
/** Page loads in flight at once: a row scrolling in queued 6-9 at once (WA-1444 trace). */
const LOADS = 2;
/** No ready message by then after onLoad: fade anyway (pages that never send one). */
const READY_WAIT = 400;
/** No onLoad by then: free the load slot. */
const HANG = 10_000;
/** A sample page may post this when its fonts are in and it has painted. */
export const READY = "vireo:ready";

/**
 * The frames loaded now: hand-played first, then on screen in page order, then off screen by
 * last seen, up to `keep`. Held ones never load by themselves.
 */
export function keptFrames(o: {
  ids: readonly number[];
  near: ReadonlySet<number>;
  seen: readonly number[];
  picked: readonly number[];
  held: ReadonlySet<number>;
  keep?: number;
}): Set<number> {
  const order = [
    ...o.picked.filter((id) => o.ids.includes(id)),
    ...o.ids.filter((id) => o.near.has(id)),
    ...o.seen.filter((id) => o.ids.includes(id)),
  ];
  return new Set([...new Set(order)].filter((id) => !o.held.has(id)).slice(0, o.keep ?? KEEP));
}

/**
 * The frames whose page may load now, from kept `order` (first = most wanted): those started stay,
 * new ones start while fewer than `cap` are still loading. `now` ids (on stage) skip the line.
 */
export function startedFrames(o: {
  order: readonly number[];
  started: ReadonlySet<number>;
  done: ReadonlySet<number>;
  now?: readonly number[];
  cap?: number;
}): Set<number> {
  const next = new Set(o.order.filter((id) => o.started.has(id) || o.now?.includes(id)));
  let busy = [...next].filter((id) => !o.done.has(id)).length;
  for (const id of o.order) {
    if (busy >= (o.cap ?? LOADS)) break;
    if (next.has(id)) continue;
    next.add(id);
    busy++;
  }
  return next;
}

const same = (a: ReadonlySet<number>, b: ReadonlySet<number>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The box that scrolls `el`: the watch root, since a clipping scroller voids a margin on the viewport. */
function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

interface Frames {
  /** Kept: shows Stop, its page loads when a slot frees. */
  isLive: (id: number) => boolean;
  /** Its page may load now. */
  isStarted: (id: number) => boolean;
  /** onLoad (or hung): frees its load slot. */
  loaded: (id: number) => void;
  /** Play (true) or hold on the still (false). */
  run: (id: number, on: boolean) => void;
  /** Report a frame's slot for the on-screen watch; returns the unwatch. */
  watch: (id: number, el: Element) => () => void;
  stage: number | null;
  /** On stage = live too. */
  show: (id: number | null) => void;
  width: FrameWidth;
  setWidth: (w: FrameWidth) => void;
  ids: number[];
}
const Ctx = createContext<Frames | null>(null);

export function FramesProvider({ ids, children }: { ids: number[]; children: ReactNode }) {
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  /** Played by hand: first in line when more than the cap are near. */
  const [picked, setPicked] = useState<readonly number[]>([]);
  /** Most recently near first: who stays loaded after scrolling off. */
  const [seen, setSeen] = useState<readonly number[]>([]);
  const [stage, setStage] = useState<number | null>(null);
  const [width, setWidth] = useState<FrameWidth>(first);
  /** Page may load (WA-1444 cap), and of those, the ones whose onLoad came. */
  const [started, setStarted] = useState<ReadonlySet<number>>(new Set());
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const els = useRef(new Map<Element, number>());
  const io = useRef<IntersectionObserver | null>(null);
  const see = useCallback((entries: IntersectionObserverEntry[]) => {
    const came: number[] = [];
    setNear((was) => {
      const next = new Set(was);
      for (const e of entries) {
        const id = els.current.get(e.target);
        if (id == null) continue;
        if (e.isIntersecting) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    for (const e of entries) {
      const id = els.current.get(e.target);
      if (id != null && e.isIntersecting) came.push(id);
    }
    if (came.length) setSeen((was) => [...came, ...was.filter((x) => !came.includes(x))]);
  }, []);
  useEffect(() => () => io.current?.disconnect(), []);
  const watch = useCallback(
    (id: number, el: Element) => {
      els.current.set(el, id);
      // root = the scroller of the first slot: all slots share it
      if (!io.current && typeof IntersectionObserver !== "undefined")
        io.current = new IntersectionObserver(see, { root: scroller(el), rootMargin: NEAR });
      io.current?.observe(el);
      return () => {
        io.current?.unobserve(el);
        els.current.delete(el);
        setNear((was) => {
          if (!was.has(id)) return was;
          const next = new Set(was);
          next.delete(id);
          return next;
        });
      };
    },
    [see],
  );
  const key = ids.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids by value; a patch remakes the array
  const live = useMemo(
    () => keptFrames({ ids, near, seen, picked, held }),
    [near, seen, picked, held, key],
  );
  useEffect(() => {
    const order = stage == null ? [...live] : [stage, ...[...live].filter((x) => x !== stage)];
    const next = startedFrames({ order, started, done, now: stage == null ? [] : [stage] });
    if (!same(next, started)) setStarted(next);
    const kept = new Set([...done].filter((x) => next.has(x)));
    if (!same(kept, done)) setDone(kept);
  }, [live, stage, started, done]);
  const loaded = useCallback(
    (id: number) => setDone((was) => (was.has(id) ? was : new Set([...was, id]))),
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids by value; a patch remakes the array
  const value = useMemo<Frames>(() => {
    const run = (id: number, on: boolean) => {
      setHeld((was) => {
        const next = new Set(was);
        if (on) next.delete(id);
        else next.add(id);
        return next;
      });
      setPicked((was) => (on ? [id, ...was.filter((x) => x !== id)] : was.filter((x) => x !== id)));
    };
    return {
      isLive: (id) => stage === id || live.has(id),
      isStarted: (id) => started.has(id),
      loaded,
      run,
      watch,
      stage,
      show: (id) => {
        setStage(id);
        if (id != null) run(id, true);
      },
      width,
      setWidth,
      ids,
    };
  }, [live, started, stage, width, key, watch, loaded]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
/** Null outside a batch (catalog, history): a frame there keeps its own state, no stage. */
export const useFrames = () => useContext(Ctx);

export function LivePage({
  id,
  url,
  still,
  children,
}: {
  id: number;
  url: string;
  still: string | null;
  /** The box layer, over the frame. */
  children?: ReactNode;
}) {
  const frames = useFrames();
  const [own, setOwn] = useState(false);
  const [ownWidth, setOwnWidth] = useState<FrameWidth>(first);
  const staged = frames?.stage === id;
  const live = frames ? frames.isLive(id) : own;
  /** Kept and given a load slot: the iframe mounts. */
  const mounted = live && (frames ? frames.isStarted(id) : true);
  /** The page is ready (its message, or onLoad + READY_WAIT): it fades in over the still. */
  const [loaded, setLoaded] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const wait = useRef<ReturnType<typeof setTimeout>>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: frames.loaded is stable; one id per mount
  useEffect(() => {
    if (!mounted) {
      setLoaded(false);
      return;
    }
    // every sample shares one origin: match the sender by window
    const onMessage = (e: MessageEvent) => {
      if (e.source === iframe.current?.contentWindow && e.data?.type === READY) setLoaded(true);
    };
    window.addEventListener("message", onMessage);
    const hang = setTimeout(() => frames?.loaded(id), HANG);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(hang);
      clearTimeout(wait.current);
    };
  }, [mounted, id]);
  const onLoad = () => {
    frames?.loaded(id);
    clearTimeout(wait.current);
    wait.current = setTimeout(() => setLoaded(true), READY_WAIT);
  };
  const run = (on: boolean) => (frames ? frames.run(id, on) : setOwn(on));
  const width = frames?.width ?? ownWidth;
  const slot = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: watch is stable; one slot per id
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    const see = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    see();
    const ro = new ResizeObserver(see);
    ro.observe(el);
    const unwatch = frames?.watch(id, el);
    return () => {
      ro.disconnect();
      unwatch?.();
    };
  }, [id]);
  const f = room && room.w > 0 ? frameFit(width, room, staged) : null;
  return (
    <div className={cx("flex flex-col gap-2", staged && "min-h-0 flex-1")}>
      <div ref={slot} className={cx("w-full", staged && "min-h-0 flex-1 overflow-hidden")}>
        {f && (
          <div
            className="relative mx-auto box-content overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-tile)"
            style={{ width: f.w * f.scale - 2, height: f.h * f.scale - 2 }}
          >
            {/* the still holds the slot while the page loads, then the page fades in over it */}
            {still && (
              <Img
                src={still}
                alt=""
                className="absolute inset-0 block size-full object-cover object-top select-none"
                draggable={false}
              />
            )}
            {live ? (
              <>
                {mounted && (
                  <iframe
                    ref={iframe}
                    title={`Sample ${id}`}
                    src={url}
                    // its own origin, never ours: scripts and its own modules run, nothing here is reachable
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    onLoad={onLoad}
                    // no fill: a frame Chrome has not painted yet (new, or back from off screen) shows the still
                    className={cx(
                      "absolute top-0 left-0 block origin-top-left border-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
                      loaded ? "opacity-100" : "opacity-0",
                    )}
                    style={{ width: f.w, height: f.h, transform: `scale(${f.scale})` }}
                  />
                )}
                {!loaded && (
                  <span className="pointer-events-none absolute top-2 right-2 flex rounded-full bg-(--ui-tile)/80 p-1 backdrop-blur-sm">
                    <Ring />
                  </span>
                )}
              </>
            ) : (
              // the whole still runs it; a glass play mark, not a solid button over the art
              <button
                type="button"
                aria-label={`Run sample ${id}`}
                onClick={() => run(true)}
                className="group absolute inset-0 flex cursor-pointer items-center justify-center outline-none"
              >
                <span className={PLAY_MARK}>
                  <Icon name="play" size={22} className="translate-x-px" />
                </span>
              </button>
            )}
            {children}
          </div>
        )}
      </div>
      {!staged && (
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            dense
            label="Width"
            items={WIDTHS}
            value={width}
            onChange={frames ? frames.setWidth : setOwnWidth}
          />
          {live && (
            <Button size="dense" tone="quiet" icon="stop" onClick={() => run(false)}>
              Stop
            </Button>
          )}
          <span className="flex-1" />
          {frames && (
            <Button size="dense" icon="expand" onClick={() => frames.show(id)}>
              Full screen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
