import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PANEL, PanelAct, PanelClose, SidePanel } from "./side-panel.js";

export default {
  title: "Components/Agent chat/Side panel",
  id: "side-panel",
} satisfies Meta;

type Story = StoryObj;

function Frame() {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState<number>(PANEL.width);
  return (
    <div className="flex h-[560px] bg-(--ui-paper)">
      <div className="min-w-0 flex-1 p-6 text-[14px] text-(--ui-ink-2)">
        {open ? (
          "The page."
        ) : (
          <button type="button" onClick={() => setOpen(true)}>
            Closed. Open
          </button>
        )}
      </div>
      <SidePanel
        open={open}
        label="Agent"
        width={width}
        onWidth={setWidth}
        onClose={() => setOpen(false)}
      >
        <div className="flex min-h-[54px] flex-none items-center gap-1 border-(--ui-hair) border-b py-2 pr-2 pl-4">
          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-(--ui-ink)">Research</span>
          <PanelAct icon="plus" label="New chat" onClick={() => {}} />
          <PanelAct icon="expand" label="Open on its own page" href="#full" />
          <PanelClose label="Agent" onClose={() => setOpen(false)} />
        </div>
        <div className="flex-1" />
      </SidePanel>
    </div>
  );
}

/** One head row: the chat's name, New, Full page, Close; an inset card with a faint rim. */
export const Default: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("complementary", { name: "Agent" })).toBeTruthy();
    await expect(c.getByRole("link", { name: "Open on its own page" })).toBeTruthy();
  },
};

/** Close folds the panel away and the page takes its room; Open brings it back. */
export const Closes: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Close agent" }));
    await waitFor(() => expect(c.queryByRole("complementary", { name: "Agent" })).toBeNull());
    await userEvent.click(c.getByRole("button", { name: "Closed. Open" }));
    await waitFor(() => expect(c.getByRole("complementary", { name: "Agent" })).toBeVisible());
  },
};
