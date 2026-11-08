/**
 * One weaver run as a graph (round 13, artifact LdYvUurK): the claim web, the search tree and
 * lanes. Open states are clicked in `play`, so the story runs the same code a click does.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import {
  RUN_GRAPH,
  RUN_GRAPH_EMPTY,
  RUN_GRAPH_ONE_ROUND,
  RUN_GRAPH_WORST,
} from "../../fixtures/index.js";
import { RunGraph } from "./graph.js";

export default {
  title: "Parts/Weaver run graph",
  id: "research-run",
  component: RunGraph,
  parameters: { layout: "padded" },
} satisfies Meta<typeof RunGraph>;

type Story = StoryObj<typeof RunGraph>;

const mark = async (root: HTMLElement, key: string) => {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = root.querySelector<HTMLElement>(`.rg-nodes [data-n="${key}"]`);
    expect(el).not.toBeNull();
  });
  return el as unknown as HTMLElement;
};

/** Once the web is still (font redraw, open tween): no two marks share a spot or overlap. */
const apart = async (root: HTMLElement) => {
  await document.fonts.ready;
  // the font redraw and the 460 ms tween land after this
  await new Promise((r) => setTimeout(r, 700));
  const bs = [...root.querySelectorAll<HTMLElement>(".rg-nodes [data-n]:not(.gone)")].map((e) => [
    e.dataset.n,
    e.getBoundingClientRect(),
  ]) as [string, DOMRect][];
  const hits: string[] = [];
  bs.forEach(([ka, a], i) => {
    for (const [kb, b] of bs.slice(i + 1)) {
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) hits.push(`${ka} ${kb}`);
    }
  });
  expect(bs.length).toBeGreaterThan(1);
  expect(hits).toEqual([]);
};

/** Every mark gets its own place, also after a still redraw (fonts, resize): no pile at 0,0. */
export const Default: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    await mark(canvasElement, "c0");
    await apart(canvasElement);
  },
};
export const Tree: Story = { args: { run: RUN_GRAPH, lay: "tree" } };
export const Lanes: Story = { args: { run: RUN_GRAPH, lay: "lanes" } };
export const OneRound: Story = { args: { run: RUN_GRAPH_ONE_ROUND } };
export const Empty: Story = { args: { run: RUN_GRAPH_EMPTY } };
export const Loading: Story = { args: { run: undefined } };
export const Failed: Story = { args: { failed: "weaver serve stopped answering." } };
export const WorstCase: Story = { args: { run: RUN_GRAPH_WORST } };

/** A claim opens in place into its findings; the panel shows the claim. */
export const ClaimOpen: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    await userEvent.click(await mark(canvasElement, "c0"));
    await waitFor(() => expect(canvasElement.querySelector(".rg-nodes .open")).not.toBeNull());
    await waitFor(() =>
      expect(canvasElement.querySelector(".rg-panel")?.textContent).toMatch(
        /Most shops price custom cakes/,
      ),
    );
    await apart(canvasElement);
  },
};

/** A claim, then a source under it: two levels open. */
export const SourceOpen: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    await userEvent.click(await mark(canvasElement, "c0"));
    const src = RUN_GRAPH.sources.find((s) => (s.claims[0] ?? 0) > 0);
    if (!src) return;
    await userEvent.click(await mark(canvasElement, `s${src.id}`));
    await waitFor(() => expect(canvasElement.querySelectorAll(".rg-nodes .open").length).toBe(2));
    await apart(canvasElement);
  },
};

/** The Dropped tab, one reason picked, one hit marked to read. */
export const ReadQueue: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    localStorage.removeItem(`weaver-read:${RUN_GRAPH.rid}`);
    const side = canvasElement.querySelector<HTMLElement>(".rg-side");
    if (!side) return;
    const tab = [...side.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Dropped"),
    );
    if (tab) await userEvent.click(tab);
    const g = side.querySelector<HTMLElement>(".dg");
    if (g) await userEvent.click(g);
    const rd = await waitFor(() => {
      const b = canvasElement.querySelector<HTMLElement>(".rg-panel button.rd");
      expect(b).not.toBeNull();
      return b as HTMLElement;
    });
    await userEvent.click(rd);
    await waitFor(() =>
      expect(side.querySelector(".qbar")?.textContent).toMatch(/to read next round/),
    );
  },
};
