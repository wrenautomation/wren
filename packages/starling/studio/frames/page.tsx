/**
 * The render page: one composition on the runtime, driven from outside by the seek protocol
 * `@hyperframes/engine` captures through (`window.__hf = { duration, seek }`, then
 * `__hfWaitForSeekCompletion`). `?play` turns the same page into a local preview with a scrubber.
 */

import { createElement, type ReactElement, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { COMPOSITIONS } from "../compositions/index.tsx";
import { Player, usePlayClock } from "./player.tsx";
import {
  type Clock,
  ClockContext,
  type CompositionEntry,
  configOf,
  type FrameMode,
  soundNotes,
} from "./runtime.tsx";

type Job = { composition: string; props: unknown };
// the job's props are the named composition's: `wren video` builds both
type Entry = CompositionEntry<unknown>;
const url = (file: string) => `/media/${file.split("/").map(encodeURIComponent).join("/")}`;

const Preview = ({ entry, props }: { entry: Entry; props: unknown }): ReactElement => {
  const config = configOf(entry, props);
  const clock = usePlayClock(config.fps, config.durationInFrames);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space") clock.play(!clock.playing);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <div
      style={{ display: "grid", gridTemplateRows: "1fr auto", height: "100vh", background: "#111" }}
    >
      <Player
        composition={entry}
        props={props}
        frame={clock.frame}
        playing={clock.playing}
        url={url}
        onWait={clock.hold}
        style={{ maxHeight: "calc(100vh - 56px)", margin: "0 auto", width: "100%" }}
      />
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: 12,
          color: "#ddd",
          font: "13px ui-monospace, monospace",
        }}
      >
        <button type="button" onClick={() => clock.play(!clock.playing)}>
          {clock.playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={config.durationInFrames - 1}
          value={clock.frame}
          onChange={(e) => clock.seek(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span>
          {(clock.frame / config.fps).toFixed(2)} s /{" "}
          {(config.durationInFrames / config.fps).toFixed(2)} s
        </span>
      </div>
    </div>
  );
};

async function main(): Promise<void> {
  const job = (await (await fetch("job.json")).json()) as Job;
  const entry = (COMPOSITIONS as unknown as Record<string, Entry>)[job.composition];
  if (!entry) throw new Error(`no composition ${job.composition}`);
  const stage = document.getElementById("stage") as HTMLDivElement;
  const root = createRoot(stage);
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));

  if (new URLSearchParams(location.search).has("play")) {
    root.render(createElement(Preview, { entry, props: job.props }));
    return;
  }

  const config = configOf(entry, job.props);
  stage.className = "frame-stage";
  stage.style.cssText = `position:relative;overflow:hidden;width:${config.width}px;height:${config.height}px`;
  const draw = (frame: number, mode: FrameMode): void => {
    const clock: Clock = { frame, start: 0, config, mode, playing: false, url };
    flushSync(() =>
      root.render(
        createElement(
          ClockContext.Provider,
          { value: clock },
          createElement(entry.component, job.props as never),
        ),
      ),
    );
  };
  // every image on screen decoded: a capture never sees a half-loaded frame
  const settle = async (): Promise<void> => {
    await Promise.all(
      [...stage.querySelectorAll("img")].map((i) => i.decode().catch(() => undefined)),
    );
  };
  const w = window as unknown as Record<string, unknown>;
  w.__frames = {
    config,
    sounds: () => {
      soundNotes.clear();
      for (let f = 0; f < config.durationInFrames; f++) draw(f, "scan");
      return soundNotes.list();
    },
  };
  w.__hfWaitForSeekCompletion = settle;
  draw(0, "render");
  await settle();
  w.__hf = {
    duration: config.durationInFrames / config.fps,
    seek: (seconds: number) => draw(Math.round(seconds * config.fps), "render"),
  };
}

main().catch((e) => {
  (window as unknown as { __hfStartupError: string }).__hfStartupError = String(e?.stack ?? e);
});
