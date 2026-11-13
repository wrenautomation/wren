import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
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

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Drags the left edge right (narrower) by `step` px per move, `ms` apart. */
async function drag(edge: HTMLElement, moves: number, step: number, ms: number) {
  const x = edge.getBoundingClientRect().left + 2;
  fireEvent.pointerDown(edge, { pointerId: 1, button: 0, buttons: 1, clientX: x });
  for (let i = 1; i <= moves; i++) {
    await wait(ms);
    fireEvent.pointerMove(edge, { pointerId: 1, buttons: 1, clientX: x + i * step });
  }
  fireEvent.pointerUp(edge, { pointerId: 1, clientX: x + moves * step });
}

/**
 * The edge's motion (wide only; a phone has no edge): a key resize eases the width, a slow drag
 * keeps the panel open, a flick shuts it short of the fold.
 */
export const Motion: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    if (window.innerWidth <= 900) return;
    const c = within(canvasElement);
    const panel = c.getByRole("complementary", { name: "Agent" });
    const edge = c.getByRole("separator", { name: "Agent" });
    // a key: the width eases (no data-resizing, width in the transition)
    edge.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(edge).toHaveAttribute("aria-valuenow", String(PANEL.width - 16));
    await expect(panel).not.toHaveAttribute("data-resizing");
    await expect(getComputedStyle(panel).transitionProperty).toContain("width");
    // slow: 60px over ~600ms, stays open and narrower
    await drag(edge, 4, 15, 150);
    await waitFor(() => expect(edge).toHaveAttribute("aria-valuenow", String(PANEL.width - 76)));
    await expect(panel).not.toHaveAttribute("data-resizing");
    // a flick: 75px in ~50ms, still wider than the fold, shuts it
    await drag(edge, 3, 25, 16);
    await waitFor(() => expect(c.queryByRole("complementary", { name: "Agent" })).toBeNull());
  },
};
