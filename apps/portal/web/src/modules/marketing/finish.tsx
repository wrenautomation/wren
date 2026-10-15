/**
 * Finishing a video (designs/2026-10-15-video-finishing.md): the player over the recording's
 * playback copy, skipping what's cut; text and captions drawn live over it; each shape's crop
 * dragged in place; the timeline under it with the filmstrip, in and out, cut edges, text bars,
 * caption lines, the cover and the playhead. Every time is raw seconds on the recording, as the
 * edit keeps them (`@wren/studio/finish` does the sums the render does).
 *
 * One saved value (cuts, text, crops, captions, cover, formats) on the save engine: journaled
 * per video, saved a pause after the last change, a drag set on release only. Each save sends
 * the fields that changed with what they were (`expect`), so a change made elsewhere meanwhile
 * opens Keep mine or Use theirs instead of being overwritten.
 */
import { keepSegments } from "@wren/studio/cuts";
import {
  addCut,
  type CaptionLine,
  type CroppedFormat,
  type Crops,
  captionY,
  cropCentre,
  cropWindow,
  FPS,
  FRAME,
  inOut,
  isCropped,
  moveCutEdge,
  newOverlay,
  OVERLAY,
  OVERLAY_SIZES,
  type OverlaySize,
  overlayAt,
  type Point,
  playFrom,
  snapFrame,
  snapTime,
  type TextOverlay,
  trimCuts,
} from "@wren/studio/finish";
import type { Cut } from "@wren/studio/schema";
import { ACTIONS, Button, cx, type RecordAct, SaveConflict, SaveStatus, useSaved } from "@wren/ui";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { wrenRecords } from "../../records.js";

type Format = "long" | CroppedFormat;
type Captions = {
  style: string;
  long?: "screen" | "track";
  short?: "screen" | "track";
  behind?: boolean;
  on?: boolean;
  place?: { long?: number; short?: number };
};
/** What this view saves: the fields of the edit it changes. */
export type FinishEdit = {
  cuts: Cut[];
  overlays: TextOverlay[];
  crops: Crops;
  captions: Captions;
  thumbnail: { at: number; text: string } | null;
  formats: Format[];
};
/** The record's `video.finish` (content `finishOf`). */
export type FinishData = {
  fps: number;
  durationS: number;
  size: [number, number];
  camSize: [number, number] | null;
  source: string | null;
  sourceCam: string | null;
  strip: string | null;
  picture: { source: "main" | "cam"; centre: Point };
  lines: CaptionLine[];
  rendered: Format[];
  /** The renders the edit has since changed, by output name; null when that can't be told. */
  stale: string[] | null;
  covers: Partial<Record<CroppedFormat, string>>;
  saved: FinishEdit;
};

const SET = "marketing.videoSet";
const LINE = "marketing.videoLine";
const FIELDS = ["cuts", "overlays", "crops", "captions", "thumbnail", "formats"] as const;
const SAVE_DELAY_MS = 1200;
/** The tallest the stage gets, so a 9:16 view leaves the timeline on screen. */
const STAGE_MAX_H = 520;
const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
const STRIP_ACROSS = 10;
const STRIP_FRAMES = 60;

