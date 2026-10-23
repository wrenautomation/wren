import type { Meta, StoryObj } from "@storybook/react-vite";
import { focusManager } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Toasts } from "./action.js";
import { QUERIES } from "./data/query.js";
import { LEAD_META, LEAD_NEEDS, LEADS, useRecordsDemo } from "./fixtures/records.js";
import { RecordList, type RowReplyBox } from "./records.js";

export default { title: "Peek", parameters: { layout: "fullscreen" } } satisfies Meta;

type Story = StoryObj;

/** The peek's properties for a lead: its state, score, city and last seen. */
const FIELDS = ["state", "score", "city", "seen"];

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A scratch reply box: a text box that keeps its words in this story only. */
function Scratch() {
  const [text, set] = useState("");
  return (
    // edit-ok: a story's scratch box, nothing to keep
    <textarea
      aria-label="Reply"
      value={text}
      onChange={(e) => set(e.currentTarget.value)}
      className="min-h-16 w-full rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) p-2"
    />
  );
}
const REPLY: RowReplyBox = { box: () => <Scratch /> };

function Host({
  at = "view=all",
  peek,
  reply,
  slow,
}: {
  at?: string;
  peek?: false | { fields?: string[] };
  reply?: RowReplyBox;
  /** A lead whose record reads slowly (ms), for a race. */
  slow?: { id: number; ms: number };
}) {
  const demo = useRecordsDemo({ at });
  const api = useMemo(
    () => ({
      ...demo.api,
      get: (ask: Parameters<typeof demo.api.get>[0]) =>
        slow && Number(ask.id) === slow.id
          ? wait(slow.ms).then(() => demo.api.get(ask))
          : demo.api.get(ask),
    }),
    [demo.api, slow],
  );
  // "Open" leads to a page of its own, so a story can tell it from the peek.
  const place = useMemo(
    () => ({ ...demo.place, page: (id: string) => `#record-${id}` }),
    [demo.place],
  );
  return (
    <div className="p-4 sm:p-6">
      <RecordList
        record={LEAD_META.id}
        api={api}
        place={place}
        acts={demo.acts}
        needs={LEAD_NEEDS}
        peek={peek ?? { fields: FIELDS }}
        reply={reply}
      />
      <Toasts />
    </div>
  );
}

const isWide = (canvasElement: HTMLElement) => !!within(canvasElement).queryByRole("table");
/** The open lead, a floating panel (wide) or a sheet (phone). */
const peekOf = async (): Promise<HTMLElement> => {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = document.body.querySelector<HTMLElement>(
      'aside[aria-label="Lead"], [role="dialog"][aria-label="Lead"]',
    );
    expect(el).not.toBeNull();
  });
  return el as unknown as HTMLElement;
};
const openAs = (name: string) => async (canvas: ReturnType<typeof within>) => {
  await userEvent.click(await canvas.findByRole("link", { name }));
};
const param = () => new URLSearchParams(location.hash.replace(/^#\??/, "")).get("lead");

/** A row click opens the peek: the lead's name, its properties and its newest activity. */
export const Opens: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const peek = await peekOf();
    const here = within(peek);
    await expect(await here.findByRole("heading", { name: "Ada North" })).toBeVisible();
    for (const label of ["State", "Score", "City", "Last seen"])
      await expect(here.getByText(label, { selector: "dt" })).toBeVisible();
    await expect(here.getByText("Leeds")).toBeVisible();
    // Its newest items, each with who and when.
    const last = await here.findByRole("region", { name: "Last activity" });
    await expect(within(last).getByText("Replied to the second email.")).toBeVisible();
    // The peek is not the full record: it has the way on.
    await expect(here.getByRole("link", { name: "Open the full record" })).toBeVisible();
    expect(param()).toBe("1");
  },
};

/** Two quick clicks on two rows, the first one's read the slower: the peek ends on the second. */
export const TwoClicks: Story = {
  render: () => <Host slow={{ id: 1, ms: 500 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = await canvas.findByRole("link", { name: "Ada North" });
    const second = await canvas.findByRole("link", { name: "Bo Fenwick" });
    await userEvent.click(first);
    await userEvent.click(second);
    await wait(900);
    const here = within(await peekOf());
    await expect(await here.findByRole("heading", { name: "Bo Fenwick" })).toBeVisible();
    // The first row's late answer never draws on the second's peek.
    expect(here.queryByText("Leeds")).toBeNull();
    await expect(here.getByText("Bristol")).toBeVisible();
    expect(param()).toBe("2");
  },
};

/** J walks to the next row, K back; Escape shuts the peek and the address loses its param. */
export const Walks: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const here = within(await peekOf());
    await here.findByRole("heading", { name: "Ada North" });
    const start = param();
    await userEvent.keyboard("j");
    await waitFor(() => expect(param()).not.toBe(start));
    await waitFor(() => expect(here.queryByRole("heading", { name: "Ada North" })).toBeNull());
    await userEvent.keyboard("k");
    await waitFor(() => expect(param()).toBe(start));
    await expect(await here.findByRole("heading", { name: "Ada North" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(param()).toBeNull());
    await waitFor(() => expect(document.body.querySelector('aside[aria-label="Lead"]')).toBeNull());
  },
};

/** Open leads to the lead's own page, and the peek goes. */
export const OpenIt: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const here = within(await peekOf());
    await here.findByRole("heading", { name: "Ada North" });
    // A wide panel has an Open button in its head; a sheet has the link under its fields.
    const open = isWide(canvasElement)
      ? here.getByRole("link", { name: "Open" })
      : here.getByRole("link", { name: "Open the full record" });
    await expect(open).toHaveAttribute("href", "#record-1");
    await userEvent.click(open);
    await waitFor(() => expect(location.hash).toBe("#record-1"));
    await waitFor(() => expect(param()).toBeNull());
  },
};

