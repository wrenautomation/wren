import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { BusyBox, Ring } from "./busy.js";
import { Button, Seg, Tag } from "./controls.js";
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
        <Button tone="primary" busy={false} done doneLabel="Sent">
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
    await expect(canvasElement.querySelectorAll("[aria-busy=true] .ui-busy").length).toBe(3);
    await expect(canvasElement.querySelectorAll("button[data-done]")).toHaveLength(1);
    // A chip or a tab holds no slot: the ring is there only while it works (two chips, one tab).
    await expect(canvasElement.querySelectorAll(".ui-ring-slot")).toHaveLength(3);
  },
};

/**
 * The busy rule (artifact #loading): a click shows the ring, the label moves left for it, then
 * "Sent" rises in and everything moves back. The width never changes.
 */
export const Act: Story = {
  render: function Render() {
    const [state, setState] = useState<"idle" | "busy" | "done">("idle");
    useEffect(() => {
      if (state === "idle") return;
      const t = setTimeout(() => setState(state === "busy" ? "done" : "idle"), 1400);
      return () => clearTimeout(t);
    }, [state]);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          busy={state === "busy"}
          done={state === "done"}
          doneLabel="Sent"
          onClick={() => setState("busy")}
        >
          Send reply
        </Button>
        <Tag tone="accent" busy={state === "busy"}>
          {state === "busy" ? "Drafting" : "Draft"}
        </Tag>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    if (!button) throw new Error("no button");
    const width = button.getBoundingClientRect().width;
    button.click();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    await expect(button.getBoundingClientRect().width).toBe(width);
    await waitFor(() => expect(button.hasAttribute("data-done")).toBe(true), { timeout: 3000 });
    await expect(button.getBoundingClientRect().width).toBe(width);
  },
};

/** The ring at its three sizes, and the box for a wait with no path. */
export const Sizes: Story = {
  render: () => (
    <div className="grid max-w-sm gap-5">
      <div className="flex items-center gap-4">
        <Ring />
        <Ring size="step" />
        <Ring size="big" />
      </div>
      <BusyBox title="Building your map" note="12 of 40 places" />
    </div>
  ),
};

/** Samples a box's width each frame for `ms`: the steps a person would see. */
async function widths(el: Element, ms: number): Promise<number[]> {
  const out: number[] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    out.push(Math.round(el.getBoundingClientRect().width * 10) / 10);
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
}
/** No frame moves more than `max` px: the size slides, it never jumps. */
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Reduced motion changes size at once, by design: then only the end widths count. */
const smooth = (w: number[], max = 6) =>
  still() || w.every((v, i) => i === 0 || Math.abs(v - (w[i - 1] ?? v)) <= max);

/**
 * One press runs the button, a tab and a chip together. The button keeps its width; the tab and
 * the chip grow for the ring on the spring and shrink back. Press twice fast: they turn back.
 */
export const Toggle: Story = {
  render: function Render() {
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState<"all" | "booked">("booked");
    return (
      <div className="grid max-w-md gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" busy={busy}>
            Send reply
          </Button>
          <Button tone="quiet" onClick={() => setBusy(!busy)}>
            {busy ? "Stop" : "Run"}
          </Button>
          <Tag tone="green" busy={busy}>
            Booked
          </Tag>
        </div>
        <Seg
          label="Stage"
          value={tab}
          onChange={setTab}
          className="justify-self-start"
          items={[
            { value: "all", label: "All" },
            { value: "booked", label: "Booked", busy },
          ]}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    const c = within(canvasElement);
    const button = c.getByRole("button", { name: /Send reply/ });
    const run = c.getByRole("button", { name: /Run|Stop/ });
    const chip = c
      .getByText("Booked", { selector: "span span" })
      .closest("span[class*='badge']") as Element;
    const tab = c.getByRole("button", { name: "Booked" });
    const at = {
      button: button.getBoundingClientRect().width,
      chip: chip.getBoundingClientRect().width,
      tab: tab.getBoundingClientRect().width,
    };
    // Start: the chip and tab grow without a jump; the button stays.
    run.click();
    const [cw, tw] = await Promise.all([widths(chip, 600), widths(tab, 600)]);
    await expect(smooth(cw)).toBe(true);
    await expect(smooth(tw)).toBe(true);
    await expect(cw.at(-1)).toBeGreaterThan(at.chip + 15);
    await expect(button.getBoundingClientRect().width).toBe(at.button);
    // End: back to the width before, nothing left shifted.
    run.click();
    const [cw2, tw2] = await Promise.all([widths(chip, 700), widths(tab, 700)]);
    await expect(smooth(cw2)).toBe(true);
    await expect(smooth(tw2)).toBe(true);
    await waitFor(() => expect(chip.getBoundingClientRect().width).toBe(at.chip));
    await expect(tab.getBoundingClientRect().width).toBe(at.tab);
    // Fast toggle: on and off in 80 ms turns back from where it was.
    run.click();
    await new Promise((r) => setTimeout(r, 80));
    run.click();
    const cw3 = await widths(chip, 700);
    await expect(smooth(cw3)).toBe(true);
    await waitFor(() => expect(chip.getBoundingClientRect().width).toBe(at.chip));
    await expect(tab.getBoundingClientRect().width).toBe(at.tab);
    await expect(button.getBoundingClientRect().width).toBe(at.button);
    await expect(canvasElement.querySelectorAll(".ui-ring-slot")).toHaveLength(0);
  },
};