const VIEWS: [Format, string][] = [
  ["long", "16:9"],
  ["vertical", "9:16"],
  ["square", "1:1"],
  ["portrait", "4:5"],
];
const SHAPES: [Format, string, string][] = [
  ["long", "Long, 16:9", "YouTube"],
  ["vertical", "Vertical, 9:16", "Shorts, Reels and TikTok"],
  ["square", "Square, 1:1", "X, and LinkedIn or Facebook when 4:5 is off"],
  ["portrait", "Portrait, 4:5", "LinkedIn and Facebook feeds"],
];
const STYLES: [string, string][] = [
  ["word", "Word"],
  ["pill", "Pill"],
  ["sweep", "Sweep"],
  ["pop", "Pop"],
  ["wipe", "Wipe"],
  ["stress", "Stress"],
];
/** How far each format's caption line may sit from the top (studio `captionPlaceSchema`). */
const PLACE = { long: [0.1, 0.92], short: [0.12, 0.8] } as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** "1:05.12": minutes, seconds and the frame. */
const stamp = (t: number) => {
  const f = Math.round(t * FPS);
  const s = Math.floor(f / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(f % FPS).padStart(2, "0")}`;
};
const short = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** JSON with keys in order: Postgres hands jsonb back with its own key order. */
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>)
            .filter(([, y]) => y !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const normal = (e: FinishEdit): FinishEdit => ({
  ...e,
  captions: e.captions ?? { style: "word" },
  crops: e.crops ?? {},
  overlays: e.overlays ?? [],
  cuts: [...e.cuts].sort((a, b) => a.from - b.from || a.to - b.to),
});
const shownOn = (c: Captions, which: "long" | "short") =>
  which === "long"
    ? c.long === "screen"
    : (c.short ?? (c.on === false ? "track" : "screen")) === "screen";
const problem = (e: FinishEdit) =>
  !e.formats.length
    ? "Keep at least one shape."
    : e.overlays.some((o) => !o.text.trim())
      ? "Text on the video needs words."
      : null;

/**
 * A signed URL that stays put while only its signature changes, so a read of the record doesn't
 * reload the player. After an error (an old signature ran out) it takes the newest.
 */
function useSteadyUrl(url: string | null): [string | null, () => void] {
  const kept = useRef(url);
  const newest = useRef(url);
  const [, redraw] = useState(0);
  newest.current = url;
  if (!url) kept.current = null;
  else if (!kept.current || kept.current.split("?")[0] !== url.split("?")[0]) kept.current = url;
  const renew = () => {
    if (newest.current && newest.current !== kept.current) {
      kept.current = newest.current;
      redraw((n) => n + 1);
    }
  };
  return [kept.current, renew];
}

/** A drag: `move` on each pointer move, `up` once on release, both with the pointer's event. */
function drag(
  e: ReactPointerEvent,
  move: (ev: PointerEvent) => void,
  up: (ev: PointerEvent, moved: boolean) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  // No focus move on a prevented press: a field he typed in would keep the keys (I, O, Space).
  const typing = document.activeElement;
  if (typing instanceof HTMLElement && typing.closest("input, textarea, select")) typing.blur();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
    moved = true;
    move(ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    up(ev, moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/** The width an element draws at, kept current. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type Picked =
  | { kind: "overlay"; i: number }
  | { kind: "cut"; i: number }
  | { kind: "line"; i: number }
  | null;
type Panel = "text" | "captions" | "cover" | "shapes";

export function Finish({
  id,
  data,
  words,
  act,
}: {
  id: string;
  data: FinishData;
  words: readonly { s: number; e: number }[];
  act: RecordAct;
}) {
  const dur = data.durationS;
  const serverJson = stable(data.saved);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the saved fields by value, not identity.
  const server = useMemo(() => normal(data.saved), [serverJson]);
  /** Read on a conflict, so Use theirs has theirs: it stands until the page reads again. */
  const [fresh, setFresh] = useState<{ value: FinishEdit; over: string } | null>(null);
  const s = useSaved<FinishEdit>({
    key: `video-finish:${id}`,
    server: fresh && fresh.over === serverJson ? fresh.value : server,
    same,
    delay: SAVE_DELAY_MS,
    save: async (value, { base, request }) => {
      const bad = problem(value);
      if (bad) throw new Error(bad);
      const patch: Record<string, unknown> = {};
      const expect: Record<string, unknown> = {};
      for (const k of FIELDS)
        if (!same(value[k], base[k])) {
          patch[k] = value[k];
          expect[k] = base[k];
        }
      if (Object.keys(patch).length) await act(SET, { patch, expect, requestId: request });
      return { value };
    },
    onConflict: () => {
      void wrenRecords("marketing")
        .get({ record: "marketing.video", id })
        .then((a) => {
          const got = (a.detail as { video?: { finish?: FinishData } } | null)?.video?.finish;
          if (got) setFresh({ value: normal(got.saved), over: serverJson });
        })
        .catch(() => {});
    },
  });

  // A drag draws here and is set once, on release.
  const [live, setLive] = useState<FinishEdit | null>(null);
  const liveRef = useRef<FinishEdit | null>(null);
  const draw = live ?? s.value;
  const preview = (v: FinishEdit) => {
    liveRef.current = v;
    setLive(v);
  };
  const release = () => {
    const v = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (v) s.set(normal(v));
  };
  const commit = (v: FinishEdit) => s.set(normal(v));

  const keep = useMemo(() => keepSegments(draw.cuts, dur, FPS), [draw.cuts, dur]);
  const io = useMemo(() => inOut(draw.cuts, dur), [draw.cuts, dur]);
  const keptS = keep.reduce((n, k) => n + k.e - k.s, 0);

  const [view, setView] = useState<Format>(() => (draw.formats[0] as Format) ?? "long");
  const [panel, setPanel] = useState<Panel>("text");
  const [picked, setPicked] = useState<Picked>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [t, setT] = useState(() => io.in);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const keepRef = useRef(keep);
  keepRef.current = keep;
  const root = useRef<HTMLDivElement | null>(null);

  const cropped = isCropped(view);
  const useCam = cropped && data.picture.source === "cam" && !!data.sourceCam && !!data.camSize;
  const [src, renew] = useSteadyUrl(useCam ? data.sourceCam : data.source);
  const pic: [number, number] = useCam ? (data.camSize as [number, number]) : data.size;

  const seek = (to: number) => {
    const at = clamp(snapFrame(to), 0, snapFrame(dur));
    setT(at);
    // Half a frame in, so the picture is that frame's whatever the decoder rounds.
    if (video.current) video.current.currentTime = at + 0.5 / FPS;
  };
  const play = () => {
    const el = video.current;
    if (!el) return;
    const from = playFrom(tRef.current, keepRef.current) ?? keepRef.current[0]?.s ?? 0;
    el.currentTime = from;
    setT(from);
    setPlaying(true);
    el.play().catch(() => setPlaying(false));
  };
  const pause = () => {
    video.current?.pause();
    setPlaying(false);
    if (video.current) setT(snapFrame(video.current.currentTime));
  };

  // Playing: follow the video, and jump each cut as it comes.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      const el = video.current;
      if (!el) return;
      const now = el.currentTime;
      const next = playFrom(now, keepRef.current);
      if (next === null) {
        el.pause();
        setPlaying(false);
        setT(snapFrame(keepRef.current.at(-1)?.e ?? now));
        return;
      }
      if (next - now > 0.5 / FPS) el.currentTime = next;
      setT(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const setIn = (at: number) => commit({ ...draw, cuts: trimCuts(draw.cuts, dur, { in: at }) });
  const setOut = (at: number) => commit({ ...draw, cuts: trimCuts(draw.cuts, dur, { out: at }) });
  const cutRange = () => {
    if (!range) return;
    commit({ ...draw, cuts: addCut(draw.cuts, range[0], range[1], dur) });
    setRange(null);
  };

  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable=true]")) return;
    const k = e.key;
    if (k === " ") {
      // A focused button takes its own Space.
      if (el.closest("button, a")) return;
      e.preventDefault();
      if (playing) pause();
      else play();
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      if (playing) pause();
      const by = (e.shiftKey ? 1 : 1 / FPS) * (k === "ArrowLeft" ? -1 : 1);
      seek(tRef.current + by);
    } else if (k === "i" || k === "I") setIn(t);
    else if (k === "o" || k === "O") setOut(t + 1 / FPS);
    else if ((k === "Backspace" || k === "Delete") && range) {
      e.preventDefault();
      cutRange();
    } else if (k === "Escape") {
      setRange(null);
      setPicked(null);
    }
  };

  const overlay = picked?.kind === "overlay" ? draw.overlays[picked.i] : undefined;

  // The keys work once he has pressed somewhere in this view, until he presses outside it.
  const keys = useRef(onKey);
  keys.current = onKey;
  useEffect(() => {
    let armed = false;
    const down = (e: PointerEvent) => {
      armed = !!root.current?.contains(e.target as Node);
    };
    const key = (e: KeyboardEvent) => {
      if (armed && !e.metaKey && !e.ctrlKey && !e.altKey) keys.current(e);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <div ref={root} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitch view={view} formats={draw.formats} onView={setView} />
        <SaveStatus state={s} onRetry={() => void s.retry()} idle="Changes save as you go" />
      </div>
      {s.conflict ? (
        <SaveConflict
          conflict={s.conflict}
          show={(theirs) => whatChanged(s.value, theirs)}
          onKeepMine={() => void s.keepMine()}
          onTakeTheirs={s.takeTheirs}
        />
      ) : null}

      <Stage
        data={data}
        draw={draw}
        view={view}
        t={t}
        src={src}
        pic={pic}
        centre={
          cropped
            ? (draw.crops[view as CroppedFormat] ??
              (useCam ? { x: 0.5, y: 0.5 } : data.picture.centre))
            : null
        }
        videoRef={video}
        onError={renew}
        picked={overlay ? picked : null}
        showCaptionSpot={panel === "captions"}
        onLoaded={() => {
          if (video.current) video.current.currentTime = tRef.current + 0.5 / FPS;
          if (playing) video.current?.play().catch(() => setPlaying(false));
        }}
        onPick={(i) => {
          setPicked({ kind: "overlay", i });
          setPanel("text");
        }}
        preview={preview}
        release={release}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="sm" onClick={playing ? pause : play} disabled={!src}>
          {playing ? "Pause" : "Play"}
        </Button>
        <span className="text-[13px] text-(--ui-ink) [font-variant-numeric:tabular-nums]">
          {stamp(t)}
          <span className="text-(--ui-ink-3)"> of {stamp(dur)}</span>
        </span>
        <span className="text-[13px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
          Plays for {short(keptS)}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" tone="quiet" onClick={() => setIn(t)}>
            Start here
          </Button>
          <Button size="sm" tone="quiet" onClick={() => setOut(t + 1 / FPS)}>
            End here
          </Button>
        </span>
      </div>

      <Timeline
        dur={dur}
        t={t}
        playing={playing}
        draw={draw}
        io={io}
        lines={data.lines}
        strip={data.strip}
        size={data.size}
        words={words}
        picked={picked}
        range={range}
        onSeek={(at) => {
          if (playing) pause();
          seek(at);
        }}
        onRange={setRange}
        onPick={(p) => {
          setPicked(p);
          if (p?.kind === "overlay") setPanel("text");
          if (p?.kind === "line") setPanel("captions");
        }}
        preview={preview}
        release={release}
      />

      {range ? (
        <Bar>
          <span>
            {stamp(range[0])} to {stamp(range[1])}
          </span>
          <Button size="sm" onClick={cutRange}>
            Cut this part
          </Button>
          <Button size="sm" tone="quiet" onClick={() => setRange(null)}>
            Clear
          </Button>
        </Bar>
      ) : picked?.kind === "cut" && draw.cuts[picked.i] ? (
        <Bar>
          <span>
            Cut from {stamp((draw.cuts[picked.i] as Cut).from)} to{" "}
            {stamp((draw.cuts[picked.i] as Cut).to)}
          </span>
          <Button
            size="sm"
            onClick={() => {
              const c = draw.cuts[picked.i] as Cut;
              commit({
                ...draw,
                cuts:
                  c.why === "manual"
                    ? draw.cuts.filter((_, j) => j !== picked.i)
                    : draw.cuts.map((x, j) => (j === picked.i ? { ...x, state: "kept" } : x)),
              });
              setPicked(null);
            }}
          >
            Put it back
          </Button>
        </Bar>
      ) : null}

      <p className="m-0 text-[12px] text-(--ui-ink-3)">
        Space plays. Arrows move a frame, with Shift a second. I and O set the start and end. Drag
        across the filmstrip to cut a part.
      </p>

      <div className="grid gap-3 rounded-xl border border-(--ui-hair) bg-(--ui-paper) p-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Finish">
          {(
            [
              ["text", "Text"],
              ["captions", "Captions"],
              ["cover", "Cover"],
              ["shapes", "Shapes"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={panel === p}
              onClick={() => setPanel(p)}
              className="cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 text-[13px] font-medium text-(--ui-ink-2) transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-selected:bg-(--ui-fill) aria-selected:text-(--ui-ink)"
            >
              {label}
            </button>
          ))}
        </div>
        <div key={panel} className="animate-[finish-in_160ms_var(--ui-ease)]">
          {panel === "text" ? (
            <TextPanel
              draw={draw}
              t={t}
              dur={dur}
              picked={picked?.kind === "overlay" ? picked.i : null}
              onPick={(i) => {
                setPicked(i === null ? null : { kind: "overlay", i });
                const o = i === null ? null : draw.overlays[i];
                if (o && !playing && (t < o.from || t >= o.to)) seek(o.from);
              }}
              commit={commit}
            />
          ) : panel === "captions" ? (
            <CaptionsPanel
              id={id}
              draw={draw}
              lines={data.lines}
              t={t}
              which={cropped ? "short" : "long"}
              picked={picked?.kind === "line" ? picked.i : null}
              onSeek={(at) => {
                if (playing) pause();
                seek(at);
              }}
              commit={commit}
              act={act}
            />
          ) : panel === "cover" ? (
            <CoverPanel draw={draw} t={t} covers={data.covers} onSeek={seek} commit={commit} />
          ) : (
            <ShapesPanel
              draw={draw}
              rendered={data.rendered}
              stale={data.stale}
              view={view}
              onView={setView}
              commit={commit}
            />
          )}
        </div>
      </div>
      <style>
        {"@keyframes finish-in{from{opacity:0;transform:translateY(2px)}to{opacity:1}}"}
      </style>
    </div>
  );
}

/** What their version changed, in words, for Keep mine or Use theirs. */
function whatChanged(mine: FinishEdit, theirs: FinishEdit): ReactNode {
  const names: Record<(typeof FIELDS)[number], string> = {
    cuts: "the cuts",
    overlays: "the text on the video",
    crops: "the crops",
    captions: "the captions",
    thumbnail: "the cover",
    formats: "the shapes",
  };
  const moved = FIELDS.filter((k) => !same(mine[k], theirs[k])).map((k) => names[k]);
  return moved.length ? `They changed ${moved.join(", ")}.` : "Their version matches yours.";
}

const Bar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-(--ui-fill) px-3 py-2 text-[13px] [font-variant-numeric:tabular-nums]">
    {children}
  </div>
);

function ViewSwitch({
  view,
  formats,
  onView,
}: {
  view: Format;
  formats: readonly Format[];
  onView: (f: Format) => void;
}) {
  return (
    <div role="tablist" aria-label="Shape" className="flex rounded-lg bg-(--ui-fill) p-0.5">
      {VIEWS.map(([f, label]) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={view === f}
          onClick={() => onView(f)}
          className={cx(
            "min-h-8 cursor-pointer rounded-md border-0 px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-(--ui-ease)",
            view === f
              ? "bg-(--ui-paper) text-(--ui-ink) shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_var(--ui-hair)]"
              : formats.includes(f)
                ? "bg-transparent text-(--ui-ink-2) hover:text-(--ui-ink)"
                : "bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink-2)",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// --- the stage ------------------------------------------------------------------------------

function Stage({
  data,
  draw,
  view,
  t,
  src,
  pic,
  centre,
  videoRef,
  onError,
  onLoaded,
  picked,
  showCaptionSpot,
  onPick,
  preview,
  release,
}: {
  data: FinishData;
  draw: FinishEdit;
  view: Format;
  t: number;
  src: string | null;
  pic: [number, number];
  centre: Point | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onError: () => void;
  onLoaded: () => void;
  picked: Picked;
  showCaptionSpot: boolean;
  onPick: (i: number) => void;
  preview: (v: FinishEdit) => void;
  release: () => void;
}) {
  const [box, avail] = useWidth<HTMLDivElement>();
  const [fw, fh] = FRAME[view];
  const a = fw / fh;
  const w = Math.max(0, Math.min(avail, STAGE_MAX_H * a));
  const h = w / a;
  const which = view === "long" ? "long" : "short";
  const cap = draw.captions;

  // The picture: whole in 16:9, else the crop window scaled to the stage.
  let picStyle: React.CSSProperties = { inset: 0, width: "100%", height: "100%" };
  if (centre && w) {
    const [x, y, cw, ch] = cropWindow(pic[0], pic[1], FRAME[view], centre);
    picStyle = {
      left: (-x * w) / cw,
      top: (-y * h) / ch,
      width: (pic[0] * w) / cw,
      height: (pic[1] * h) / ch,
    };
  }

  const dragCrop = (e: ReactPointerEvent) => {
    if (!centre || !isCropped(view)) return;
    const f = view;
    const [, , cw, ch] = cropWindow(pic[0], pic[1], FRAME[f], centre);
    const x0 = e.clientX;
    const y0 = e.clientY;
    drag(
      e,
      (ev) => {
        // The picture follows the pointer, so the window moves the other way.
        const dx = ((ev.clientX - x0) * cw) / w / pic[0];
        const dy = ((ev.clientY - y0) * ch) / h / pic[1];
        const next = cropCentre(pic[0], pic[1], FRAME[f], { x: centre.x - dx, y: centre.y - dy });
        preview({ ...draw, crops: { ...draw.crops, [f]: next } });
      },
      () => release(),
    );
  };

  const line = data.lines.find((l) => t >= l.s && t < l.e + 0.15);
  const capY = captionY(cap.place, which);
  const capOn = shownOn(cap, which);
  const capSize = Math.round(Math.min(w, h) * (which === "long" ? 0.045 : 0.06));

  const dragCaption = (e: ReactPointerEvent) => {
    const y0 = e.clientY;
    const [lo, hi] = PLACE[which];
    drag(
      e,
      (ev) => {
        const y = r3(clamp(capY + (ev.clientY - y0) / h, lo, hi));
        preview({ ...draw, captions: { ...cap, place: { ...cap.place, [which]: y } } });
      },
      () => release(),
    );
  };

  return (
    <div ref={box} className="grid min-w-0 justify-items-center">
      <div
        className={cx(
          "relative overflow-hidden rounded-xl bg-black shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-[width,height] duration-300 ease-(--ui-ease)",
          centre && "cursor-grab active:cursor-grabbing",
        )}
        style={{ width: w, height: h }}
        onPointerDown={centre ? dragCrop : undefined}
      >
        {src ? (
          // biome-ignore lint/a11y/useMediaCaption: the captions draw over it from the transcript.
          <video
            key={src.split("?")[0]}
            ref={videoRef}
            src={src}
            preload="auto"
            playsInline
            onLoadedMetadata={onLoaded}
            onError={onError}
            className="pointer-events-none absolute max-w-none object-contain"
            style={picStyle}
          />
        ) : (
          <p className="absolute inset-0 m-0 grid place-items-center p-6 text-center text-[13px] text-white/70">
            Playback shows here after the next render.
          </p>
        )}
        {draw.overlays.map((o, i) => {
          const sel = picked?.kind === "overlay" && picked.i === i;
          const at =
            overlayAt(o, t, w, h) ??
            (sel ? overlayAt({ ...o, from: t, to: t + 1 }, t + 0.5, w, h) : null);
          if (!at) return null;
          return (
            <OverlayText
              // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
              key={i}
              o={o}
              at={at}
              faint={sel && (t < o.from || t >= o.to)}
              selected={sel}
              onDown={(e) => {
                onPick(i);
                const x0 = e.clientX;
                const y0 = e.clientY;
                const m = OVERLAY.margin;
                drag(
                  e,
                  (ev) => {
                    const x = r3(clamp(o.x + (ev.clientX - x0) / w, m, 1 - m));
                    const y = r3(clamp(o.y + (ev.clientY - y0) / h, m, 1 - m));
                    preview({
                      ...draw,
                      overlays: draw.overlays.map((p, j) => (j === i ? { ...p, x, y } : p)),
                    });
                  },
                  () => release(),
                );
              }}
            />
          );
        })}
        {capOn && (line || showCaptionSpot) ? (
          <div
            onPointerDown={dragCaption}
            className={cx(
              "absolute left-1/2 max-w-[86%] -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-lg px-2 text-center font-extrabold text-white select-none [text-shadow:0_2px_6px_rgb(0_0_0/0.6)] [text-wrap:balance]",
              !line && "opacity-60 outline-1 outline-white/60 outline-dashed",
            )}
            style={{ top: capY * h, fontSize: capSize, lineHeight: 1.15 }}
          >
            {line?.text ?? "Captions sit here"}
          </div>
        ) : null}
      </div>
      {centre ? (
        <p className="m-0 mt-2 text-[12px] text-(--ui-ink-3)">Drag the picture to frame it.</p>
      ) : null}
    </div>
  );
}

function OverlayText({
  o,
  at,
  faint,
  selected,
  onDown,
}: {
  o: TextOverlay;
  at: NonNullable<ReturnType<typeof overlayAt>>;
  faint: boolean;
  selected: boolean;
  onDown: (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onDown}
      className={cx(
        "absolute cursor-move rounded-md text-center font-extrabold text-white select-none [text-shadow:0_2px_6px_rgb(0_0_0/0.55),0_8px_30px_rgb(0_0_0/0.35)] [text-wrap:balance]",
        selected && "outline-2 outline-offset-4 outline-white/80 outline-dashed",
      )}
      style={{
        left: at.x,
        top: at.y,
        maxWidth: at.width,
        transform: "translate(-50%, -50%)",
        fontSize: at.size,
        lineHeight: 1.12,
        letterSpacing: -at.size * 0.02,
        opacity: faint ? 0.45 : at.opacity,
      }}
    >
      {o.text}
    </div>
  );
}

// --- the timeline ---------------------------------------------------------------------------

function Timeline({
  dur,
  t,
  playing,
  draw,
  io,
  lines,
  strip,
  size,
  words,
  picked,
  range,
  onSeek,
  onRange,
  onPick,
  preview,
  release,
}: {
  dur: number;
  t: number;
  playing: boolean;
  draw: FinishEdit;
  io: { in: number; out: number };
  lines: readonly CaptionLine[];
  strip: string | null;
  size: [number, number];
  words: readonly { s: number; e: number }[];
  picked: Picked;
  range: [number, number] | null;
  onSeek: (t: number) => void;
  onRange: (r: [number, number] | null) => void;
  onPick: (p: Picked) => void;
  preview: (v: FinishEdit) => void;
  release: () => void;
}) {
  const [frame, viewW] = useWidth<HTMLDivElement>();
  const inner = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const W = Math.max(1, viewW * zoom);
  const x = (s: number) => (s / dur) * W;
  const tAt = (clientX: number) => {
    const r = inner.current?.getBoundingClientRect();
    return r ? clamp(((clientX - r.left) / r.width) * dur, 0, dur) : 0;
  };
  const snapped = (clientX: number) => snapTime(tAt(clientX), words, dur);

  // Keep the playhead in sight while it plays, and after a zoom.
  useEffect(() => {
    const el = frame.current;
    if (!el || zoom === 1) return;
    const px = (t / dur) * W;
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 24)
      el.scrollLeft = Math.max(0, px - (playing ? 24 : el.clientWidth / 2));
  }, [t, W, zoom, dur, playing, frame]);

  const scrub = (e: ReactPointerEvent) => {
    onSeek(tAt(e.clientX));
    drag(
      e,
      (ev) => onSeek(tAt(ev.clientX)),
      () => {},
    );
  };
  const onStrip = (e: ReactPointerEvent) => {
    const a = snapped(e.clientX);
    onPick(null);
    onRange(null);
    drag(
      e,
      (ev) => {
        const b = snapped(ev.clientX);
        onRange([Math.min(a, b), Math.max(a, b)]);
      },
      (ev, moved) => {
        if (!moved) {
          onSeek(tAt(ev.clientX));
          return;
        }
        const b = snapped(ev.clientX);
        if (Math.abs(b - a) < 1 / FPS) onRange(null);
      },
    );
  };
  const onTrim = (side: "in" | "out") => (e: ReactPointerEvent) =>
    drag(
      e,
      (ev) => {
        const at = snapped(ev.clientX);
        preview({ ...draw, cuts: trimCuts(draw.cuts, dur, { [side]: at }) });
        onSeek(side === "in" ? at : at - 1 / FPS);
      },
      () => release(),
    );
  const onEdge = (i: number, side: "from" | "to") => (e: ReactPointerEvent) => {
    onPick({ kind: "cut", i });
    drag(
      e,
      (ev) => {
        const at = snapped(ev.clientX);
        preview({ ...draw, cuts: moveCutEdge(draw.cuts, i, side, at, dur) });
        onSeek(side === "from" ? at - 1 / FPS : at);
      },
      () => release(),
    );
  };
  const onBar = (i: number, part: "body" | "from" | "to") => (e: ReactPointerEvent) => {
    const o = draw.overlays[i] as TextOverlay;
    const t0 = tAt(e.clientX);
    onPick({ kind: "overlay", i });
    drag(
      e,
      (ev) => {
        const d = tAt(ev.clientX) - t0;
        const len = o.to - o.from;
        const next =
          part === "body"
            ? (() => {
                const from = snapFrame(clamp(o.from + d, 0, dur - len));
                return { ...o, from, to: snapFrame(from + len) };
              })()
            : part === "from"
              ? { ...o, from: snapFrame(clamp(o.from + d, 0, o.to - OVERLAY.minS)) }
              : { ...o, to: snapFrame(clamp(o.to + d, o.from + OVERLAY.minS, dur)) };
        preview({ ...draw, overlays: draw.overlays.map((p, j) => (j === i ? next : p)) });
        onSeek(part === "to" ? next.to - 1 / FPS : next.from);
      },
      () => release(),
    );
  };

  // Ruler ticks: the smallest step that leaves room for its label.
  const steps = [1 / FPS, 5 / FPS, 10 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((st) => (st / dur) * W >= 72) ?? 600;
  const ticks: number[] = [];
  for (let s = 0; s <= dur + 1e-6 && ticks.length < 2000; s += step) ticks.push(s);

  // Filmstrip tiles at the picture's shape; each shows the strip frame nearest its middle.
  const rowH = 48;
  const tileW = Math.max(24, rowH * (size[0] / size[1]));
  const tiles = Math.min(3000, Math.ceil(W / tileW));
  const rows = Math.ceil(STRIP_FRAMES / STRIP_ACROSS);

  const trims = (c: Cut) => c.state === "cut" && (c.from <= 0.5 / FPS || c.to >= dur - 0.5 / FPS);
  const ph = x(t);

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-1 text-[12px] text-(--ui-ink-3)">Zoom</span>
        <Button
          size="dense"
          tone="quiet"
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z as 1) - 1)] ?? 1)}
        >
          −
        </Button>
        <Button
          size="dense"
          tone="quiet"
          aria-label="Zoom in"
          disabled={zoom >= (ZOOMS.at(-1) as number)}
          onClick={() =>
            setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z as 1) + 1)] ?? 1)
          }
        >
          +
        </Button>
      </div>
      <div
        ref={frame}
        className="min-w-0 overflow-x-auto overflow-y-hidden rounded-xl border border-(--ui-hair) bg-(--ui-fill) [scrollbar-width:thin]"
      >
        <div ref={inner} className="relative select-none" style={{ width: W }}>
          {/* Ruler: press or drag to scrub. */}
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur * FPS)}
            aria-valuenow={Math.round(t * FPS)}
            aria-valuetext={stamp(t)}
            onPointerDown={scrub}
            className="relative h-6 cursor-text border-b border-(--ui-hair)"
          >
            {ticks.map((s) => (
              <span
                key={s}
                className="absolute top-0 h-full border-l border-(--ui-hair) pl-1 text-[10.5px] leading-6 text-(--ui-ink-3) [font-variant-numeric:tabular-nums]"
                style={{ left: x(s) }}
              >
                {step < 1 ? stamp(s) : short(s)}
              </span>
            ))}
            {draw.thumbnail ? (
              <span
                {...{ title: `Cover at ${stamp(draw.thumbnail.at)}` }}
                className="absolute top-1 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-(--ui-active)"
                style={{ left: x(draw.thumbnail.at) }}
              />
            ) : null}
          </div>

          {/* Filmstrip with what's cut over it: drag across to pick a part. */}
          <div
            onPointerDown={onStrip}
            className="relative cursor-crosshair overflow-hidden bg-black/80"
            style={{ height: rowH }}
          >
            {strip
              ? Array.from({ length: tiles }, (_, i) => {
                  const mid = ((i + 0.5) * tileW * dur) / W;
                  const k = Math.min(STRIP_FRAMES - 1, Math.floor((mid / dur) * STRIP_FRAMES));
                  const col = k % STRIP_ACROSS;
                  const row = Math.floor(k / STRIP_ACROSS);
                  return (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positions.
                      key={i}
                      className="absolute top-0 h-full"
                      style={{
                        left: i * tileW,
                        width: tileW,
                        backgroundImage: `url(${strip})`,
                        backgroundSize: `${STRIP_ACROSS * 100}% ${rows * 100}%`,
                        backgroundPosition: `${(col / (STRIP_ACROSS - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
                      }}
                    />
                  );
                })
              : null}
            {draw.cuts.map((c, i) =>
              c.state === "kept" ? null : (
                <span
                  key={`${c.from}-${c.to}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onRange(null);
                    onPick({ kind: "cut", i });
                    onSeek(c.from);
                  }}
                  className={cx(
                    "absolute top-0 h-full cursor-pointer transition-colors duration-150",
                    c.state === "cut"
                      ? "bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.78)_0_6px,rgb(0_0_0/0.6)_6px_12px)]"
                      : "border-x border-dashed border-white/50 bg-white/10",
                    picked?.kind === "cut" &&
                      picked.i === i &&
                      "outline-2 -outline-offset-2 outline-(--ui-active)",
                  )}
                  style={{ left: x(c.from), width: Math.max(2, x(c.to) - x(c.from)) }}
                />
              ),
            )}
            {range ? (
              <span
                className="pointer-events-none absolute top-0 h-full bg-(--ui-active)/30 outline-2 -outline-offset-2 outline-(--ui-active)"
                style={{ left: x(range[0]), width: Math.max(2, x(range[1]) - x(range[0])) }}
              />
            ) : null}
            {draw.cuts.map((c, i) =>
              c.state !== "cut" || trims(c) ? null : (
                <span key={`e-${c.from}-${c.to}`}>
                  <Handle at={x(c.from)} label="Cut start" onDown={onEdge(i, "from")} thin />
                  <Handle at={x(c.to)} label="Cut end" onDown={onEdge(i, "to")} thin />
                </span>
              ),
            )}
            <Handle at={x(io.in)} label="Start" onDown={onTrim("in")} side="in" />
            <Handle at={x(io.out)} label="End" onDown={onTrim("out")} side="out" />
          </div>

          {/* Text on the video. */}
          <div className="relative h-7 border-t border-(--ui-hair)">
            {draw.overlays.map((o, i) => {
              const sel = picked?.kind === "overlay" && picked.i === i;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
                  key={i}
                  onPointerDown={onBar(i, "body")}
                  className={cx(
                    "absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap transition-[background-color,box-shadow] duration-150 active:cursor-grabbing",
                    sel
                      ? "bg-(--ui-active) text-(--ui-on-accent) shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
                      : "bg-(--ui-accent-tint) text-(--ui-ink)",
                  )}
                  style={{ left: x(o.from), width: Math.max(8, x(o.to) - x(o.from)) }}
                >
                  <span
                    onPointerDown={onBar(i, "from")}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                  />
                  {o.text}
                  <span
                    onPointerDown={onBar(i, "to")}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                  />
                </span>
              );
            })}
          </div>

          {/* Caption lines. */}
          <div className="relative h-7 border-t border-(--ui-hair)">
            {lines.map((l, i) => {
              const sel = picked?.kind === "line" && picked.i === i;
              return (
                <button
                  key={l.at.join()}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    onPick({ kind: "line", i });
                    onSeek(l.s);
                  }}
                  {...{ title: l.text }}
                  className={cx(
                    "absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-[5px] border-0 px-1 text-left text-[10.5px] whitespace-nowrap transition-colors duration-150",
                    sel
                      ? "bg-(--ui-ink) text-(--ui-on-ink)"
                      : "bg-(--ui-paper) text-(--ui-ink-2) hover:text-(--ui-ink)",
                  )}
                  style={{ left: x(l.s), width: Math.max(3, x(l.e) - x(l.s) - 1) }}
                >
                  {l.text}
                </button>
              );
            })}
          </div>

          {/* The playhead, over every row. */}
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--ui-bad)"
            style={{ left: ph }}
          >
            <span className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rounded-b-[3px] bg-(--ui-bad)" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** A grip on the timeline: the clip's start or end, or a cut's edge. */
function Handle({
  at,
  label,
  onDown,
  side,
  thin,
}: {
  at: number;
  label: string;
  onDown: (e: ReactPointerEvent) => void;
  side?: "in" | "out";
  thin?: boolean;
}) {
  return (
    <span
      onPointerDown={onDown}
      {...{ title: label }}
      className={cx(
        "group absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize justify-center",
      )}
      style={{ left: at }}
    >
      <span
        className={cx(
          "h-full transition-[width,background-color] duration-150 ease-(--ui-ease)",
          thin
            ? "w-0.5 bg-white/70 group-hover:w-1 group-hover:bg-white"
            : cx(
                "w-1.5 bg-(--ui-active) group-hover:w-2",
                side === "in" ? "rounded-l-[4px]" : "rounded-r-[4px]",
              ),
        )}
      />
    </span>
  );
}

// --- the panels -----------------------------------------------------------------------------

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[12.5px] text-(--ui-ink-2)">{children}</p>
);

function Choice<T extends string>({
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
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-(--ui-fill) p-0.5">
      {options.map(([v, text]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control, drawn as buttons.
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "min-h-7 cursor-pointer rounded-md border-0 px-2.5 text-[12.5px] font-medium transition-[background-color,color] duration-150 ease-(--ui-ease)",
            value === v
              ? "bg-(--ui-paper) text-(--ui-ink) shadow-[0_0_0_0.5px_var(--ui-hair)]"
              : "bg-transparent text-(--ui-ink-2) hover:text-(--ui-ink)",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const SIZE_NAMES: Record<OverlaySize, string> = { s: "Small", m: "Medium", l: "Large" };

function TextPanel({
  draw,
  t,
  dur,
  picked,
  onPick,
  commit,
}: {
  draw: FinishEdit;
  t: number;
  dur: number;
  picked: number | null;
  onPick: (i: number | null) => void;
  commit: (v: FinishEdit) => void;
}) {
  const put = (i: number, o: Partial<TextOverlay>) =>
    commit({ ...draw, overlays: draw.overlays.map((p, j) => (j === i ? { ...p, ...o } : p)) });
  const full = draw.overlays.length >= OVERLAY.max;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={full}
          onClick={() => {
            commit({ ...draw, overlays: [...draw.overlays, newOverlay(t, dur)] });
            onPick(draw.overlays.length);
          }}
        >
          Add text here
        </Button>
        <Hint>
          {full
            ? `${OVERLAY.max} is the most.`
            : "Drag it on the picture to move it. Drag its bar to time it."}
        </Hint>
      </div>
      {draw.overlays.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {draw.overlays.map((o, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
              key={i}
              className={cx(
                "grid gap-2 rounded-lg border p-2 transition-colors duration-150",
                picked === i ? "border-(--ui-active) bg-(--ui-wash)" : "border-(--ui-hair)",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
                >
                  {stamp(o.from)} to {stamp(o.to)}
                </button>
                <input
                  value={o.text}
                  maxLength={OVERLAY.maxChars}
                  aria-label="Text"
                  onFocus={() => onPick(i)}
                  onChange={(e) => put(i, { text: e.target.value })}
                  className={cx(
                    "h-8 min-w-0 flex-1 rounded-md border bg-(--ui-paper) px-2 text-[13.5px] outline-none focus:border-(--ui-focus)",
                    o.text.trim() ? "border-(--ui-hair)" : "border-(--ui-bad)",
                  )}
                />
              </div>
              {picked === i ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Choice
                    label="Size"
                    value={o.size}
                    options={OVERLAY_SIZES.map((z) => [z, SIZE_NAMES[z]] as const)}
                    onChange={(size) => put(i, { size })}
                  />
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={t > o.to - OVERLAY.minS}
                    onClick={() => put(i, { from: snapFrame(t) })}
                  >
                    Show from here
                  </Button>
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={t < o.from + OVERLAY.minS}
                    onClick={() => put(i, { to: snapFrame(Math.min(dur, t)) })}
                  >
                    Hide from here
                  </Button>
                  <Button
                    size="sm"
                    tone="quiet"
                    className="ml-auto"
                    onClick={() => {
                      commit({ ...draw, overlays: draw.overlays.filter((_, j) => j !== i) });
                      onPick(null);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Hint>No text on the video yet.</Hint>
      )}
    </div>
  );
}

function CaptionsPanel({
  id,
  draw,
  lines,
  t,
  which,
  picked,
  onSeek,
  commit,
  act,
}: {
  id: string;
  draw: FinishEdit;
  lines: readonly CaptionLine[];
  t: number;
  which: "long" | "short";
  picked: number | null;
  onSeek: (t: number) => void;
  commit: (v: FinishEdit) => void;
  act: RecordAct;
}) {
  const cap = draw.captions;
  const list = useRef<HTMLOListElement | null>(null);
  const now = lines.findIndex((l) => t >= l.s && t < l.e + 0.15);
  const lit = picked ?? now;
  // The line playing (or picked) stays in view in the list.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${lit}"]`);
    const box = list.current;
    if (!el || !box) return;
    if (el.offsetTop < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight - 40)
      box.scrollTop = el.offsetTop - box.clientHeight / 3;
  }, [lit]);
  const [lo, hi] = PLACE[which];
  const y = captionY(cap.place, which);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Choice
          label="Style"
          value={cap.style}
          options={STYLES}
          onChange={(style) => commit({ ...draw, captions: { ...cap, style } })}
        />
        {(
          [
            ["long", "On the long video"],
            ["short", "On the vertical and Shorts"],
          ] as const
        ).map(([f, label]) => (
          <label key={f} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={shownOn(cap, f)}
              onChange={(e) =>
                commit({
                  ...draw,
                  captions: { ...cap, [f]: e.target.checked ? "screen" : "track" },
                })
              }
              className="size-4 accent-(--ui-active)"
            />
            {label}
          </label>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="text-(--ui-ink-2)">
          Height {which === "long" ? "on the long video" : "on the vertical and Shorts"}
        </span>
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.005}
          value={y}
          onChange={(e) =>
            commit({
              ...draw,
              captions: { ...cap, place: { ...cap.place, [which]: Number(e.target.value) } },
            })
          }
          className="w-48 accent-(--ui-active)"
        />
        <span className="text-(--ui-ink-3)">Or drag the line on the picture.</span>
      </label>
      {lines.length ? (
        <>
          <Hint>Fix a line and press Enter. Its timing stays.</Hint>
          <ol
            ref={list}
            className="relative m-0 grid max-h-64 list-none gap-0.5 overflow-y-auto rounded-lg border border-(--ui-hair) p-1"
          >
            {lines.map((l, i) => (
              <LineRow
                key={`${l.at.join()}:${l.text}`}
                id={id}
                line={l}
                i={i}
                lit={i === lit}
                onSeek={onSeek}
                act={act}
              />
            ))}
          </ol>
        </>
      ) : (
        <Hint>No captions yet. They come from the transcript.</Hint>
      )}
    </div>
  );
}

/** One caption line: its start, and its words, fixed in place. */
function LineRow({
  id,
  line,
  i,
  lit,
  onSeek,
  act,
}: {
  id: string;
  line: CaptionLine;
  i: number;
  lit: boolean;
  onSeek: (t: number) => void;
  act: RecordAct;
}) {
  const [text, setText] = useState(line.text);
  const [said, setSaid] = useState<{ bad: boolean; words: string } | null>(null);
  const send = async () => {
    const next = text.trim().replace(/\s+/g, " ");
    if (next === line.text) return;
    if (!next) {
      setText(line.text);
      return;
    }
    setSaid({ bad: false, words: "Saving…" });
    try {
      await ACTIONS.run(`video-line:${id}:${line.at.join()}:${next}`, (requestId) =>
        act(LINE, { at: line.at, text: next, was: line.text, requestId }),
      );
      setSaid(null);
    } catch (err) {
      setSaid({ bad: true, words: err instanceof Error ? err.message : String(err) });
    }
  };
  return (
    <li
      data-line={i}
      className={cx(
        "flex items-center gap-2 rounded-md px-1.5 transition-colors duration-150",
        lit ? "bg-(--ui-fill)" : "",
      )}
    >
      <button
        type="button"
        onClick={() => onSeek(line.s)}
        className="w-14 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-left text-[11.5px] text-(--ui-ink-3) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
      >
        {short(line.s)}
      </button>
      <input
        value={text}
        aria-label={`Caption at ${short(line.s)}`}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => onSeek(line.s)}
        onBlur={() => void send()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") setText(line.text);
        }}
        className="h-7 min-w-0 flex-1 rounded-[5px] border border-transparent bg-transparent px-1.5 text-[13px] outline-none hover:border-(--ui-hair) focus:border-(--ui-focus) focus:bg-(--ui-paper)"
      />
      {said ? (
        <span
          className={cx(
            "shrink-0 text-[11.5px]",
            said.bad ? "text-(--ui-bad)" : "text-(--ui-ink-3)",
          )}
        >
          {said.words}
        </span>
      ) : null}
    </li>
  );
}

