import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useConfirm } from "./confirm.js";
import { Button } from "./controls.js";

export default {
  title: "Components/Controls and feedback/Confirm",
  id: "confirm",
} satisfies Meta;

type Story = StoryObj;

function Remove() {
  const [confirm, dialog] = useConfirm();
  const [said, setSaid] = useState("");
  const ask = async () =>
    setSaid(
      (await confirm("Remove portal.example-firm.com?", {
        detail: "The portal stops working there right away.",
        go: "Remove",
      }))
        ? "removed"
        : "kept",
    );
  return (
    <div className="grid max-w-sm gap-3">
      <Button tone="quiet" onClick={ask}>
        Remove
      </Button>
      <p data-testid="said">{said}</p>
      {dialog}
    </div>
  );
}

/** The app's own ask-first: the question, what happens, Cancel and the verb. */
export const Open: Story = {
  render: () => <Remove />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Remove" }));
    const page = within(document.body);
    await waitFor(() => expect(page.getByRole("dialog")).toBeVisible());
  },
};

/** No detail: the question, then the buttons. */
export const Short: Story = {
  render: () => {
    const [confirm, dialog] = useConfirm();
    return (
      <div>
        <Button
          tone="quiet"
          onClick={() => void confirm("Switch Instagram to self-serve?", { go: "Switch" })}
        >
          Switch
        </Button>
        {dialog}
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(within(document.body).getByRole("dialog")).toBeVisible());
  },
};

/** Cancel keeps it; the verb goes; Escape is Cancel. */
export const Answers: Story = {
  render: () => <Remove />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const page = within(document.body);
    const said = () => c.getByTestId("said").textContent;
    await userEvent.click(c.getByRole("button", { name: "Remove" }));
    await userEvent.click(await page.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(said()).toBe("kept"));
    await userEvent.click(c.getByRole("button", { name: "Remove" }));
    const dialog = await page.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(said()).toBe("removed"));
    await userEvent.click(c.getByRole("button", { name: "Remove" }));
    await page.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(said()).toBe("kept"));
  },
};
