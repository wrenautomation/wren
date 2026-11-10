/**
 * The frame runtime (designs/2026-11-10-video-editor-pick.md, E1): a composition is React drawn
 * from one number, the frame. The same tree runs three ways: `render` (the export: each video is
 * one extracted frame as an image, so a capture is exact), `play` (the editor: real `<video>` and
 * `<audio>` kept on the clock) and `scan` (one pass that lists every sound for the mix).
 */

import {
  type ComponentType,
  type CSSProperties,
  createContext,
  type FC,
  type ImgHTMLAttributes,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";

export type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number };
export type FrameMode = "render" | "play" | "scan";

export type Clock = {
  /** The output's frame. */
  frame: number;
  /** The output frame the nearest Sequence starts on. */
  start: number;
  config: VideoConfig;
  mode: FrameMode;
  /** `play` only: the clock runs, so media plays; false = a still at `frame`. */
  playing: boolean;
  /** A file name in the edit's folder to its URL. */
  url: (file: string) => string;
};

export const ClockContext = createContext<Clock | null>(null);

const useClock = (): Clock => {
  const c = useContext(ClockContext);
  if (!c) throw new Error("no frame clock: draw compositions inside a Player or the render page");
  return c;
};

/** The frame inside the nearest Sequence. */
export const useCurrentFrame = (): number => {
  const c = useClock();
  return c.frame - c.start;
};

export const useVideoConfig = (): VideoConfig => useClock().config;

const FILL: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

export const AbsoluteFill: FC<{
  style?: CSSProperties | undefined;
  className?: string | undefined;
  children?: ReactNode;
}> = ({ style, className, children }) => (
  <div className={className} style={{ ...FILL, ...style }}>
    {children}
  </div>
);

/** Its children exist from `from` for `durationInFrames`, on a clock that starts there. */
export const Sequence: FC<{
  from?: number;
  durationInFrames?: number;
  /** `none`: no box of its own. */
  layout?: "none" | "absolute-fill";
  children?: ReactNode;
}> = ({ from = 0, durationInFrames = Number.POSITIVE_INFINITY, layout, children }) => {
  const c = useClock();
  const local = c.frame - c.start - from;
  if (local < 0 || local >= durationInFrames) return null;
  const inner = (
    <ClockContext.Provider value={{ ...c, start: c.start + from }}>
      {children}
    </ClockContext.Provider>
  );
  return layout === "none" ? inner : <AbsoluteFill>{inner}</AbsoluteFill>;
};

/** A file in the edit's folder, as the composition names it. Resolved where it is drawn. */
export const staticFile = (file: string): string => file;

export const Img: FC<ImgHTMLAttributes<HTMLImageElement>> = ({ src, ...rest }) => {
  const c = useClock();
  // biome-ignore lint/a11y/useAltText: a frame of a video file, not a page
  return <img {...rest} src={typeof src === "string" ? c.url(src) : src} />;
};

/** A sound the scan pass found: enough for ffmpeg to place it. Frames are the output's. */
export type SoundNote = {
  file: string;
  /** Output frame it starts on. */
  at: number;
  /** Output frames it plays for. */
  frames: number;
  /** Frames skipped at the file's start. */
  trim: number;
  volume: number;
  loop: boolean;
  /** A volume that moves: one value per frame from `at`. */
  curve?: number[];
};

// one note per unbroken run of frames an element is on screen; `open` = the run each element is in
const sounds: SoundNote[] = [];
const open = new Map<string, SoundNote>();
export const soundNotes = {
  clear: (): void => {
    sounds.length = 0;
    open.clear();
  },
  list: (): SoundNote[] => sounds,
};

type Volume = number | ((frame: number) => number);

const note = (id: string, c: Clock, file: string, trim: number, volume: Volume, loop: boolean) => {
  if (c.mode !== "scan") return;
  const local = c.frame - c.start;
  let n = open.get(id);
  // a gap, or another file in the same place: a new sound
  if (!n || n.file !== file || c.frame > n.at + n.frames) {
    n = {
      file,
      at: c.frame,
      frames: 0,
      trim: trim + local,
      volume: typeof volume === "number" ? volume : 1,
      loop,
    };
    if (typeof volume !== "number") n.curve = [];
    open.set(id, n);
    sounds.push(n);
  }
  n.frames = c.frame - n.at + 1;
  if (n.curve && typeof volume !== "number") n.curve[c.frame - n.at] = volume(local);
};