/** The main action runs from the peek, the Undo toast shows, and a tab away and back keeps the row. */
export const MainAction: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const here = within(await peekOf());
    await here.findByRole("heading", { name: "Ada North" });
    await userEvent.click(await here.findByRole("button", { name: "Approve" }));
    const undo = await within(document.body).findByRole("button", { name: "Undo" });
    await expect(undo).toBeInTheDocument();
    // The peek reads again and shows the new state.
    await waitFor(() => expect(here.getByText("Approved")).toBeVisible());
    // Away and back: the answers read again, the same row stays.
    focusManager.setFocused(false);
    await QUERIES.invalidateQueries();
    focusManager.setFocused(true);
    await wait(300);
    await expect(await here.findByRole("heading", { name: "Ada North" })).toBeVisible();
    expect(param()).toBe("1");
    await expect(here.getByText("Approved")).toBeVisible();
  },
};

/** A wide screen docks the peek in the list's panel; a phone slides up a sheet. */
export const PanelOrSheet: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const peek = await peekOf();
    await within(peek).findByRole("heading", { name: "Ada North" });
    if (isWide(canvasElement)) {
      // Docked beside the list (artifact `.nt-pk`): its right half, not over the page. The page
      // scrolls, so the peek sticks in view while the rows move under it.
      expect(peek.tagName).toBe("ASIDE");
      expect(getComputedStyle(peek).position).toBe("sticky");
      // A grid cell, so a short list never cuts the record off.
      expect(peek.scrollHeight).toBeLessThanOrEqual(peek.clientHeight + 1);
      const list = canvasElement.querySelector("table")?.closest("[class*='grid-cols-2']");
      expect(list?.contains(peek)).toBe(true);
    } else {
      expect(peek.getAttribute("role")).toBe("dialog");
      expect(peek.hasAttribute("data-sheet")).toBe(true);
    }
  },
};

/** A page with `peek: false` keeps the full record in the panel. */
export const FullRecord: Story = {
  render: () => <Host peek={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const here = within(await peekOf());
    await waitFor(() =>
      expect(here.queryByRole("link", { name: "Open the full record" })).toBeNull(),
    );
    await expect(await here.findByText("Details")).toBeVisible();
    expect(here.queryByRole("region", { name: "Last activity" })).toBeNull();
  },
};

/** The page's reply box draws in the peek, and J, K and Escape stay in the text box. */
export const TypedReply: Story = {
  render: () => <Host reply={REPLY} at="view=waiting" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openAs("Ada North")(canvas);
    const here = within(await peekOf());
    const box = await here.findByRole("textbox", { name: "Reply" });
    const start = param();
    await userEvent.type(box, "jk{Escape}");
    await expect(box).toHaveValue("jk");
    await expect(here.getByRole("heading", { name: "Ada North" })).toBeVisible();
    expect(param()).toBe(start);
    // A page with a reply box has no main-action button beside it.
    expect(here.queryByRole("button", { name: "Approve" })).toBeNull();
  },
};

/** Grouped: J skips the rows of a shut group. */
export const Grouped: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    await userEvent.click(canvas.getByRole("link", { name: "By state" }));
    const shut = await canvas.findByRole("button", { name: /^Approved/ });
    await userEvent.click(shut);
    await expect(shut).toHaveAttribute("aria-expanded", "false");
    // The leads in view, in order; the last waiting one is next to the shut group.
    const names = LEADS.map((l) => String(l.name));
    const stateOf = (n: string) => LEADS.find((l) => l.name === n)?.state;
    const seen = canvas
      .getAllByRole("link")
      .map((a) => a.textContent?.trim() ?? "")
      .filter((t) => names.includes(t) && stateOf(t) !== "approved");
    const last = seen.map(stateOf).lastIndexOf("waiting");
    expect(last).toBeGreaterThanOrEqual(0);
    const from = seen[last] as string;
    const next = seen[last + 1] as string;
    await userEvent.click(canvas.getByRole("link", { name: from }));
    const here = within(await peekOf());
    await here.findByRole("heading", { name: from });
    await userEvent.keyboard("j");
    expect(next).toBeDefined();
    await expect(await here.findByRole("heading", { name: next })).toBeVisible();
  },
};
