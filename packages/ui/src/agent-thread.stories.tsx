import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { type AgentMessage, AgentThread, type AgentThreadProps } from "./agent-thread.js";

export default {
  title: "Parts/Agent thread",
  id: "agent-thread",
} satisfies Meta;

type Story = StoryObj;

const you = (id: string, text: string): AgentMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const ASK = "Which tools do career coaches use to book discovery calls?";
const ANSWER = `Most coaches book through **Calendly** or **Cal.com**, linked from a lead magnet.

- Calendly: 6 of 9 coach sites read
- Cal.com: 2 of 9
- A form, then a manual reply: 1 of 9

Sources: the 9 pages the run read, in \`birdwatch show r-41\`.`;

const RECALL = {
  type: "tool" as const,
  id: "t1",
  name: "Bash",
  input: { command: "birdwatch recall 'coach booking tools'", description: "Check past runs" },
  result: '{"runs":[{"run":"r-41","ask":"coach booking tools","kept":9}]}',
};

const DONE: AgentMessage[] = [
  you("u1", ASK),
  {
    id: "a1",
    role: "assistant",
    state: "done",
    parts: [
      { type: "thinking", text: "A past run may already answer this. Check recall first." },
      RECALL,
      { type: "text", text: ANSWER },
    ],
    foot: {
      model: "claude-sonnet-5-5",
      ms: 8400,
      input: 1200,
      output: 600,
      cacheRead: 9000,
      cacheWrite: 1000,
      cost: 0.03,
      plan: false,
    },
  },
];

/** The page's side, in a story: send adds the turn, Stop ends it. */
function Live(p: Partial<AgentThreadProps> & { messages: AgentMessage[] }) {
  const [messages, setMessages] = useState(p.messages);
  const [running, setRunning] = useState(p.running ?? false);
  return (
    <div className="h-[640px] bg-(--ui-paper)">
      <AgentThread
        {...p}
        messages={messages}
        running={running}
        onSend={(text) => {
          setMessages((m) => [
            ...m,
            you(`u${m.length}`, text),
            { id: `a${m.length}`, role: "assistant", parts: [], state: "live" },
          ]);
          setRunning(true);
        }}
        onStop={() => {
          setMessages((m) =>
            m.map((x, i) => (i === m.length - 1 ? { ...x, state: "stopped" as const } : x)),
          );
          setRunning(false);
        }}
        onAnswer={(id, allow) =>
          setMessages((m) =>
            m.map((x) => ({
              ...x,
              parts: x.parts.map((q) =>
                q.type === "tool" && q.id === id ? { ...q, ask: { ...q.ask, allowed: allow } } : q,
              ),
            })),
          )
        }
      />
    </div>
  );
}

/** Before the first turn: the welcome over the box; a prompt sends on a click. */
export const Empty: Story = {
  render: () => (
    <Live
      messages={[]}
      placeholder="Ask a research question"
      welcome={{
        title: "What should I research?",
        text: "The agent plans the research with birdwatch, runs it, and answers with sources.",
        suggestions: ["How do coaches book calls?", "Find cold email reply benchmarks."],
      }}
      note="Claude agent on your Claude plan · Bash, Read, Skill"
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "How do coaches book calls?" }));
    await waitFor(() => expect(c.getAllByText("How do coaches book calls?")).toHaveLength(1));
    await waitFor(() => expect(c.getByRole("button", { name: /Stop/ })).toBeTruthy());
  },
};

/** A finished turn: thinking folded, the tool row that opens to its output, the answer, the foot. */
export const Answered: Story = {
  render: () => <Live messages={DONE} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/Sonnet · 8.4 s · 12k tokens · \$0.03/)).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: /Check past runs/ }));
    await expect(c.getByText(/"kept":9/)).toBeTruthy();
  },
};

const STEP = (id: string, command: string, description: string, result?: string) => ({
  type: "tool" as const,
  id,
  name: "Bash",
  input: { command, description },
  ...(result !== undefined ? { result } : {}),
});

