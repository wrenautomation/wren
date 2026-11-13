import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { type ExplorerFixture, explorerMap } from "../fixtures/explorer.js";
import { ExplorerMap, type MapIn, type MapPick } from "./index.js";

export default {
  title: "Components/Charts and graphs/Map",
  id: "graph-map",
} satisfies Meta;

type Story = StoryObj;

/** The page's part: holds the fold and the pick, asks core's `mapAt` (over the fixture) for each fold. */
function Demo({
  depth = 2,
  fixture,
  opened = {},
}: {
  depth?: number;
  fixture?: ExplorerFixture;
  /** boxes the viewer opened before the story starts */
  opened?: Record<string, boolean>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(opened);
  const [map, setMap] = useState<MapIn | null>(null);
  const [picked, setPicked] = useState<MapPick | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a story's fixture is fixed
  useEffect(() => {
    // read-ok: a story's fixture through core's mapAt; the page reads through useLoad
    let live = true;
    void explorerMap({ depth, open }, fixture).then((m) => live && setMap(m));
    return () => {
      live = false;
    };
  }, [open, depth]);
  if (!map) return null;
  return (
    <div className="flex flex-col gap-2">
      <ExplorerMap
        map={map}
        label="Canon, as a map"
        onOpen={(path, o) => setOpen((x) => ({ ...x, [path]: o }))}
        picked={picked}
        onPick={setPicked}
      />
      <p data-testid="picked" className="text-[13px] text-(--ui-ink-2)">
        {picked ? `Picked ${picked.kind === "box" ? picked.path : picked.id}` : "Nothing picked"}
      </p>
    </div>
  );
}

const box = (el: HTMLElement, path: string) =>
  el.querySelector<HTMLElement>(`[data-map="b:${path}"]`);
const drawn = (el: HTMLElement, path: string) =>
  waitFor(() => expect(box(el, path)).not.toBeNull(), { timeout: 10_000 });
/** lines draw a frame after their boxes: React Flow measures the ends first */
const lined = (el: HTMLElement) =>
  waitFor(() => expect(el.querySelectorAll("[data-line]").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });

/** The default fold: small areas open, a big one (References, 30) closed; lines bundle the links. */
export const Default: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics");
    expect(box(el, "canon/topics")?.hasAttribute("data-open")).toBe(true);
    expect(box(el, "canon/topics/bread-baking")?.hasAttribute("data-open")).toBe(false);
    expect(box(el, "canon/references")?.hasAttribute("data-open")).toBe(false);
    await lined(el);
  },
};

/** The glide proof: open a topic; its layers grow out of it, under 300 ms. */
export const OpenBox: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics/bread-baking");
    // each animate call, kept: the glide ends (under 300 ms) before a poll would see it
    const moved: Element[] = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args) {
      moved.push(this);
      return animate.apply(this, args);
    };
    try {
      await userEvent.click(box(el, "canon/topics/bread-baking") as HTMLElement);
      await drawn(el, "canon/topics/bread-baking/sets");
      // the glide runs on the inner divs, never on React Flow's wrapper
      await waitFor(() => expect(moved.some((m) => m.closest("[data-map]"))).toBe(true));
      expect(moved.some((m) => m.classList.contains("react-flow__node"))).toBe(false);
    } finally {
      Element.prototype.animate = animate;
    }
    expect(box(el, "canon/topics/bread-baking")?.hasAttribute("data-open")).toBe(true);
    expect(el.querySelector('[data-testid="picked"]')?.textContent).toBe(
      "Picked canon/topics/bread-baking",
    );
  },
};

/** Fold an open box from its title's close button: its rows shrink back into it. */
export const FoldBox: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics/plating");
    const close = el.querySelector<HTMLElement>('[aria-label="Close Topics"]');
    await userEvent.click(close as HTMLElement);
    await waitFor(() => expect(box(el, "canon/topics/plating")).toBeNull(), { timeout: 10_000 });
    expect(box(el, "canon/topics")?.hasAttribute("data-open")).toBe(false);
  },
};

/** Pick a line: it lights, the rest dim. */
export const PickLine: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics");
    await lined(el);
    const line = el.querySelector<SVGGElement>("[data-line]");
    const id = line?.dataset.line ?? "";
    const hit = line?.nextElementSibling as SVGPathElement | null;
    await userEvent.click(hit as unknown as HTMLElement);
    await waitFor(() =>
      expect(el.querySelector('[data-testid="picked"]')?.textContent).toBe(`Picked ${id}`),
    );
    const dim = [...el.querySelectorAll<SVGGElement>("[data-line]")].filter(
      (g) => g.dataset.line !== id,
    );
    for (const g of dim) expect(g.style.opacity).toBe("0.14");
  },
};

/** Opened past the cap: it stays closed and says why. */
export const TooMany: Story = {
  render: () => <Demo fixture={{ refs: 400 }} opened={{ "canon/references": true }} />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/references");
    expect(box(el, "canon/references")?.hasAttribute("data-full")).toBe(true);
    expect(box(el, "canon/references")?.textContent).toMatch(/Too many to draw/);
  },
};

/** An adapter with no links: boxes only, and a line that says so. */
export const NoLinks: Story = {
  render: () => <Demo fixture={{ noEdges: true }} />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics");
    expect(el.querySelectorAll("[data-line]").length).toBe(0);
    expect(el.textContent).toMatch(/No links between these/);
  },
};

/** Long names wrap whole, never cut; links out to another root show their count. */
export const WorstCase: Story = {
  render: () => <Demo fixture={{ worst: true }} />,
  play: async ({ canvasElement: el }) => {
    await drawn(el, "canon/topics");
    await waitFor(() => expect(el.textContent).toMatch(/links to vireo/));
  },
};
