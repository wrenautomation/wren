import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { fakeOverview, QUEUES, TILES } from "./fixtures/overview.js";
import { RecordOverview } from "./overview.js";

export default { title: "Overview", parameters: { layout: "fullscreen" } } satisfies Meta;

type Story = StoryObj;

/** Each queue's longest wait is in `WAITS`: two days, a day and a half, six hours, five, three, 20 minutes. */
function Page({ api }: { api: ReturnType<typeof fakeOverview> }) {
  return (
    <div className="p-4 sm:p-6">
      <RecordOverview title="Inbox" api={api} tiles={TILES} queues={QUEUES} />
    </div>
  );
}

const queueLinks = (root: HTMLElement) =>
  within(root)
    .getAllByRole("link")
    .filter(
      (a) =>
        a.getAttribute("href")?.startsWith("#") &&
        QUEUES.some((q) => q.href === a.getAttribute("href")),
    );

/** Six queues, two late (Waiting on you at 50 hours, Issues at 30): the longest wait first. */
export const Default: Story = {
  render: () => <Page api={fakeOverview()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: /Waiting on you/ });
    const rows = queueLinks(canvasElement);
    // Oldest wait first.
    await expect(rows.map((a) => a.getAttribute("href"))).toEqual([
      "#waiting",
      "#issues",
      "#approve",
      "#mail",
      "#mentions",
      "#asks",
    ]);
    // The total is the sum of the counts: 4 + 4 + 5 + 2 + 4 + 1.
    await expect(canvas.getByText("20")).toBeVisible();
    // A late queue says so in its oldest line, and an on-time one does not.
    const late = canvasElement.querySelectorAll("small[data-late]");
    await expect(late.length).toBe(2);
    await expect(within(rows[0] as HTMLElement).getByText(/oldest 2 days/)).toHaveAttribute(
      "data-late",
    );
    await expect(within(rows[2] as HTMLElement).getByText(/oldest 6 hours/)).not.toHaveAttribute(
      "data-late",
    );
    await expect(canvas.getByText("2 queues late")).toBeVisible();
    // Each row is a link to its list.
    await expect(rows[1]).toHaveAttribute("href", "#issues");
  },
};

/** Nothing waits: a zero, an empty bar, and every queue quiet at the end of the list. */
export const AllEmpty: Story = {
  render: () => <Page api={fakeOverview({ waits: {} })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Nothing waits on you");
    await expect(canvas.getAllByText("Nothing waiting")).toHaveLength(6);
    await expect(canvasElement.querySelectorAll("[data-late]")).toHaveLength(0);
  },
};

/** One queue's read fails: its row says so, the rest stay. */
export const OneFails: Story = {
  render: () => <Page api={fakeOverview({ failing: ["demo.mail"] })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Couldn't load");
    await expect(canvas.getByRole("link", { name: /Waiting on you/ })).toBeVisible();
  },
};

/** The first read is out: the panel's shape in grey blocks, never a spinner. */
export const Loading: Story = {
  render: () => <Page api={fakeOverview({ list: "pending" })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Loading what waits on you")).toBeInTheDocument();
  },
};

/** The phone: one column, the queues first, the trend cards under them. */
export const Phone: Story = {
  render: () => <Page api={fakeOverview()} />,
  globals: { viewport: { value: "phone" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: /Waiting on you/ });
    const first = canvas.getByRole("link", { name: /Waiting on you/ });
    const card = await canvas.findByRole("link", { name: /Replies/ });
    await expect(first.getBoundingClientRect().bottom).toBeLessThan(
      card.getBoundingClientRect().top,
    );
  },
};
