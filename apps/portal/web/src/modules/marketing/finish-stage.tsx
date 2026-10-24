/** The Finish stage: the player over the recording with the view switch and the bar under it. */
import {
  CAPTION_LOOK,
  captionShown,
  captionTrack,
  captionY,
  cornerCam,
  cropCentre,
  cropWindow,
  FPS,
  FRAME,
  isCropped,
  longCaption,
  OVERLAY,
  overlayAt,
  type Point,
  REEL,
  reelCaption,
  reelY,
} from "@wren/studio/finish";
import { cx } from "@wren/ui";
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
  src,
  pic,
  centre,
  shortNo,
  videoRef,
  camSrc,
  camRef,
  onCamError,
  words,
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
  /** The Short whose own crop a drag writes (9:16 only); null writes the format's crop. */
  shortNo: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The camera file's playback copy, for the long video's corner (null in other shapes). */
  camSrc: string | null;
  camRef: React.RefObject<HTMLVideoElement | null>;
  onCamError: () => void;
  words: readonly Word[];
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
  // What the long video shows now: the camera in the corner, alone, or not at all.
  const show = data.layout?.find((r) => t >= r.from && t < r.to)?.show ?? "corner";

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
        {view === "long" && camSrc && show !== "screen" ? (
          <div
            className="pointer-events-none"
            style={show === "cam" ? { position: "absolute", inset: 0 } : cornerCam(w, h)}
          >
            <video
              key={camSrc.split("?")[0]}
              ref={camRef}
              src={camSrc}
              muted
              preload="auto"
              playsInline
              onError={onCamError}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = t + 0.5 / FPS;
              }}
              className="absolute inset-0 h-full w-full object-cover"
            />
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
                <ShownCaption line={line} style={cap.style} size={capLook.size} />
              ) : (
                "Captions sit here"
              )}
            </div>
          </div>
        ) : null}
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
      </div>
      {centre ? (
        <p className="m-0 mt-2 text-[12px] text-(--ui-ink-3)">Drag the picture to frame it.</p>
      ) : null}
    </div>
  );
}
