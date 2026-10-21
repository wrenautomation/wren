import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Busy, BusyBox } from "./busy.js";
import { Button, Tag } from "./controls.js";
import { PageBar } from "./page-bar.js";
import { Segmented } from "./phone.js";

export default { title: "Busy" } satisfies Meta;

type Story = StoryObj;

/** The ring big in a modal, then small in each place it goes: a chip, buttons, a tab, the pager. */
export const Places: Story = {
  render: () => (
    <div className="grid max-w-lg gap-5">
      <BusyBox title="Loading your map" note="4 lines, 18 stations" />
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
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        Replies <Busy on />
      </h2>
      <Segmented
        label="Views"
        items={[
          { id: "all", label: "All", href: "#all", on: false },
          { id: "waiting", label: "Waiting", href: "#waiting", on: true, busy: true },
          { id: "done", label: "Done", href: "#done", on: false },
        ]}
      />
      <PageBar
        place={{
          params: new URLSearchParams(),
          link: () => "#",
          page: () => "#",
          list: "#",
          go: () => undefined,
        }}
        page={2}
        pages={5}
        total={120}
        shown={25}
        size={25}
        narrow={false}
        loading
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("status")).toHaveTextContent("Loading your map");
    // Each wait shows the one ring; nothing draws a bar.
    await expect(canvasElement.querySelectorAll(".ui-busy[data-on]").length).toBeGreaterThan(6);
    await expect(canvasElement.querySelectorAll(".ui-busy[data-done]")).toHaveLength(1);
  },
};
