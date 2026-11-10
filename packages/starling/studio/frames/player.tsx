/**
 * The composition live in a page (the editor's preview): the real picture at `frame`, scaled to
 * fit its box. The caller owns the clock; `usePlayClock` is one that runs on the display's frames.
 */

import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Clock, ClockContext, type CompositionEntry, configOf } from "./runtime.tsx";

export type PlayerProps<P> = {
  composition: CompositionEntry<P>;
  props: P;
  frame: number;
  playing: boolean;
  /** A file name in the edit's folder to its URL (a signed S3 link, a local path). */
  url: (file: string) => string;
  style?: CSSProperties;
};

export function Player<P>(p: PlayerProps<P>): ReactElement {
  const config = useMemo(() => configOf(p.composition, p.props), [p.composition, p.props]);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = () =>
      setScale(Math.min(el.clientWidth / config.width, el.clientHeight / config.height));
    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);
    return () => watch.disconnect();
  }, [config.width, config.height]);
  const clock: Clock = {
    frame: Math.max(0, Math.min(config.durationInFrames - 1, Math.round(p.frame))),
    start: 0,
    config,
    mode: "play",
    playing: p.playing,
    url: p.url,
  };
  const Component = p.composition.component as (props: P) => ReactElement;
  return (
    <div
      ref={box}
      style={{
        position: "relative",
        overflow: "hidden",
        aspectRatio: `${config.width} / ${config.height}`,
        ...p.style,
      }}
    >
      {scale > 0 ? (
        <div
          className="frame-stage"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: config.width,
            height: config.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
            overflow: "hidden",
          }}
        >
          <ClockContext.Provider value={clock}>
            <Component {...(p.props as P & object)} />
          </ClockContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A clock on the display's frames: `frame` moves at `fps` while `playing`, stops at the end.
 * `seek` moves it by hand.
 */
export function usePlayClock(
  fps: number,
  durationInFrames: number,
): { frame: number; playing: boolean; seek: (frame: number) => void; play: (on: boolean) => void } {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const from = useRef({ frame: 0, at: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the start frame is read once per play
  useEffect(() => {
    if (!playing) return;
    from.current = { frame, at: performance.now() };
    let raf = 0;
    const tick = (now: number) => {
      const next = from.current.frame + Math.floor(((now - from.current.at) / 1000) * fps);
      if (next >= durationInFrames - 1) {
        setFrame(durationInFrames - 1);
        setPlaying(false);
        return;
      }
      setFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, durationInFrames]);
  return {
    frame,
    playing,
    seek: (f) => {
      const at = Math.max(0, Math.min(durationInFrames - 1, Math.round(f)));
      from.current = { frame: at, at: performance.now() };
      setFrame(at);
    },
    play: setPlaying,
  };
}
