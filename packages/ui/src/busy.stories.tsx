import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button, Tag } from "./controls.js";
import { Segmented } from "./phone.js";

export default { title: "Busy" } satisfies Meta;

type Story = StoryObj;

/** The ring in each place it goes: a chip, buttons, a tab. Never beside a title or a count. */
export const Places: Story = {
  render: () => (
    <div className="grid max-w-lg gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone="accent" busy>
          Drafting
        </Tag>
        <Tag tone="accent" busy>
          Approved
        </Tag>
        <Button tone="primary" busy>
          Send reply
        </Button>
        <Button tone="secondary" busy>
          Send reply
        </Button>
        <Button tone="quiet" busy>
          Send reply
        </Button>
        <Button tone="secondary" busy={false} done>
          Send reply
        </Button>
      </div>
      <Segmented
        label="Views"
        items={[
          { id: "all", label: "All", href: "#all", on: false },
          { id: "waiting", label: "Waiting", href: "#waiting", on: true, busy: true },
          { id: "done", label: "Done", href: "#done", on: false },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    // Each wait shows the one ring; nothing draws a bar.
    await expect(canvasElement.querySelectorAll(".ui-busy[data-on]").length).toBeGreaterThan(5);
    await expect(canvasElement.querySelectorAll(".ui-busy[data-done]")).toHaveLength(1);
  },
};
