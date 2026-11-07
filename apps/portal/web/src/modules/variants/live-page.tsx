/**
 * A page sample that runs code (WebGL, scroll scenes): a link on its own origin, framed as is
 * (vireo D8). One frame runs at a time, so a batch of scenes never shares the GPU and a scroll
 * scene never traps the list; the rest show their still. Stage: the card over the whole window.
 */
import { Button, cx, Icon, Seg } from "@wren/ui";
import {
  createContext,
  type ReactNode,
  useContext,
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

interface Frames {
  live: number | null;
  run: (id: number | null) => void;
  stage: number | null;
  /** On stage = live too. */
  show: (id: number | null) => void;
  width: FrameWidth;
  setWidth: (w: FrameWidth) => void;
  ids: number[];
}
const Ctx = createContext<Frames | null>(null);

export function FramesProvider({ ids, children }: { ids: number[]; children: ReactNode }) {
  const [live, run] = useState<number | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  const [width, setWidth] = useState<FrameWidth>(first);
  const key = ids.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids by value; a patch remakes the array
  const value = useMemo<Frames>(
    () => ({
      live,
      run,
      stage,
      show: (id) => {
        setStage(id);
        if (id != null) run(id);
      },
      width,
      setWidth,
      ids,
    }),
    [live, stage, width, key],
  );
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
  const live = frames ? frames.live === id : own;
  const run = (on: boolean) => (frames ? frames.run(on ? id : null) : setOwn(on));
  const width = frames?.width ?? ownWidth;
  const slot = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    const see = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    see();
    const ro = new ResizeObserver(see);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const f = room && room.w > 0 ? frameFit(width, room, staged) : null;
  return (
    <div className={cx("flex flex-col gap-2", staged && "min-h-0 flex-1")}>
      <div ref={slot} className={cx("w-full", staged && "min-h-0 flex-1 overflow-hidden")}>
        {f && (
          <div
            className="relative mx-auto box-content overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-tile)"
            style={{ width: f.w * f.scale - 2, height: f.h * f.scale - 2 }}
          >
            {live ? (
              <iframe
                title={`Sample ${id}`}
                src={url}
                // its own origin, never ours: scripts and its own modules run, nothing here is reachable
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                className="block origin-top-left border-0"
                style={{ width: f.w, height: f.h, transform: `scale(${f.scale})` }}
              />
            ) : (
              <>
                {still && (
                  <img
                    src={still}
                    alt=""
                    className="block size-full object-cover object-top select-none"
                    draggable={false}
                  />
                )}
                {/* the whole still runs it; a glass play mark, not a solid button over the art */}
                <button
                  type="button"
                  aria-label={`Run sample ${id}`}
                  onClick={() => run(true)}
                  className="group absolute inset-0 flex cursor-pointer items-center justify-center outline-none"
                >
                  <span className="flex size-14 items-center justify-center rounded-full bg-black/30 text-white shadow-[0_2px_12px_rgb(0_0_0/0.25)] ring-1 ring-white/35 backdrop-blur-md transition-[background-color,transform] duration-150 group-hover:scale-105 group-hover:bg-black/45 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-(--ui-focus) group-active:scale-95">
                    <Icon name="play" size={22} />
                  </span>
                </button>
              </>
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
