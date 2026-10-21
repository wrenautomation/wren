import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button, Tag } from "./controls.js";
import { FRAME, GROUP_LABEL } from "./layout.js";
import { Sweep } from "./sweep.js";

export default { title: "Leaf and sweep" } satisfies Meta;

type Story = StoryObj;

/** A closed band and an open one: faint at rest, full on hover, an inner line when open. */
function Band({ label, open }: { label: string; open?: boolean }) {
  return (
    <div className="relative [border-radius:var(--ui-leaf-panel)] bg-(--ui-band) px-4 py-3 text-[14px]">
      <Sweep band open={open ?? false} />
      {label}
    </div>
  );
}

/** The panel, the band, the buttons, the chips and the nav rows, in the theme the toolbar sets. */
export const Parts: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div className="grid max-w-xl gap-4">
        <section className={`${FRAME} grid gap-3 p-4`}>
          <Sweep />
          <h2 className={GROUP_LABEL}>Panel</h2>
          <p className="text-[14px] text-(--ui-ink-2)">
            The corners are a leaf. The sweep runs along the two round tips.
          </p>
        </section>
        <button type="button" className="contents" onClick={() => setOpen(!open)}>
          <Band label="Band, closed" open={false} />
        </button>
        <Band label="Band, open" open={open} />
        <div className="flex flex-wrap items-center gap-3">
          <Button>Save</Button>
          <Button tone="secondary">Cancel</Button>
          <Tag>Draft</Tag>
          <Tag>Live</Tag>
        </div>
        <nav aria-label="Pages" className="grid w-56 gap-0.5">
          <a href="#a" className="ui-nav-sweep [border-radius:var(--ui-leaf-nav)] px-2.5 py-1.5">
            Overview
          </a>
          <a
            href="#b"
            aria-current="page"
            className="ui-nav-sweep [border-radius:var(--ui-leaf-nav)] bg-(--ui-accent-wash) px-2.5 py-1.5"
          >
            Posts
          </a>
        </nav>
      </div>
    );
  },
};
