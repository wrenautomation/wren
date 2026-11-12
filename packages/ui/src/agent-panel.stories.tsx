import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
  AgentChanges,
  type AgentChangeTurn,
  ChangesTally,
  type UndoChange,
} from "./agent-changes.js";
import { type AgentConfirm, ConfirmCard, type RiskyAct } from "./agent-confirm.js";
import { type Autonomy, AutonomyDial } from "./agent-dial.js";
import { type QueuedTurn, QueuedTurns } from "./agent-queued.js";
import { PageSeen, type SeenPart } from "./agent-sees.js";

/** The parts designs/2026-11-11-agent-panel.md takes from other agent panels, before wiring. */
export default {
  title: "Components/Agent chat/Panel parts",
  id: "agent-panel-parts",
} satisfies Meta;

type Story = StoryObj;

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const TURNS: AgentChangeTurn[] = [
  {
    id: "t2",
    said: "Move every Bakeries lead that replied to Talking, and tag them warm.",
    at: ago(4),
    lines: [
      {
        id: "e1",
        at: ago(4),
        op: "update",
        what: "Lead · Maple Crust Bakery",
        change: "stage: New → Talking · tags: + warm",
        area: "client",
        href: "#",
      },
      {
        id: "e2",
        at: ago(4),
        op: "update",
        what: "Lead · Rye & Co",
        change: "stage: New → Talking · tags: + warm",
        area: "client",
        href: "#",
      },
      {
        id: "e3",
        at: ago(4),
        op: "update",
        what: "Lead · Golden Loaf",
        change: "stage: New → Talking",
        area: "client",
        undone: true,
      },
    ],
  },
  {
    id: "t1",
    said: "Log the Acme invoice as paid.",
    at: ago(38),
    lines: [
      {
        id: "e4",
        at: ago(38),
        op: "update",
        what: "Invoice · INV-0042",
        change: "status: Sent → Paid · paid on: Nov 11",
        area: "money",
        href: "#",
      },
      {
        id: "e5",
        at: ago(38),
        op: "insert",
        what: "Payment · $1,200 from Acme Bakery",
        area: "money",
        fixed: "A Stripe payout is on it. Refund it in Stripe instead.",
      },
    ],
  },
];

/** Undo: the first line refuses (a newer edit sits on it); the rest go. */
const undoer =
  (set: (f: (t: AgentChangeTurn[]) => AgentChangeTurn[]) => void): UndoChange =>
  async (t) => {
    await new Promise((r) => setTimeout(r, 400));
    if ("line" in t && t.line === "e1")
      return "Sam changed this lead after the agent did. Undo theirs first, or change it by hand.";
    set((turns) =>
      turns.map((x) => ({
        ...x,
        lines: x.lines.map((l) =>
          ("line" in t ? l.id === t.line : x.id === t.turn) && !l.fixed
            ? { ...l, undone: true }
            : l,
        ),
      })),
    );
    return null;
  };

function Changes({ start }: { start: AgentChangeTurn[] }) {
  const [turns, setTurns] = useState(start);
  return (
    <div className="max-w-[440px]">
      <AgentChanges turns={turns} onUndo={undoer(setTurns)} />
    </div>
  );
}

/** Changes in one chat: a group per turn, a line per record, Undo per line or per turn. Money lines are amber; a line that can't be undone says so. */
export const ChangesByTurn: Story = {
  render: () => <Changes start={TURNS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Undo all 2")).toBeTruthy();
    await expect(c.getByText("Can't undo")).toBeTruthy();
  },
};

/** An Undo the server refuses: the why stays on its line. */
export const UndoRefused: Story = {
  render: () => <Changes start={TURNS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const [first] = c.getAllByRole("button", { name: "Undo" });
    if (first) await userEvent.click(first);
    await expect(await c.findByText(/Sam changed this lead/)).toBeTruthy();
  },
};

/** No change yet in this chat. */
export const ChangesNone: Story = {
  render: () => <Changes start={[]} />,
};