/** How far a playing element may run from the clock before it is moved, seconds. */
const DRIFT_S = 0.12;

/** Keep a media element on the clock (`play` mode): seek a still, let a playing one run. */
function useOnClock(
  ref: RefObject<HTMLMediaElement | null>,
  seconds: number,
  playing: boolean,
  volume: number,
  loop: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume));
    const length = Number.isFinite(el.duration) ? el.duration : 0;
    const at = loop && length > 0 ? seconds % length : seconds;
    const off = Math.abs(el.currentTime - at);
    if (playing) {
      if (off > DRIFT_S) el.currentTime = at;
      if (el.paused) el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (off > 0.001) el.currentTime = at;
    }
  });
  useEffect(
    () => () => {
      ref.current?.pause();
    },
    [ref],
  );
}

export type VideoProps = {
  src: string;
  style?: CSSProperties;
  /** Frames skipped at the file's start. */
  trimBefore?: number;
  /** The file has an alpha channel (a matte). */
  transparent?: boolean;
  muted?: boolean;
  volume?: number;
};

/** One extracted frame per output frame, from the frame server (`frame-server.ts`). */
const VideoFrame: FC<VideoProps & { c: Clock }> = ({
  c,
  src,
  style,
  trimBefore = 0,
  transparent,
}) => {
  const f = c.frame - c.start + trimBefore;
  const q = `file=${encodeURIComponent(src)}&frame=${f}&fps=${c.config.fps}${transparent ? "&alpha=1" : ""}`;
  // biome-ignore lint/a11y/useAltText: a frame of a video file
  return <img src={`/frame?${q}`} style={style} />;
};

const VideoPlaying: FC<VideoProps & { c: Clock }> = ({
  c,
  src,
  style,
  trimBefore = 0,
  muted,
  volume = 1,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const seconds = (c.frame - c.start + trimBefore) / c.config.fps;
  useOnClock(ref, seconds, c.playing, volume, false);
  return (
    <video ref={ref} src={c.url(src)} muted={!!muted} playsInline preload="auto" style={style} />
  );
};

export const Video: FC<VideoProps> = (p) => {
  const c = useClock();
  const id = useId();
  if (!p.muted) note(id, c, p.src, p.trimBefore ?? 0, p.volume ?? 1, false);
  if (c.mode === "scan") return null;
  return c.mode === "render" ? <VideoFrame {...p} c={c} /> : <VideoPlaying {...p} c={c} />;
};

export type AudioProps = {
  src: string;
  /** A number, or a value per frame from the sound's start. */
  volume?: Volume;
  trimBefore?: number;
  loop?: boolean;
};

const AudioPlaying: FC<AudioProps & { c: Clock }> = ({
  c,
  src,
  volume = 1,
  trimBefore = 0,
  loop = false,
}) => {
  const ref = useRef<HTMLAudioElement>(null);
  const local = c.frame - c.start;
  const v = typeof volume === "number" ? volume : volume(local);
  useOnClock(ref, (local + trimBefore) / c.config.fps, c.playing, v, loop);
  // biome-ignore lint/a11y/useMediaCaption: a sound effect or the bed
  return <audio ref={ref} src={c.url(src)} preload="auto" />;
};

export const Audio: FC<AudioProps> = (p) => {
  const c = useClock();
  const id = useId();
  note(id, c, p.src, p.trimBefore ?? 0, p.volume ?? 1, p.loop ?? false);
  return c.mode === "play" ? <AudioPlaying {...p} c={c} /> : null;
};

/** A composition by name: its component and how its props size it. */
export type CompositionEntry<P> = {
  component: ComponentType<P>;
  /** Used when the props name no size, rate or length. */
  config: VideoConfig;
  metadata?: (props: P) => Partial<VideoConfig>;
};

export const configOf = <P,>(entry: CompositionEntry<P>, props: P): VideoConfig => ({
  ...entry.config,
  ...entry.metadata?.(props),
});
