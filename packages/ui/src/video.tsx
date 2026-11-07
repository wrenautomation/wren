/**
 * A video with the kit's controls (WA-1172): a round play over the first frame, then a bar under
 * the frame, never over it, so a box can be drawn on any part. The scrubber carries marks (spans
 * or moments, toned good or bad; a click jumps to the mark's start). Custom, not media-chrome:
 * marks sit on the track's own geometry, and callers keep the bare <video> (play in step, boxes).
 */
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cx } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";

export interface VideoMark {
  id: string | number;
  start: number;
  end?: number | undefined;
  tone?: "good" | "bad" | null | undefined;
  /** Faint: a span still being marked. */
  live?: boolean;
}

/** m:ss */
export const videoClock = (s: number) => {
  const v = Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = Math.floor(v / 60);
  const r = Math.floor(v - m * 60);
  return `${m}:${r < 10 ? "0" : ""}${r}`;
};

const MARK = { good: "bg-(--ui-good)", bad: "bg-(--ui-bad)" } as const;
/** The glass play mark over a still (put in a `group` button): one look for every sample. */
export const PLAY_MARK =
  "flex size-14 items-center justify-center rounded-full bg-black/30 text-white shadow-[0_2px_12px_rgb(0_0_0/0.25)] ring-1 ring-white/35 backdrop-blur-md transition-[background-color,scale] duration-150 ease-(--ui-ease) group-hover:scale-105 group-hover:bg-black/45 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-(--ui-focus) group-active:scale-95 motion-reduce:transition-none";
/** A bar button: the kit's quiet icon button. */
export const VIDEO_BUTTON =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-(--ui-leaf-button) border-0 bg-transparent text-(--ui-ink-2) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-pressed:bg-(--ui-accent-wash) aria-pressed:text-(--ui-accent) pointer-coarse:size-11";

export function Video({
  src,
  poster,
  marks = [],
  tools,
  frame,
  locked = false,
  className,
  ref,
  onTime,
}: {
  src: string;
  poster?: string | null | undefined;
  marks?: readonly VideoMark[];
  /** The caller's buttons, between the scrubber and sound (use `VIDEO_BUTTON`). */
  tools?: ReactNode;
  /** Layers over the frame (boxes, a cover), under the round play. */
  frame?: ReactNode;
  /** The frame takes the pointer (a box is drawn): no play on a click there; the bar still works. */
  locked?: boolean;
  className?: string;
  ref?: Ref<HTMLVideoElement>;
  onTime?: (t: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // set before any caller effect reads it
  useImperativeHandle(ref, () => video.current as HTMLVideoElement, []);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const seek = (to: number) => {
    const v = video.current;
    if (!v || !dur) return;
    v.currentTime = Math.min(dur, Math.max(0, to));
    setT(v.currentTime);
  };
  const seekAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (r?.width) seek(((clientX - r.left) / r.width) * dur);
  };
  const at = (s: number) => `${dur ? (Math.min(Math.max(s, 0), dur) / dur) * 100 : 0}%`;
  const time = (e: { currentTarget: HTMLVideoElement }) => {
    setT(e.currentTarget.currentTime);
    onTime?.(e.currentTarget.currentTime);
  };

  return (
    <div
      ref={box}
      className={cx("flex min-w-0 flex-col", full && "bg-(--ui-paper) p-3", className)}
    >
      <div
        className={cx(
          "relative overflow-hidden rounded-(--ui-radius) bg-black",
          full && "min-h-0 flex-1",
        )}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: our own drafts and clips, no captions yet */}
        <video
          ref={video}
          src={src}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          className={cx("block w-full", full ? "h-full object-contain" : "aspect-video")}
          onClick={locked ? undefined : toggle}
          onPlay={() => {
            setPlaying(true);
            setStarted(true);
          }}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onTimeUpdate={time}
          onSeeked={time}
        />
        {frame}
        {!started && !locked && (
          <button
            type="button"
            aria-label="Play"
            onClick={toggle}
            className="group absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none"
          >
            <span className={PLAY_MARK}>
              <Icon name="play" size={22} className="translate-x-px" />
            </span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-0.5 pt-1">
        <button
          type="button"
          className={VIDEO_BUTTON}
          onClick={toggle}
          {...tipProps(playing ? "Pause" : "Play", { as: "name" })}
        >
          <Icon name={playing ? "pause" : "play"} size={15} />
        </button>
        <span className="shrink-0 px-1 text-[12px] text-(--ui-ink-2) tabular-nums">
          {videoClock(t)} / {videoClock(dur)}
        </span>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          aria-valuetext={`${videoClock(t)} of ${videoClock(dur)}`}
          className="group mx-3 flex h-8 min-w-10 flex-1 cursor-pointer touch-none items-center outline-none"
          onPointerDown={(e) => {
            // a mark: jump to its start
            const mark = (e.target as HTMLElement).dataset.start;
            if (mark) return seek(Number(mark));
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(true);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => drag && seekAt(e.clientX)}
          onPointerUp={() => setDrag(false)}
          onPointerCancel={() => setDrag(false)}
          onKeyDown={(e) => {
            const by: Record<string, number> = {
              ArrowRight: 1,
              ArrowLeft: -1,
              ArrowUp: 5,
              ArrowDown: -5,
            };
            const step = by[e.key];
            if (step) seek(t + step);
            else if (e.key === "Home") seek(0);
            else if (e.key === "End") seek(dur);
            else return;
            e.preventDefault();
          }}
        >
          <div className="relative h-1.5 w-full rounded-full bg-(--ui-edge) outline-offset-4 group-focus-visible:outline-2 group-focus-visible:outline-(--ui-accent)">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-(--ui-ink-3)"
              style={{ width: at(t) }}
            />
            {marks.map((m) => (
              // not a button: no control inside the slider (axe nested-interactive)
              <span
                key={m.id}
                data-start={m.start}
                className={cx(
                  "absolute -inset-y-0.5 min-w-1.5 cursor-pointer rounded-full",
                  m.live
                    ? "min-w-1 bg-(--ui-accent) opacity-55"
                    : m.tone
                      ? MARK[m.tone]
                      : "bg-(--ui-accent)",
                )}
                style={{
                  left: at(m.start),
                  width: `calc(${at(m.end ?? m.start)} - ${at(m.start)})`,
                }}
              />
            ))}
            <div
              className={cx(
                "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--ui-ink) shadow-(--ui-float) ring-2 ring-(--ui-paper) transition-opacity",
                drag
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
              style={{ left: at(t) }}
            />
          </div>
        </div>
        {tools}
        <button
          type="button"
          className={VIDEO_BUTTON}
          onClick={() => {
            if (video.current) video.current.muted = !video.current.muted;
          }}
          {...tipProps(muted ? "Sound on" : "Mute", { as: "name" })}
        >
          <Icon name={muted ? "muted" : "sound"} size={16} />
        </button>
        <button
          type="button"
          className={VIDEO_BUTTON}
          onClick={() =>
            full
              ? void document.exitFullscreen().catch(() => {})
              : void box.current?.requestFullscreen().catch(() => {})
          }
          {...tipProps(full ? "Leave full screen" : "Full screen", { as: "name" })}
        >
          <Icon name={full ? "shrink" : "expand"} size={15} />
        </button>
      </div>
    </div>
  );
}