/** Long names, many lines: a turn over 6 lines shows 5 and folds the rest. */
export const ChangesWorst: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText(/Saint-Germain-des-Prés/)).toHaveLength(5);
    await userEvent.click(c.getByRole("button", { name: "Show 4 more" }));
    await expect(c.getAllByText(/Saint-Germain-des-Prés/)).toHaveLength(9);
    await userEvent.click(c.getByRole("button", { name: "Show fewer" }));
    await expect(c.getAllByText(/Saint-Germain-des-Prés/)).toHaveLength(5);
  },
  render: () => (
    <Changes
      start={[
        {
          id: "w",
          said: "Clean every lead list: merge doubles, fix names, and drop the ones that bounced twice since September across all twelve campaigns.",
          at: ago(2),
          lines: Array.from({ length: 9 }, (_, i) => ({
            id: `w${i}`,
            at: ago(2),
            op: i % 3 === 0 ? ("delete" as const) : ("update" as const),
            what: `Lead · Établissements Boulangerie-Pâtisserie Saint-Germain-des-Prés ${i + 1}`,
            change:
              i % 3 === 0
                ? undefined
                : "name: ETABLISSEMENTS BOULANGERIE → Établissements Boulangerie",
            area: "client" as const,
          })),
        },
      ]}
    />
  ),
};

/** At a reply's foot: what it changed, one line; Review opens Changes. */
export const Tally: Story = {
  render: () => (
    <div className="grid max-w-[440px] gap-3">
      <p className="m-0 text-[14px]/[1.55] text-(--ui-ink)">
        Done. Two Bakeries leads replied; both are in Talking and tagged warm.
      </p>
      <ChangesTally lines={TURNS[0]?.lines ?? []} onOpen={() => {}} />
    </div>
  ),
};

const PREVIEW = (
  <div className="grid gap-2">
    <span className="text-[12px] text-(--ui-ink-3)">
      Subject: Fresh bread for your café, weekly
    </span>
    <span>
      Hi Dana, I saw Maple Crust opened a second shop on Queen St. We bake for six cafés nearby and
      could add yours on Tuesdays. Want a sample box this week?
    </span>
  </div>
);

const ASKS: AgentConfirm = {
  id: "c1",
  act: "send",
  title: "Send 12 emails",
  facts: [
    ["To", "12 leads in Bakeries, Toronto"],
    ["From", "sam@example.com"],
    ["When", "Now, one every 4 minutes"],
  ],
  preview: PREVIEW,
  state: "asks",
};

function Confirm({ c }: { c: AgentConfirm }) {
  const [now, setNow] = useState(c);
  return (
    <div className="max-w-[440px]">
      <ConfirmCard
        c={now}
        onAnswer={async (yes, why) => {
          await new Promise((r) => setTimeout(r, 500));
          setNow({
            ...now,
            state: yes ? "yes" : "no",
            by: "you",
            at: new Date().toISOString(),
            why,
          });
        }}
      />
    </div>
  );
}

/** The agent asks before it sends: what goes, to whom, a look at the first one. Yes is the act in words. */
export const ConfirmSend: Story = {
  render: () => <Confirm c={ASKS} />,
};

/** No, with a why the agent reads. */
export const ConfirmNo: Story = {
  render: () => <Confirm c={ASKS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "No" }));
    await userEvent.type(c.getByRole("textbox"), "Wait until Monday");
    await userEvent.click(c.getByRole("button", { name: "Tell the agent no" }));
    await expect(await c.findByText(/Wait until Monday/)).toBeTruthy();
  },
};

/** The other three acts, and the answered states. */
export const ConfirmAll: Story = {
  render: () => (
    <div className="grid max-w-[440px] gap-3">
      <Confirm
        c={{
          id: "c2",
          act: "spend",
          title: "Raise the daily budget to $40",
          facts: [
            ["Campaign", "Bakeries · Toronto · Meta"],
            ["Now", "$25 a day"],
          ],
          state: "asks",
        }}
      />
      <Confirm
        c={{
          id: "c3",
          act: "delete",
          title: "Remove 31 leads",
          facts: [["Which", "Bounced twice since September"]],
          state: "asks",
        }}
      />
      <Confirm
        c={{
          id: "c4",
          act: "publish",
          title: "Publish the Bakeries page",
          facts: [["Where", "bakeries.example.com"]],
          state: "yes",
          by: "Sam",
          at: ago(12),
        }}
      />
      <Confirm
        c={{ ...ASKS, id: "c5", state: "no", by: "you", at: ago(30), why: "Too many at once" }}
      />
      <Confirm c={{ ...ASKS, id: "c6", state: "gone" }} />
    </div>
  ),
};

