import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { LOOP_EDGES, RIBBON_EDGES, RIBBON_NODES, wideGraph } from "../fixtures/graph.js";
import { PRESETS, themeVars } from "../theme.js";
import { Graph } from "./index.js";

export default {
  title: "Charts/Ribbons",
  id: "graph-ribbons",
} satisfies Meta;

type Story = StoryObj;

const NIGHT = themeVars(PRESETS.night);

/** Waits for the layout, then checks that a ribbon drew. */
const drawn = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await waitFor(
    () => expect(canvasElement.querySelector(".react-flow__edge path")).not.toBeNull(),
    {
      timeout: 10_000,
    },
  );
};

/** A shape top to bottom: each ribbon's width is the people who crossed it. */
export const Default: Story = {
  render: () => (
    <Graph
      nodes={RIBBON_NODES}
      edges={RIBBON_EDGES}
      label="Ribbons"
      direction="down"
      ribbons
      tools={false}
      maxHeight={720}
    />
  ),
  play: drawn,
};

/** The ribbons on the night ground, with no grid and no frame. */
export const Dark: Story = {
  render: () => (
    <div data-ui-theme="" style={NIGHT} className="bg-(--ui-canvas) p-4 text-(--ui-ink)">
      <Graph
        nodes={RIBBON_NODES}
        edges={RIBBON_EDGES}
        label="Ribbons, night"
        direction="down"
        ribbons
        bare
        tools={false}
        maxHeight={720}
      />
    </div>
  ),
  play: drawn,
};

/** Nothing to draw: one plain line. */
export const Empty: Story = {
  render: () => <Graph nodes={[]} edges={[]} label="Ribbons" ribbons />,
};

/** The nearest real state: a graph has no loading state of its own; its chunk shows a pulse. */
export const Loading: Story = {
  render: () => <div className="h-40 w-full animate-pulse bg-(--ui-tile)" aria-busy="true" />,
};

/** The nearest real state: a graph with nodes and no wires draws the nodes alone. */
export const Failed: Story = {
  render: () => (
    <Graph nodes={RIBBON_NODES} edges={[]} label="Ribbons, no wires" direction="down" ribbons />
  ),
  play: ({ canvasElement }) =>
    waitFor(() => expect(canvasElement.querySelector(".react-flow__node")).not.toBeNull(), {
      timeout: 10_000,
    }),
};

/** Returns to an earlier step: thin and dashed, and they never change the layers. */
export const Loops: Story = {
  render: () => (
    <Graph
      nodes={RIBBON_NODES}
      edges={LOOP_EDGES}
      label="Ribbons with loops"
      direction="down"
      ribbons
      tools={false}
      maxHeight={720}
    />
  ),
  play: drawn,
};

/** 40 nodes, counts past a billion, long names, loops, and a one-person ribbon beside the widest. */
export const WorstCase: Story = {
  render: () => {
    const g = wideGraph(40);
    return (
      <Graph
        nodes={g.nodes}
        edges={[...g.edges, { from: "n0", to: "n39", weight: 1 }]}
        label="Ribbons, worst case"
        direction="down"
        ribbons
        maxHeight={720}
      />
    );
  },
  play: drawn,
};