function CoverPanel({
  draw,
  t,
  covers,
  onSeek,
  commit,
}: {
  draw: FinishEdit;
  t: number;
  covers: FinishData["covers"];
  onSeek: (t: number) => void;
  commit: (v: FinishEdit) => void;
}) {
  const at = draw.thumbnail?.at;
  const shots = (Object.entries(covers) as [CroppedFormat, string][]).filter(([, u]) => u);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() =>
            commit({ ...draw, thumbnail: { at: snapFrame(t), text: draw.thumbnail?.text ?? "" } })
          }
        >
          Use this frame
        </Button>
        {at !== undefined ? (
          <button
            type="button"
            onClick={() => onSeek(at)}
            className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-(--ui-ink-2) [font-variant-numeric:tabular-nums] hover:text-(--ui-ink)"
          >
            Cover at {stamp(at)}
          </button>
        ) : (
          <Hint>No cover yet. Posts use the first frame.</Hint>
        )}
      </div>
      <Hint>The cover on Reels and TikTok, and the frame under the YouTube thumbnail.</Hint>
      {shots.length ? (
        <div className="flex flex-wrap gap-3">
          {shots.map(([f, url]) => (
            <figure key={f} className="m-0 grid gap-1">
              <img
                src={url}
                alt={`Cover, ${f}`}
                className="h-32 rounded-lg bg-black object-contain"
              />
              <figcaption className="text-[11.5px] text-(--ui-ink-3)">
                {VIEWS.find(([v]) => v === f)?.[1]}, last render
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShapesPanel({
  draw,
  rendered,
  stale,
  view,
  onView,
  commit,
}: {
  draw: FinishEdit;
  rendered: readonly Format[];
  stale: readonly string[] | null;
  view: Format;
  onView: (f: Format) => void;
  commit: (v: FinishEdit) => void;
}) {
  const flip = (f: Format, on: boolean) => {
    const next = SHAPES.map(([x]) => x).filter((x) => (x === f ? on : draw.formats.includes(x)));
    if (next.length) commit({ ...draw, formats: next });
  };
  return (
    <div className="grid gap-3">
      <Hint>Each platform gets the shape it shows best. Render again to make new ones.</Hint>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {SHAPES.map(([f, label, where]) => {
          const on = draw.formats.includes(f);
          const moved = isCropped(f) && !!draw.crops[f];
          return (
            <li
              key={f}
              className={cx(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150",
                view === f ? "border-(--ui-active)" : "border-(--ui-hair)",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={on && draw.formats.length === 1}
                aria-label={`Make ${label}`}
                onChange={(e) => flip(f, e.target.checked)}
                className="size-4 accent-(--ui-active)"
              />
              <button
                type="button"
                onClick={() => onView(f)}
                className="grid cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <span className="text-[13.5px] font-medium">{label}</span>
                <span className="text-[12.5px] text-(--ui-ink-2)">{where}</span>
              </button>
              <span className="ml-auto flex items-center gap-2">
                {rendered.includes(f) ? (
                  stale?.includes(f) ? (
                    <span className="text-[12px] text-(--ui-warn-ink)">
                      Changed since it rendered
                    </span>
                  ) : (
                    <span className="text-[12px] text-(--ui-good-ink)">Rendered</span>
                  )
                ) : null}
                {moved ? (
                  <Button
                    size="sm"
                    tone="quiet"
                    onClick={() => {
                      const crops = { ...draw.crops };
                      delete crops[f as CroppedFormat];
                      commit({ ...draw, crops });
                    }}
                  >
                    Reset the crop
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
