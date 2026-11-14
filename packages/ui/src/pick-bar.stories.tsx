import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./controls.js";
import { PickBar } from "./pick-bar.js";

export default {
  title: "Components/Lists/Pick bar",
  id: "pick-bar",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

type Story = StoryObj<{ onEnd: () => void }>;

const frame = (bar: React.ReactNode) => <div className="min-h-[320px] p-4">{bar}</div>;

/** Select on, nothing picked: the action is off. */
export const NonePicked: Story = {
  render: () =>
    frame(
      <PickBar
        n={0}
        actions={
          <Button size="dense" disabled>
            Save to Canon
          </Button>
        }
        onEnd={() => {}}
      />,
    ),
};

/** Three picked; Esc and Done both end it. */
export const Picked: Story = {
  args: { onEnd: fn() },
  render: (a) =>
    frame(<PickBar n={3} actions={<Button size="dense">Save to Canon</Button>} onEnd={a.onEnd} />),
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    // ui-rise starts at opacity 0
    await waitFor(() => expect(view.getByText("3 picked")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await userEvent.click(view.getByRole("button", { name: "Done" }));
    await expect(args.onEnd).toHaveBeenCalledTimes(2);
  },
};

/** At work: the action rings. */
export const Busy: Story = {
  render: () =>
    frame(
      <PickBar
        n={3}
        actions={
          <Button size="dense" busy>
            Save to Canon
          </Button>
        }
        onEnd={() => {}}
      />,
    ),
};

/** Some failed: they stay picked, the reason in an alert. A long reason wraps. */
export const PartFailed: Story = {
  render: () =>
    frame(
      <PickBar
        n={1}
        actions={<Button size="dense">Save to Canon</Button>}
        bad
        note="2 saved. 1 not saved: the post is private or deleted, and the platform answered 404 for https://www.instagram.com/reel/AVeryLongReferenceThatNeverBreaks/"
        onEnd={() => {}}
      />,
    ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent(/1 not saved/);
  },
};
