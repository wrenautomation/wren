/**
 * One weaver run as the query web (11-08): each search a hub with its answer, the sources with
 * findings around it. Open states are clicked in `play`, so the story runs the same code a click does.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import {
  RUN_GRAPH,
  RUN_GRAPH_EMPTY,
  RUN_GRAPH_ONE_ROUND,
  RUN_GRAPH_RUNS,
  RUN_GRAPH_WORST,
} from "../../fixtures/index.js";
import { RunGraph } from "./graph.js";

export default {
  title: "Charts/Weaver run graph",
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
    await mark(canvasElement, "q0");
    await apart(canvasElement);
  },
};
export const OneRound: Story = { args: { run: RUN_GRAPH_ONE_ROUND } };
export const Empty: Story = { args: { run: RUN_GRAPH_EMPTY } };
export const Loading: Story = { args: { run: undefined } };
export const Failed: Story = { args: { failed: "weaver serve stopped answering." } };
export const WorstCase: Story = { args: { run: RUN_GRAPH_WORST } };

/** Several runs: each run is a hub with its sources; a click opens the run into its searches. */
export const SeveralRuns: Story = {
  args: { run: RUN_GRAPH_RUNS },
  play: async ({ canvasElement }) => {
    await apart(canvasElement);
    await userEvent.click(await mark(canvasElement, "r1"));
    await mark(canvasElement, "q0");
    await apart(canvasElement);
  },
};

/** A search opens in place into the hits it kept with no finding and the hits it dropped; the panel shows the search. */
export const SearchOpen: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    const q = RUN_GRAPH.searches.find(
      (x) =>
        x.ss.some((id) => !RUN_GRAPH.sources.find((s) => s.id === id)?.kept) ||
        RUN_GRAPH.dropped.some((d) => d.q.includes(x.i)),
    );
    if (!q) return;
    await userEvent.click(await mark(canvasElement, `q${q.i}`));
    await waitFor(() => expect(canvasElement.querySelector(".rg-nodes .open")).not.toBeNull());
    await waitFor(() =>
      expect(canvasElement.querySelector(".rg-panel")?.textContent).toContain(q.t),
    );
    await apart(canvasElement);
  },
};

/** A source with findings opens into its pages, then a page into its findings: two levels open. */
export const SourceOpen: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    const src = RUN_GRAPH.sources.find((s) => s.kept && s.pages.length);
    if (!src) return;
    await userEvent.click(await mark(canvasElement, `s${src.id}`));
    const pi = src.pages.findIndex((_, i) => src.fs.some((f) => f.p === i));
    await userEvent.click(await mark(canvasElement, `p${src.id}.${pi}`));
    await waitFor(() => expect(canvasElement.querySelectorAll(".rg-nodes .open").length).toBe(2));
    await apart(canvasElement);
  },
};

/** The Dropped tab, one reason picked: each hit links to its page. */
export const Dropped: Story = {
  args: { run: RUN_GRAPH },
  play: async ({ canvasElement }) => {
    const side = canvasElement.querySelector<HTMLElement>(".rg-side");
    if (!side) return;
    const tab = [...side.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Dropped"),
    );
    if (tab) await userEvent.click(tab);
    const g = side.querySelector<HTMLElement>(".dg");
    if (g) await userEvent.click(g);
    await waitFor(() => {
      const a = canvasElement.querySelector<HTMLAnchorElement>(".rg-panel a.rd");
      expect(a?.textContent).toBe("Open the page");
      expect(a?.target).toBe("_blank");
    });
  },
};
