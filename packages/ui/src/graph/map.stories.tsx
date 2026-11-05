import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useRef, useState } from "react";
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
