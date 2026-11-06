/**
 * Birdwatch in the agent chat (WA-1123), a draft for William: the three jobs he named (read one
 * source, research its channel, a standard run) as cards made of the graph's parts.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { type AgentMessage, type AgentPart, AgentThread } from "../agent-thread.js";
import { CHANNEL_RUN, LIVE_RUN, ORDER_RUN, REEL_READ, WORST_RUN } from "../fixtures/index.js";
import { RESEARCH_VIEWS } from "./chat.js";

export default {
  title: "Parts/Birdwatch in the chat",
  id: "research-chat",
} satisfies Meta;

type Story = StoryObj;

const REEL = "https://video.example/reel/price-a-loaf";

const you = (id: string, text: string): AgentMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const step = (id: string, command: string, description: string, result: string): AgentPart => ({
  type: "tool",
  id,
  name: "Bash",
  input: { command, description },
  result,
});

const reply = (id: string, parts: AgentPart[], live = false): AgentMessage => ({
  id,
  role: "assistant",
  state: live ? "live" : "done",
  parts,
});

/** The page's side: a sent turn joins the thread; an answer marks its card. */
function Chat({ messages, running = false }: { messages: AgentMessage[]; running?: boolean }) {
  const [turns, setTurns] = useState(messages);
  return (
    <div className="h-[720px] bg-(--ui-paper)">
      <AgentThread
        messages={turns}
        running={running}
        views={RESEARCH_VIEWS}
        onSend={(text) => setTurns((m) => [...m, you(`u${m.length}`, text)])}
        onStop={() => {}}
        onAnswer={(id, allow, answers) =>
          setTurns((m) =>
            m.map((x) => ({
              ...x,
              parts: x.parts.map((q) =>
                q.type === "tool" && q.id === id
                  ? { ...q, ask: { ...q.ask, allowed: allow }, ...(answers ? { answers } : {}) }
                  : q,
              ),
            })),
          )
        }
      />
    </div>
  );
}

/** A reel comes in with no job named: the agent asks how far to go. */
export const Scope: Story = {
  render: () => (
    <Chat
      running
      messages={[
        you("u1", `Look at this. ${REEL}`),
        reply(
          "a1",
          [
            {
              type: "tool",
              id: "q1",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    header: "Birdwatch",
                    question: "How far should I go from this reel?",
                    multiSelect: false,
                    options: [
                      {
                        label: "Read this reel only",
                        description: "Watch it, keep its findings, stop.",
                      },
                      {
                        label: "Research the whole channel",
                        description: "Read its other videos and their comments.",
                      },
                      {
                        label: "Research the topic",
                        description: "A standard run: questions, searches, claims.",
                      },
                    ],
                  },
                ],
              },
              ask: {},
            },
          ],
          true,
        ),
      ]}
    />
  ),
};

/** Read one source and stop: its findings as text, and the wider jobs as buttons. */
export const OneSource: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", `Just watch this one. ${REEL}`),
        reply("a1", [
          step("t1", `birdwatch read ${REEL}`, "Watch the reel", '{"kept":7,"cut":2}'),
          { type: "text", text: "Watched it. 7 findings kept. I started no run." },
          { type: "view", id: "v1", name: "research.source", data: REEL_READ },
        ]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole("button", { name: "Research the whole channel" }));
    await waitFor(() => expect(c.getAllByText("Research the whole channel").length).toBe(2));
  },
};

/** A run on the reel's whole channel: the islands are the channel, its comments, channels like it. */
export const Channel: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "Research the whole channel"),
        reply("a1", [
          step(
            "t1",
            "birdwatch run 'Mara Bakes: what the channel does'",
            "Read the channel",
            '{"run":"r-54"}',
          ),
          {
            type: "text",
            text: "The channel repeats three moves. Each one has findings from more than one video.",
          },
          { type: "view", id: "v1", name: "research.run", data: CHANNEL_RUN },
        ]),
      ]}
    />
  ),
};

/** A standard run, done. A claim row lights its sources in the graph and opens its findings. */
export const Answered: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "What does online ordering cost a small bakery?"),
        reply("a1", [
          step(
            "t1",
            "birdwatch run 'Bakeries: what online ordering costs them'",
            "Run the research",
            '{"run":"r-52"}',
          ),
          {
            type: "text",
            text: "Fees and stock are the two costs owners name most. Four claims hold, each from more than one source.",
          },
          { type: "view", id: "v1", name: "research.run", data: ORDER_RUN },
        ]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const row = await c.findByRole("button", { name: /Claim 2: Marketplace fees/ });
    await userEvent.click(row);
    const open = await c.findByRole("region", { name: "Claim 2" });
    await expect(within(open).getByText(/27% of each marketplace order/)).toBeVisible();
    await expect(row).toHaveAttribute("aria-pressed", "true");
  },
};

/** A source picked from the sources list: its findings, each with the claim that uses it. */
export const SourcePicked: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "Which source says the most?"),
        reply("a1", [
          { type: "text", text: "The Proof Room. Five of its findings are in a claim." },
          { type: "view", id: "v1", name: "research.run", data: ORDER_RUN },
        ]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByText("18 sources"));
    await userEvent.click(await c.findByRole("button", { name: /The Proof Room/ }));
    const open = await c.findByRole("region", { name: "The Proof Room" });
    await expect(within(open).getAllByRole("button", { name: /claim \d/ }).length).toBe(5);
  },
};

/** A run that still reads: sources fill in, no claims yet. */
export const Live: Story = {
  render: () => (
    <Chat
      running
      messages={[
        you("u1", "What does online ordering cost a small bakery?"),
        reply(
          "a1",
          [
            step("t1", "birdwatch plan", "Plan 3 questions and 6 searches", '{"questions":3}'),
            { type: "view", id: "v1", name: "research.run", data: LIVE_RUN },
          ],
          true,
        ),
      ]}
    />
  ),
};

/** 60 sources, 9 long claims, long names: nothing leaves the card. */
export const WorstCase: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "Run the large one."),
        reply("a1", [{ type: "view", id: "v1", name: "research.run", data: WORST_RUN }]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const card = await within(canvasElement).findByRole("article");
    await waitFor(() => expect(card.querySelector("svg[role=img]")).not.toBeNull());
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  },
};
