import type { Meta, StoryObj } from "@storybook/react-vite";
import { Diff } from "./diff.js";
import { DIFF_A, DIFF_B, DIFF_SAME, WORST_A, WORST_B } from "./fixtures/diff.js";

export default { title: "Diff" } satisfies Meta;

type Story = StoryObj;

const names: [string, string] = ["Version 2", "Version 3"];

/** Side by side from 768px, one column under it: the story width switch shows both. */
export const Default: Story = {
  render: () => <Diff a={DIFF_A} b={DIFF_B} names={names} />,
};

/** The same text on both sides: the diff says so. */
export const Empty: Story = {
  render: () => <Diff a={DIFF_SAME} b={DIFF_SAME} names={names} />,
};

/** The nearest real state: a diff has no loading state, so a parent still waiting for the newer text passes it empty and every line shows removed. */
export const Loading: Story = {
  render: () => <Diff a={DIFF_A} b="" names={["Version 2", "Loading…"]} />,
};

/** The nearest real state: a diff has no error state, so a parent that could not read the newer text says so in its name. */
export const Failed: Story = {
  render: () => <Diff a={DIFF_A} b={DIFF_A} names={["Version 2", "Version 3 (could not load)"]} />,
};

/** Long lines, an address that never breaks, mixed scripts and a long run of changes, both layouts. */
export const WorstCase: Story = {
  render: () => (
    <div className="grid gap-6">
      <Diff
        a={WORST_A}
        b={WORST_B}
        names={[WORST_A.slice(0, 80), WORST_B.slice(0, 80)]}
        layout="split"
      />
      <Diff a={WORST_A} b={WORST_B} names={["Version 2", "Version 3"]} layout="unified" />
    </div>
  ),
};
