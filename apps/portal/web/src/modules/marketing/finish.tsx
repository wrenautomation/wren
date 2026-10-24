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
  type CroppedFormat,
  FPS,
  inOut,
  isCropped,
  playFrom,
  shortCrop,
  snapFrame,
  trimCuts,
} from "@wren/studio/finish";
import type { Cut } from "@wren/studio/schema";
import { Button, type RecordAct, SaveConflict, SaveStatus, useSaved } from "@wren/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { wrenRecords } from "../../records.js";
import {
  clamp,
  FIELDS,
  type FinishData,
  type FinishEdit,
  type Format,
  normal,
  type Panel,
  type Picked,
  problem,
  SAVE_DELAY_MS,
  SET,
  same,
  short,
  stable,
  stamp,
  type Word,
  whatChanged,
} from "./finish-data.js";
import { useSteadyUrl } from "./finish-hooks.js";
import { CaptionsPanel, CoverPanel, ShapesPanel, TextPanel } from "./finish-panels.js";
import { LayoutPanel, ShortsPanel } from "./finish-parts.js";
import { Bar, Stage, ViewSwitch } from "./finish-stage.js";
import { Timeline } from "./finish-timeline.js";
import { VIEWED } from "./video-patch.js";

export function Finish({
  id,
  data,
  words,
  act,
  at,
}: {
  id: string;
  data: FinishData;
  words: readonly Word[];
  act: RecordAct;
  /** When the page's read of `data` left: a read from before his newest save never lands. */
  at?: number | undefined;
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
    at,
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
      // The answer patches the page: the video isn't read again after a save.
      if (Object.keys(patch).length) await act(SET, { patch, expect, requestId: request }, VIEWED);
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
  // The Short whose own crop the 9:16 view shows (null: the whole cut's 9:16 crop).
  const [pickedShort, setPickedShort] = useState<number | null>(null);
  const shortView = view === "vertical" ? pickedShort : null;
  const [panel, setPanel] = useState<Panel>("text");
  const [picked, setPicked] = useState<Picked>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [t, setT] = useState(() => io.in);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  // The camera file in the long video's corner, kept on the recording's clock.
  const camVideo = useRef<HTMLVideoElement | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const keepRef = useRef(keep);
  keepRef.current = keep;
  const root = useRef<HTMLDivElement | null>(null);

  const cropped = isCropped(view);
  const useCam = cropped && data.picture.source === "cam" && !!data.sourceCam && !!data.camSize;
  const [src, renew] = useSteadyUrl(useCam ? data.sourceCam : data.source);
  const pic: [number, number] = useCam ? (data.camSize as [number, number]) : data.size;
  const [camSrc, renewCam] = useSteadyUrl(view === "long" ? data.sourceCam : null);

  // Paused, the corner camera shows the frame the recording shows.
  useEffect(() => {
    const cam = camVideo.current;
    if (!cam || playing) return;
    cam.pause();
    if (Math.abs(cam.currentTime - t) > 0.5 / FPS) cam.currentTime = t + 0.5 / FPS;
  }, [t, playing]);

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
      const cam = camVideo.current;
      if (cam) {
        if (Math.abs(cam.currentTime - next) > 0.15) cam.currentTime = next;
        if (cam.paused) cam.play().catch(() => {});
      }
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
  const shorts = useMemo(() => data.shorts.map(({ n: _n, ...x }) => x), [data.shorts]);
  const [shortSaid, setShortSaid] = useState<string | null>(null);
  /** The picked part as a new Short, saved at once (`wren video set shorts`). */
  const makeShort = async () => {
    if (!range) return;
    setShortSaid(null);
    try {
      await act(
        SET,
        {
          patch: { shorts: [...shorts, { from: range[0], to: range[1], title: "" }] },
          expect: { shorts },
        },
        VIEWED,
      );
      setRange(null);
      setPanel("shorts");
    } catch (err) {
      setShortSaid(err instanceof Error ? err.message : String(err));
    }
  };

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
        <ViewSwitch
          view={view}
          formats={draw.formats}
          onView={(f) => {
            setView(f);
            setPickedShort(null);
          }}
        />
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
        shortNo={shortView}
        centre={
          cropped
            ? ((shortView ? shortCrop(draw.crops, shortView) : draw.crops[view as CroppedFormat]) ??
              (useCam ? { x: 0.5, y: 0.5 } : data.picture.centre))
            : null
        }
        videoRef={video}
        camSrc={camSrc}
        camRef={camVideo}
        onCamError={renewCam}
        words={words}
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
        shorts={shorts}
        layout={data.layout ?? []}
        onShort={(i) => {
          if (playing) pause();
          seek(shorts[i]?.from ?? 0);
          setPanel("shorts");
        }}
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
          <Button size="sm" tone="quiet" onClick={() => void makeShort()}>
            Make a Short
          </Button>
          <Button size="sm" tone="quiet" onClick={() => setPanel("layout")}>
            Set the layout
          </Button>
          <Button size="sm" tone="quiet" onClick={() => setRange(null)}>
            Clear
          </Button>
          {shortSaid ? <span className="text-(--ui-bad)">{shortSaid}</span> : null}
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
        across the filmstrip to pick a part: cut it, make it a Short, or set what it shows.
      </p>

      <div className="grid gap-3 rounded-xl border border-(--ui-hair) bg-(--ui-paper) p-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Finish">
          {(
            [
              ["text", "Text"],
              ["captions", "Captions"],
              ["cover", "Cover"],
              ["shapes", "Shapes"],
              ["shorts", "Shorts"],
              ["layout", "Layout"],
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
              editKey={`video-finish:${id}`}
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
          ) : panel === "shorts" ? (
            <ShortsPanel
              id={id}
              shorts={shorts}
              dur={dur}
              t={t}
              range={range}
              onSeek={(at) => {
                if (playing) pause();
                seek(at);
              }}
              act={act}
            />
          ) : panel === "layout" ? (
            <LayoutPanel
              id={id}
              layout={data.layout ?? []}
              camBox={data.camBox ?? null}
              size={data.size}
              dur={dur}
              t={t}
              range={range}
              act={act}
            />
          ) : (
            <ShapesPanel
              draw={draw}
              rendered={data.rendered}
              stale={data.stale}
              shorts={data.face ? data.shorts : []}
              shortNo={shortView}
              onShort={(n) => {
                setPickedShort(n);
                if (n) setView("vertical");
              }}
              view={view}
              onView={(f) => {
                setView(f);
                setPickedShort(null);
              }}
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

export { OverlayText, ShownCaption } from "./finish-caption.js";
export type { FinishData, FinishEdit } from "./finish-data.js";
export { STRIP_ACROSS, STRIP_FRAMES, shownOn } from "./finish-data.js";
