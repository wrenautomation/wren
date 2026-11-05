import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef, useState } from "react";
import { expect, waitFor } from "storybook/test";
import { islandsMap } from "../fixtures/map.js";
import { MapCanvas, type MapHandle } from "./index.js";

export default {
  title: "Charts/Map",
  id: "graph-map",
} satisfies Meta;

type Story = StoryObj;

const drawn = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await waitFor(() => expect(canvasElement.querySelector("canvas")).not.toBeNull(), {
    timeout: 10_000,
  });
};

/** Frames a camera sweep in and out takes: the bench reads `data-fps`. */
function Bench({ n, pick = null }: { n: number; pick?: string | null }) {
  const m = useMemo(() => islandsMap(n), [n]);
  const map = useRef<MapHandle>(null);
  const [selected, setSelected] = useState<string | null>(pick);
  const [fps, setFps] = useState<number | null>(null);
  const sweep = async () => {
    let frames = 0;
    let going = true;
    const count = () => {
      frames++;
      if (going) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    const t = performance.now();
    await map.current?.flyTo("r0q0p0", 0.01);
    await map.current?.whole();
    going = false;
    setFps(Math.round((frames * 1000) / (performance.now() - t)));
  };
  return (
    <div className="flex h-[720px] flex-col gap-2">
      <div className="flex items-center gap-3 text-[13px] text-(--ui-ink-2)">
        <span>{m.dots.length.toLocaleString()} dots</span>
        <button type="button" className="underline" onClick={sweep}>
          Measure
        </button>
        <span data-fps={fps ?? ""}>{fps === null ? "" : `${fps} FPS`}</span>
        <span>{selected ?? ""}</span>
      </div>
      <MapCanvas
        dots={m.dots}
        links={m.links}
        label="Research map"
        selected={selected}
        onSelect={setSelected}
        handle={map}
      />
    </div>
  );
}

/** About 15k dots: today's ledgers. */
export const Default: Story = { render: () => <Bench n={15_000} />, play: drawn };

/** 100k dots: the bar is 60 FPS while the camera moves. */
export const Hundred: Story = { render: () => <Bench n={100_000} />, play: drawn };

/** A run picked: it and its queries lift over the veil. */
export const Picked: Story = { render: () => <Bench n={15_000} pick="r0" />, play: drawn };

const STOPS = ["r0", "r0q3", "r7", "r7q6p2", "r24"];
const HOLD_MS = 2200;

/** For the demo film: whole map, then run to query to page across islands, then whole again; loops. */
function Tour() {
  const m = useMemo(() => islandsMap(15_000), []);
  const map = useRef<MapHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await wait(1500);
      while (live) {
        for (const id of STOPS) {
          if (!live) return;
          setSelected(id);
          // runs framed with their island, deeper dots closer
          await map.current?.flyTo(id, id.includes("p") ? 0.03 : id.includes("q") ? 0.06 : 0.12);
          await wait(HOLD_MS);
        }
        setSelected(null);
        await map.current?.whole();
        await wait(HOLD_MS);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="h-[720px]">
      <MapCanvas
        dots={m.dots}
        links={m.links}
        label="Research map"
        selected={selected}
        onSelect={setSelected}
        handle={map}
      />
    </div>
  );
}

/** The demo's fly-through. */
export const FlyThrough: Story = { render: () => <Tour />, play: drawn };
