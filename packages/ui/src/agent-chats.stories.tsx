import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { type AgentChatRow, AgentChats } from "./agent-chats.js";
import { WORST } from "./fixtures/worst.js";

export default {
  title: "Parts/Agent chats",
  id: "agent-chats",
} satisfies Meta;

type Story = StoryObj;

const H = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();
const ROWS: AgentChatRow[] = [
  {
    session: "s1",
    at: ago(0.2),
    title: "Which tools do career coaches use to book discovery calls?",
  },
  { session: "s2", at: ago(2), title: "What color is this? One word." },
  { session: "s3", at: ago(26), title: "Benchmarks for cold email reply rates in 2026" },
  { session: "s4", at: ago(80), title: "Which CRMs do small law firms use most?" },
  { session: "s5", at: ago(24 * 40) },
];

function List({ rows = ROWS }: { rows?: AgentChatRow[] }) {
  const [open, setOpen] = useState<string | null>("s2");
  return (
    <div className="flex max-h-[520px] w-[248px] flex-col bg-(--ui-paper) p-3">
      <AgentChats
        rows={rows}
        open={open}
        hrefOf={(r) => `#${r.session}`}
        onOpen={(r) => setOpen(r.session)}
      />
    </div>
  );
}

/** Day heads, the time at the right, the open chat marked; a click opens another. */
export const Default: Story = {
  render: () => <List />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("heading", { name: "Today" })).toBeTruthy();
    await expect(c.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
    await expect(c.getByText("Untitled chat")).toBeTruthy();
    const open = c.getByRole("link", { current: "page" });
    await expect(open.textContent).toContain("What color is this?");
    await userEvent.click(c.getByText(/Which CRMs/));
    await expect(c.getByRole("link", { current: "page" }).textContent).toContain("Which CRMs");
  },
};

const WORST_ROWS: AgentChatRow[] = [
  { session: "s1", at: ago(0.1), title: WORST.longText },
  { session: "s2", at: ago(1), title: WORST.url },
  { session: "s3", at: ago(25), title: WORST.nonLatin },
  { session: "s4", at: ago(30), title: WORST.emoji },
  { session: "s5", at: ago(50), title: WORST.empty },
  ...Array.from({ length: 30 }, (_, i) => ({
    session: `old${i}`,
    at: ago(24 * (8 + i * 3)),
    title: `${WORST.longLabel} ${i + 1}`,
  })),
];

/** Long, unbroken, non-Latin, emoji and empty titles, and 35 chats: the list scrolls, never widens. */
export const WorstCase: Story = {
  render: () => <List rows={WORST_ROWS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText("Untitled chat")).toHaveLength(1);
    const list = canvasElement.querySelector(".overflow-y-auto") as HTMLElement;
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  },
};
