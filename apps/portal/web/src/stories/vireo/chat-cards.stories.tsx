/**
 * Vireo's chat cards (WA-1262) on their own, from the fake server's data. The live stories step
 * the data as live reads would: samples land, then his marks fill in; a tree grows a batch at a
 * time. The page story is Wren/Agent chat › Vireo cards.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { VARIANTS_ANSWERS } from "../../mocks/data/variants.js";
import { TREE_SUBJECT } from "../../mocks/data/variants-tree.js";
import type { Whole } from "../../modules/variants/batches.js";
import { BatchCard, SubjectCard } from "../../modules/variants/chat-card.js";
import type { SubjectView } from "../../modules/variants/page.js";

const meta: Meta = { title: "Vireo/Chat cards", parameters: { layout: "padded" } };
export default meta;

const batch = (ref: string) =>
  (VARIANTS_ANSWERS["variants/batch"] as (b: object) => Whole)({ ref });
const TREE = TREE_SUBJECT as unknown as SubjectView;
/** a live read's pace in the demo */
const STEP_MS = 700;
const CALLS = ["good", "bad", "amazing", "okay"] as const;

/** A closed batch: tiles in its calls' colors, the tally, the agent's why and his note. */
export const Closed: StoryObj = { render: () => <BatchCard row={batch("opener:2")} /> };

/** An open batch: blind tiles, how many he marked. */
export const Open: StoryObj = { render: () => <BatchCard row={batch("opener:4")} /> };

/** A subject: the page's tree, newest rows at the foot. */
export const Subject: StoryObj = { render: () => <SubjectCard v={TREE} /> };

function useStep(last: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= last) return;
    const t = setTimeout(() => setN(n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [n, last]);
  return n;
}

function LandingBatch() {
  const whole = batch("opener:4");
  const all = whole.samples;
  const n = useStep(all.length * 2);
  const row: Whole = {
    ...whole,
    samples: all.slice(0, Math.min(n, all.length)).map((s, i) => {
      const v = n - all.length > i ? CALLS[i % CALLS.length] : null;
      return { ...s, verdict: v ?? null, score: null };
    }),
  };
  return <BatchCard row={row} />;
}

/** Live: the batch's samples land one by one, then his marks fill in. */
export const Landing: StoryObj = {
  render: () => <LandingBatch />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await waitFor(() => expect(c.getByText("4 of 4 marked")).toBeTruthy(), { timeout: 10_000 });
  },
};

function GrowingTree() {
  const n = useStep(TREE.batches.length);
  return <SubjectCard v={{ ...TREE, batches: TREE.batches.slice(0, Math.max(1, n)) }} />;
}

/** Live: the tree grows a batch at a time; new nodes grow in. */
export const Growing: StoryObj = {
  render: () => <GrowingTree />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByRole("group", { name: /^Generation tree of / });
  },
};
