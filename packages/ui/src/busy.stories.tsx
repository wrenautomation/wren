import type { Meta, StoryObj } from "@storybook/react-vite";
import { Busy } from "./busy.js";
import { Button, Tag } from "./controls.js";
import { FRAME } from "./layout.js";

export default { title: "Busy" } satisfies Meta;

type Story = StoryObj;

/** The ring big in a modal, and small on a chip and on each button tone. Then the dots. */
export const Looks: Story = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <div className={`${FRAME} grid justify-items-center gap-1 p-4 text-center`}>
        <Busy on big />
        <b className="mt-1.5 text-[14px] font-semibold">Loading your map</b>
        <span className="text-[12.5px] text-(--ui-ink-2)">4 lines, 18 stations</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tag busy>Drafting</Tag>
        <Button tone="primary" busy>
          Send reply
        </Button>
        <Button tone="secondary" busy>
          Send reply
        </Button>
        <Button tone="quiet" busy>
          Send reply
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[14px]">
        Dots <Busy on variant="dots" />
      </div>
    </div>
  ),
};
