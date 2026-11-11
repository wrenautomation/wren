/**
 * Weaver in the agent chat (WA-1123): a run draws as the Research page's own graph in card mode;
 * one read source as its findings. Same data as the page (`RunGraphData`).
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useContext, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Say } from "../../agent-cards.js";
import {
  type AgentMessage,
  type AgentPart,
  AgentThread,
  type AgentViews,
} from "../../agent-thread.js";
import {
  REEL_READ,
  RUN_ASKS,
  RUN_GRAPH,
  RUN_GRAPH_EMPTY,
  RUN_GRAPH_ONE_ROUND,
  RUN_GRAPH_WORST,
} from "../../fixtures/index.js";
import { RunCard, type RunCardProps, SourceCard, type SourceRead } from "./card.js";

export default {
  title: "Parts/Weaver in the chat",
  id: "research-chat",
} satisfies Meta;

/** the portal's views table, as `modules/research/chat-card.tsx` draws them */
const VIEWS: AgentViews = {
  "research.run": function RunView({ data }) {
    return <RunCard {...(data as RunCardProps)} onAsk={useContext(Say)} />;
  },
  "research.source": function SourceView({ data }) {
    return <SourceCard read={data as SourceRead} onAsk={useContext(Say)} />;
  },
};

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
    <div className="h-[880px] bg-(--ui-paper)">
      <AgentThread
        messages={turns}
        running={running}
        views={VIEWS}
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
                    header: "Weaver",
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
          step("t1", `weaver read ${REEL}`, "Watch the reel", '{"kept":7,"cut":2}'),
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

const run = (data: RunCardProps): AgentPart => ({
  type: "view",
  id: "v1",
  name: "research.run",
  data: { href: "/research/runs?run=r-52&pane=runs", ...data },
});

/** A standard run, done: the page's graph; a next ask goes as his turn. */
export const Default: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "How do small shops price custom cakes?"),
        reply("a1", [
          step("t1", "weaver brief r-52", "Write the brief", '{"claims":7}'),
          {
            type: "text",
            text: "Per serving pricing and deposits hold across most sources. Seven claims, each from more than one source.",
          },
          run({ run: RUN_GRAPH, asks: RUN_ASKS }),
        ]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = await c.findByRole("article", { name: /Weaver run/ });
    await waitFor(() => expect(card.querySelector(".rg-nodes [data-n]")).not.toBeNull());
    const name = RUN_ASKS[0]?.ask ?? "";
    const ask = c.getByRole("button", { name });
    await expect(ask).toHaveAttribute("title", expect.stringMatching(/Claim 2/));
    await userEvent.click(ask);
    await waitFor(() => expect(c.getAllByText(name).length).toBe(2));
  },
};

/** A run that still reads: one round so far. */
export const Live: Story = {
  render: () => (
    <Chat
      running
      messages={[
        you("u1", "How do small shops price custom cakes?"),
        reply(
          "a1",
          [
            step("t1", "weaver plan", "Plan 3 questions and 4 searches", '{"questions":3}'),
            run({ run: RUN_GRAPH_ONE_ROUND, live: true }),
          ],
          true,
        ),
      ]}
    />
  ),
};

/** A run with no searches yet. */
export const Empty: Story = {
  render: () => (
    <Chat
      running
      messages={[
        you("u1", "How do small shops price custom cakes?"),
        reply("a1", [run({ run: RUN_GRAPH_EMPTY, live: true })], true),
      ]}
    />
  ),
};

export const Loading: Story = {
  render: () => <Chat messages={[you("u1", "Open run r-52."), reply("a1", [run({})])]} />,
};

export const Failed: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "Open run r-52."),
        reply("a1", [run({ failed: "weaver serve stopped answering." })]),
      ]}
    />
  ),
};

/** 140 sources, 5 rounds, long names: nothing leaves the card. */
export const WorstCase: Story = {
  render: () => (
    <Chat
      messages={[
        you("u1", "Run the large one."),
        reply("a1", [run({ run: RUN_GRAPH_WORST, asks: RUN_ASKS })]),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const card = await within(canvasElement).findByRole("article", { name: /Weaver run/ });
    await waitFor(() => expect(card.querySelector(".rg-nodes [data-n]")).not.toBeNull());
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  },
};
