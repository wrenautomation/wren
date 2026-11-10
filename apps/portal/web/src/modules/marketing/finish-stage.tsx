/**
 * The Finish stage: the render's composition playing the raw recording (`finish-preview.ts`), with
 * clear handles over it for what he drags (the crop, the caption line, each text), the view switch
 * and the bar under it.
 */
import {
  CAPTION_LOOK,
  captionShown,
  captionTrack,
  captionY,
  cropCentre,
  cropWindow,
  FRAME,
  isCropped,
  longCaption,
  OVERLAY,
  overlayAt,
  type Point,
  REEL,
  reelCaption,
  reelY,
} from "@wren/starling-studio/finish";
import { Player } from "@wren/starling-studio/player";
import { Button, cx } from "@wren/ui";
import { type ReactNode, type PointerEvent as ReactPointerEvent, useMemo } from "react";
import { OverlayText, ShownCaption } from "./finish-caption.js";
import {
  clamp,
  type FinishData,
  type FinishEdit,
  type Format,
  type Picked,
  PLACE,
  r3,
  STAGE_MAX_H,
  shownOn,
  VIEWS,
  type Word,
} from "./finish-data.js";
import { drag, useWidth } from "./finish-hooks.js";
import { boxDrag, type Mark, type MarkBox, MarkBoxes } from "./finish-marks.js";
import { previewOf } from "./finish-preview.js";

export const Bar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-(--ui-fill) px-3 py-2 text-[13px] [font-variant-numeric:tabular-nums]">
    {children}
  </div>
);

export function ViewSwitch({
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

export function Stage({
  data,
  draw,
  view,
  t,
  frame,
  playing,
  url,
  ready,
  lost,
  tries,
  onRetry,
  pic,
  centre,
  shortNo,
  words,
  onWait,
  onFailed,
  picked,
  showCaptionSpot,
  onPick,
  preview,
  release,
  marking,
}: {
  data: FinishData;
  draw: FinishEdit;
  view: Format;
  /** Raw seconds on the recording: where the handles are drawn for. */
  t: number;
  /** The frame of the cut the player shows. */
  frame: number;
  playing: boolean;
  /** A file the composition names to its link. */
  url: (file: string) => string;
  /** False until the recording has a playback copy. */
  ready: boolean;
  /** The recording's link failed and the page has no newer one. */
  lost: boolean;
  /** Retries so far: a new count loads the files again. */
  tries: number;
  onRetry: () => void;
  pic: [number, number];
  centre: Point | null;
  /** The Short whose own crop a drag writes (9:16 only); null writes the format's crop. */
  shortNo: number | null;
  words: readonly Word[];
  /** The player loads or seeks: the clock holds. */
  onWait: (waiting: boolean) => void;
  /** A file's link ran out. */
  onFailed: (file: string) => void;
  picked: Picked;
  showCaptionSpot: boolean;
  onPick: (i: number) => void;
  preview: (v: FinishEdit) => void;
  release: () => void;
  /** The Marks panel is open: the boxes show, and a drag on the picture draws one. */
  marking?: {
    marks: readonly Mark[];
    picked: number | null;
    draft: MarkBox | null;
    onDraft: (b: MarkBox | null) => void;
  } | null;
}) {
  const [box, avail] = useWidth<HTMLDivElement>();
  const [fw, fh] = FRAME[view];
  const a = fw / fh;
  const w = Math.max(0, Math.min(avail, STAGE_MAX_H * a));
  const h = w / a;
  const which = view === "long" ? "long" : "short";
  const cap = draw.captions;

  // The render's composition for this shape, on the raw recording.
  const shown = useMemo(
    () => previewOf(data, draw, words, view, centre),
    [data, draw, words, view, centre],
  );

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
        preview({
          ...draw,
          crops: shortNo
            ? { ...draw.crops, shorts: { ...draw.crops.shorts, [String(shortNo)]: next } }
            : { ...draw.crops, [f]: next },
        });
      },
      () => release(),
    );
  };

  // The captions as the render breaks and times them, on the cut this view draws.
  const track = useMemo(
    () => captionTrack(words, draw.cuts, data.durationS, which),
    [words, draw.cuts, data.durationS, which],
  );
  const line = captionShown(track, t);
  const capY = captionY(cap.place, which);
  const capOn = shownOn(cap, which);
  const chars = line ? line.words.reduce((n, x) => n + x.w.length, line.words.length - 1) : 16;
  const capLook =
    which === "long"
      ? longCaption(w, h, cap.place?.long, CAPTION_LOOK.font)
      : (() => {
          const r = reelCaption(w, reelY(h, cap.place), chars, REEL.maxChars, CAPTION_LOOK.font);
          return { box: r.box, text: {}, size: r.size };
        })();
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
          marking ? "cursor-crosshair" : centre && "cursor-grab active:cursor-grabbing",
        )}
        style={{ width: w, height: h }}
        onPointerDown={marking ? (e) => boxDrag(e, marking.onDraft) : centre ? dragCrop : undefined}
      >
        {ready ? (
          <Player
            key={tries}
            composition={shown.composition}
            props={shown.props}
            frame={frame}
            playing={playing}
            url={url}
            onWait={onWait}
            onFailed={onFailed}
            style={{ width: w, height: h, pointerEvents: "none", userSelect: "none" }}
          />
        ) : (
          <p className="absolute inset-0 m-0 grid place-items-center p-6 text-center text-[13px] text-white/70">
            Playback shows here after the next render.
          </p>
        )}
        {lost ? (
          <div
            role="alert"
            className="absolute inset-0 grid place-content-center justify-items-center gap-3 bg-black p-6 text-center text-[14px] text-white/85"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="m-0">The recording did not load.</p>
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
        {capOn && (line || showCaptionSpot) ? (
          <div className="pointer-events-none" style={capLook.box}>
            <div
              onPointerDown={dragCaption}
              className={cx(
                "pointer-events-auto cursor-ns-resize select-none",
                !line && "rounded-lg opacity-60 outline-1 outline-white/60 outline-dashed",
              )}
              style={capLook.text}
            >
              {line ? (
                // The player draws the line; this is its handle, the same size.
                <div className="opacity-0">
                  <ShownCaption line={line} style={cap.style} size={capLook.size} />
                </div>
              ) : (
                "Captions sit here"
              )}
            </div>
          </div>
        ) : null}
        {draw.overlays.map((o, i) => {
          const sel = picked?.kind === "overlay" && picked.i === i;
          // On screen the player draws it; a picked one outside its time shows faint here.
          const on = overlayAt(o, t, w, h);
          const at = on ?? (sel ? overlayAt({ ...o, from: t, to: t + 1 }, t + 0.5, w, h) : null);
          if (!at) return null;
          return (
            <OverlayText
              // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
              key={i}
              o={o}
              at={at}
              faint={sel && (t < o.from || t >= o.to)}
              selected={sel}
              clear={!!on}
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
        {marking ? (
          <MarkBoxes
            marks={marking.marks}
            view={view}
            t={t}
            picked={marking.picked}
            draft={marking.draft}
          />
        ) : null}
      </div>
      {/* always a line: a hint that comes and goes would move the timeline */}
      <p className="m-0 mt-2 min-h-[18px] text-[12px] text-(--ui-ink-3)">
        {marking
          ? "Drag on the picture to mark a part of it."
          : centre
            ? "Drag the picture to frame it."
            : ""}
      </p>
    </div>
  );
}