/** Messages typed while the agent works: they wait over the composer and go one by one. */
export const Queued: Story = {
  render: function Q() {
    const [turns, setTurns] = useState<QueuedTurn[]>([
      { id: "q1", text: "Also tag them by city." },
      { id: "q2", text: "Then draft a follow-up for the ones in Talking, but don't send it." },
    ]);
    return (
      <div className="max-w-[440px]">
        <QueuedTurns
          turns={turns}
          onEdit={(id, text) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, text } : x)))}
          onRemove={(id) => setTurns((t) => t.filter((x) => x.id !== id))}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const [drop] = c.getAllByRole("button", { name: "Don't send it" });
    if (drop) await userEvent.click(drop);
    await expect(c.getByText("Sends when this reply ends")).toBeTruthy();
  },
};

const SEEN: SeenPart[] = [
  {
    id: "list",
    label: "Leads list, 48 rows",
    icon: "list",
    text: "Leads · filter: Bakeries, Toronto · sort: last reply\n48 rows; first 10: Maple Crust Bakery (New), Rye & Co (New), …",
  },
  {
    id: "selection",
    label: "2 picked",
    icon: "people",
    text: "Picked: Maple Crust Bakery (lead 381), Rye & Co (lead 412)",
  },
];

/** What the agent sees of the page, on the composer: one line; open, every part as it reads it, each can be left out. */
export const Sees: Story = {
  render: function S() {
    const [parts, setParts] = useState(SEEN);
    return (
      <div className="max-w-[440px]">
        <PageSeen
          page="People › Leads"
          parts={parts}
          onToggle={(id) =>
            setParts((p) => p.map((x) => (x.id === id ? { ...x, off: !x.off } : x)))
          }
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: /People › Leads/ }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("The next message carries this")).toBeTruthy();
  },
};

/** Per client, per risky act: Auto, Ask first or Never. Default Ask first. */
export const Dial: Story = {
  render: function D() {
    const [v, setV] = useState<Record<RiskyAct, Autonomy>>({
      send: "approve",
      spend: "approve",
      delete: "off",
      publish: "auto",
    });
    return (
      <div className="max-w-[640px]">
        <AutonomyDial value={v} onChange={(act, to) => setV({ ...v, [act]: to })} />
      </div>
    );
  },
};

/** The parts as they sit in the panel: a reply with its tally, an ask, queued messages, then the composer with its in-view line. */
export const InThePanel: Story = {
  render: function P() {
    const [turns, setTurns] = useState<QueuedTurn[]>([
      { id: "q1", text: "Also tag them by city." },
    ]);
    const [parts, setParts] = useState(SEEN);
    return (
      <div className="grid max-w-[420px] gap-4 rounded-[16px] bg-(--ui-canvas) p-4 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
        <div className="ml-auto max-w-[85%] rounded-[16px] bg-(--ui-fill) px-3.5 py-2 text-[14px] text-(--ui-ink)">
          Move the Bakeries leads that replied to Talking, then email the rest.
        </div>
        <div className="grid gap-2.5">
          <p className="m-0 text-[14px]/[1.55] text-(--ui-ink)">
            Two replied; both are in Talking and tagged warm. The other 12 get the email below once
            you say yes.
          </p>
          <ChangesTally lines={TURNS[0]?.lines ?? []} onOpen={() => {}} />
        </div>
        <Confirm c={ASKS} />
        <div className="grid gap-2">
          <QueuedTurns
            turns={turns}
            onEdit={(id, text) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, text } : x)))}
            onRemove={(id) => setTurns((t) => t.filter((x) => x.id !== id))}
          />
          <div className="grid gap-2 rounded-[16px] bg-(--ui-paper) p-2.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]">
            <span className="px-1 py-1 text-[14px] text-(--ui-ink-3)">Ask the agent…</span>
            <div>
              <PageSeen
                page="People › Leads"
                parts={parts}
                onToggle={(id) =>
                  setParts((p) => p.map((x) => (x.id === id ? { ...x, off: !x.off } : x)))
                }
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
};