/** Many steps fold to one line once done; the plan's turn shows no price. */
export const Steps: Story = {
  render: () => (
    <Live
      messages={[
        you("u1", ASK),
        {
          id: "a1",
          role: "assistant",
          state: "done",
          parts: [
            STEP("s1", "birdwatch recall 'coach booking'", "Check past runs", "{}"),
            STEP("s2", "birdwatch plan 'coach booking tools'", "Plan the run", "{}"),
            STEP("s3", "birdwatch search r-42", "Search the web", "{}"),
            { type: "text", text: ANSWER },
          ],
          foot: {
            model: "claude-haiku-5-5",
            ms: 12500,
            input: 900,
            output: 700,
            cacheRead: 33900,
            cost: 0.04,
            plan: true,
          },
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Ran 3 steps")).toBeTruthy();
    await expect(c.getByText("Haiku · 12.5 s · 36k tokens")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: /Ran 3 steps/ }));
    await expect(c.getByText("Search the web")).toBeTruthy();
  },
};

/** Steps still running: the group open, the count moving. */
export const Running: Story = {
  render: () => (
    <Live
      running
      messages={[
        you("u1", ASK),
        {
          id: "a1",
          role: "assistant",
          state: "live",
          parts: [
            STEP("s1", "birdwatch recall 'coach booking'", "Check past runs", "{}"),
            STEP("s2", "birdwatch plan 'coach booking tools'", "Plan the run"),
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Running step 2 of 2")).toBeTruthy();
  },
};

/** Words still coming: the caret, Stop in place of Send. */
export const Streaming: Story = {
  render: () => (
    <Live
      running
      messages={[
        you("u1", ASK),
        {
          id: "a1",
          role: "assistant",
          state: "live",
          parts: [RECALL, { type: "text", text: "Most coaches book through **Calendly** or" }],
        },
      ]}
    />
  ),
};

/** Nothing back yet: the Thinking chip, then words past a second while the session opens. */
export const Starting: Story = {
  render: () => (
    <Live
      running
      starting
      messages={[you("u1", ASK), { id: "a1", role: "assistant", parts: [], state: "live" }]}
    />
  ),
};

/** The agent asks before a tool runs: the card says what and why, Allow once or Deny. */
export const Asks: Story = {
  render: () => (
    <Live
      running
      messages={[
        you("u1", "Save the brief to a file."),
        {
          id: "a1",
          role: "assistant",
          state: "live",
          parts: [
            {
              type: "tool",
              id: "t2",
              name: "Bash",
              input: { command: "touch $TMPDIR/brief.md", description: "Create the brief file" },
              ask: { why: "A variable in this command can't be checked before it runs" },
            },
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Waiting on you")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(c.getByText("Denied")).toBeTruthy());
  },
};

/** Stop pressed: the reply keeps what came, the foot says Stopped. */
export const Stopped: Story = {
  render: () => (
    <Live
      messages={[
        you("u1", "Write a 400-word essay on research methods."),
        {
          id: "a1",
          role: "assistant",
          state: "stopped",
          parts: [{ type: "text", text: "# The architecture of inquiry\n\nResearch methods are" }],
          foot: { model: "claude-haiku-5-5" },
        },
      ]}
    />
  ),
};

/** The socket closed: one sentence, Retry where it can help. A failed tool says Failed. */
export const Failed: Story = {
  render: () => (
    <Live
      error={{
        text: "The agent isn't running on this Mac. Start it with wren agent serve, then retry.",
        retry: () => {},
      }}
      messages={[
        you("u1", ASK),
        {
          id: "a1",
          role: "assistant",
          state: "failed",
          parts: [{ ...RECALL, result: "birdwatch: ledger locked", failed: true }],
        },
      ]}
    />
  ),
};

/** No access: the box reads only and says why. */
export const Closed: Story = {
  render: () => <Live messages={DONE} closed="You don't have access to this agent." />,
};

/** A chat switch: the last chat stays, dimmed, while the picked one reads; Send waits. */
export const Switching: Story = {
  render: () => <Live messages={DONE} stale />,
};
