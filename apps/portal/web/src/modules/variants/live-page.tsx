/**
 * A page sample that runs code (WebGL, scroll scenes): a link on its own origin, framed as is
 * (vireo D8). In a batch every frame on screen runs, so a person can use all the pages in view
 * (WA-1438). A frame that scrolls off stays loaded, up to `KEEP` in all; past that the least
 * recently seen one drops to its still (WA-1441). A new frame loads under its still and fades in.
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

interface Frames {
  isLive: (id: number) => boolean;
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
  const els = useRef(new Map<Element, number>());
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
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
      },
      { rootMargin: NEAR },
    );
    for (const el of els.current.keys()) obs.observe(el);
    io.current = obs;
    return () => obs.disconnect();
  }, []);
  const watch = useCallback((id: number, el: Element) => {
    els.current.set(el, id);
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
  }, []);
  const key = ids.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids by value; a patch remakes the array
  const value = useMemo<Frames>(() => {
    const live = keptFrames({ ids, near, seen, picked, held });
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
  }, [near, held, picked, seen, stage, width, key, watch]);
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
  /** The page has loaded: it fades in over the still. A new mount starts over. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!live) setLoaded(false);
  }, [live]);
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
                <iframe
                  title={`Sample ${id}`}
                  src={url}
                  // its own origin, never ours: scripts and its own modules run, nothing here is reachable
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  onLoad={() => setLoaded(true)}
                  className={cx(
                    "absolute top-0 left-0 block origin-top-left border-0 bg-(--ui-tile) transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    loaded ? "opacity-100" : "opacity-0",
                  )}
                  style={{ width: f.w, height: f.h, transform: `scale(${f.scale})` }}
                />
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
