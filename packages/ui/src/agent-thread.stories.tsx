import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { LinkPreview } from "./agent-cards.js";
import {
  type AgentCommand,
  AgentPick,
  AgentStatus,
  type AgentTask,
  AgentTasks,
} from "./agent-picks.js";
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
        onSend={(text, files) => {
          setMessages((m) => [
            ...m,
            {
              ...you(`u${m.length}`, text),
              parts: [
                ...(text ? [{ type: "text" as const, text }] : []),
                ...files.map((f) => ({ type: "file" as const, file: f.file })),
              ],
            },
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
        onAnswer={(id, allow, answers) =>
          setMessages((m) =>
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
    await expect(c.getByText(/Sonnet · 12k tokens · \$0.03/)).toBeTruthy();
    await expect(c.getByText("Worked for 8.4s")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: /Check past runs/ }));
    await expect(c.getByText(/"kept":9/)).toBeTruthy();
  },
};

function Picks() {
  const [model, setModel] = useState("sonnet");
  const [effort, setEffort] = useState("");
  const [mode, setMode] = useState("bypassPermissions");
  return (
    <>
      <AgentPick
        label="Model"
        value={model}
        options={[
          { value: "sonnet", label: "Sonnet" },
          { value: "opus", label: "Opus" },
          { value: "fable", label: "Fable" },
          { value: "haiku", label: "Haiku" },
        ]}
        onChange={setModel}
      />
      <AgentPick
        label="Effort"
        value={effort}
        options={[
          { value: "", label: "Auto effort", hint: "The model's own level" },
          { value: "high", label: "High" },
          { value: "max", label: "Max" },
        ]}
        onChange={setEffort}
      />
      <AgentPick
        label="Permissions"
        value={mode}
        options={[
          { value: "default", label: "Ask first" },
          { value: "bypassPermissions", label: "Bypass", hint: "Runs every tool", warn: true },
        ]}
        onChange={setMode}
      />
    </>
  );
}

const TASKS: AgentTask[] = [
  { id: "b1", type: "local_bash", description: "pnpm dev", started: Date.now() - 74_000 },
  {
    id: "b2",
    type: "monitor",
    description: "Watch the deploy",
    started: Date.now() - 9_000,
    summary: "CI gates green",
  },
  {
    id: "b3",
    type: "local_agent",
    description: "Read 9 coach sites",
    started: Date.now() - 31_000,
  },
];

function Tasks() {
  const [t, setT] = useState(TASKS);
  return <AgentTasks tasks={t} onStop={(id) => setT((x) => x.filter((o) => o.id !== id))} />;
}

/** The box: background tasks over it, model, effort and mode in its foot, the status line under. */
export const Foot: Story = {
  render: () => (
    <Live
      messages={DONE}
      above={<Tasks />}
      tools={<Picks />}
      note={
        <AgentStatus
          info={{
            model: "Sonnet",
            effort: "high",
            context: { used: 172_000, max: 200_000 },
            fiveHour: 34,
            sevenDay: 97,
          }}
        />
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("172k/200k (86%)")).toBeTruthy();
    await expect(c.getByText("7d 97%")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: "Effort: Auto effort" }));
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("option", { name: /Max/ }));
    await waitFor(() => expect(c.getByRole("button", { name: "Effort: Max" })).toBeTruthy());
    await expect(c.getByRole("button", { name: "Permissions: Bypass" })).toBeTruthy();
    await expect(c.getByText("1m 14s")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: "Stop pnpm dev" }));
    await waitFor(() => expect(c.queryByText("pnpm dev")).toBeNull());
  },
};

const COMMANDS: AgentCommand[] = [
  { name: "compact", description: "Clear history but keep a summary in context", hint: "<focus>" },
  { name: "context", description: "Show context usage" },
  { name: "review", description: "Review a pull request" },
];

/** `/` at the start of the box lists the session's commands; a pick fills the box. */
export const Slash: Story = {
  render: () => <Live messages={DONE} commands={COMMANDS} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const box = c.getByRole("textbox");
    await userEvent.type(box, "/co");
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByText("/compact")).toBeTruthy();
    await expect(page.queryByText("/review")).toBeNull();
    await userEvent.click(page.getByText("/context"));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe("/context "));
  },
};

const STEP = (id: string, command: string, description: string, result?: string) => ({
  type: "tool" as const,
  id,
  name: "Bash",
  input: { command, description },
  ...(result !== undefined ? { result } : {}),
});

/** Steps append in order: named calls as rows, plain commands as one terminal block, then Done. */
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
            STEP("s2", "curl -sI https://northwind.example", "Read the site", "HTTP/2 200"),
            STEP("s3", "wc -w page.md", "Count words", "2140 page.md"),
            STEP("s4", "rg -c calendly pages/", "Find booking links", "6"),
            STEP("s5", "birdwatch search r-42", "Search the web", '{"kept":9,"pages":[1,2,3]}'),
            { type: "text", text: ANSWER },
          ],
          foot: {
            model: "claude-haiku-5-5",
            ms: 24_000,
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
    await expect(c.getByText("Check past runs")).toBeTruthy();
    await expect(c.getByText("Ran 3 commands")).toBeTruthy();
    await expect(c.getByText("Search the web")).toBeTruthy();
    await expect(c.getByText("Done")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: /Ran 3 commands/ }));
    await expect(c.getByText("wc -w page.md")).toBeTruthy();
  },
};

/** Steps still running: done rows stay, the live one shimmers, the turn line counts up. */
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
            STEP("s2", "curl -sI https://northwind.example", "Read the site", "HTTP/2 200"),
            STEP("s3", "wc -w page.md", "Count words"),
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Check past runs")).toBeTruthy();
    await expect(c.getByText("Running 2 commands")).toBeTruthy();
    await expect(c.getByRole("status")).toBeTruthy();
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
    await expect(c.getByRole("status").textContent).toMatch(/Waiting on you/);
    await userEvent.click(c.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(c.getByText("denied")).toBeTruthy());
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
        text: "The agent isn't running on this Mac. Start its relay, then retry.",
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

// a 2×2 PNG: a picture without a network
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNkYPj/n4GBgYGJgYGBAQAqVwMBJJ1sJwAAAABJRU5ErkJggg==";

/** Files in a turn: a picture, a video, a PDF; the page the turn came from under it. The box takes more. */
export const Files: Story = {
  render: () => {
    const [page, setPage] = useState<string | null>("Campaigns › Sends (/campaigns/sends)");
    return (
      <Live
        messages={[
          {
            id: "u1",
            role: "user",
            page: "Studio › Videos (/studio/videos)",
            parts: [
              { type: "text", text: "Which of these hooks lands first? Check the cut too." },
              { type: "file", file: { name: "hook-a.png", kind: "image", src: PIXEL } },
              { type: "file", file: { name: "promo-cut-3.mp4", kind: "video", size: 48_200_000 } },
              { type: "file", file: { name: "brief.pdf", kind: "pdf" } },
            ],
          },
          {
            id: "a1",
            role: "assistant",
            state: "done",
            parts: [
              STEP("w1", "birdwatch watch /u/ab/1/promo-cut-3.mp4", "Read the video", "{}"),
              { type: "text", text: "Hook A lands first: the number is on screen by 0.8 s." },
            ],
          },
        ]}
        files={{
          accept: "*",
          ready: (f) =>
            new Promise((res, rej) =>
              setTimeout(
                () => (f.size > 5_000_000 ? rej(new Error("Files stop at 5 MB here")) : res([])),
                600,
              ),
            ),
        }}
        context={page ? { label: page, onDrop: () => setPage(null) } : null}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("promo-cut-3.mp4")).toBeTruthy();
    await expect(c.getByText("Studio › Videos (/studio/videos)")).toBeTruthy();
    await userEvent.click(c.getByRole("button", { name: "Don't send this page" }));
    await waitFor(() => expect(c.queryByText(/Campaigns › Sends/)).toBeNull());
    // the picker's input exists only on a click: a paste takes the same path
    const box = c.getByRole("textbox");
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "notes.txt", { type: "text/plain" }));
    box.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(c.getByText("notes.txt")).toBeTruthy());
    await waitFor(() => expect(c.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(c.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(c.getAllByText("notes.txt")).toHaveLength(1));
  },
};

const ASK_TOOL = (id: string, questions: unknown[], more: Record<string, unknown> = {}) => ({
  type: "tool" as const,
  id,
  name: "AskUserQuestion",
  input: { questions },
  ask: {},
  ...more,
});

const WHICH = {
  header: "Next run",
  question: "Which buyers should the next run read?",
  multiSelect: false,
  options: [
    { label: "Career coaches", description: "Solo coaches who sell 1:1 packages." },
    { label: "Coaching firms", description: "Teams of 5 or more, with a sales lead." },
    { label: "Both, side by side" },
  ],
};

const SOURCES = {
  header: "Sources",
  question: "Which sources may it read?",
  multiSelect: true,
  options: [
    { label: "Coach sites" },
    { label: "Reddit threads" },
    { label: "YouTube talks", description: "Slower: each video is watched in full." },
  ],
};

/** The agent's options as buttons: one pick sends; many picks, then Send; Skip says no. Answered cards stay, the pick marked. */
export const Choices: Story = {
  render: () => (
    <Live
      running
      messages={[
        you("u1", "Plan the next research run."),
        {
          id: "a1",
          role: "assistant",
          state: "done",
          parts: [
            { type: "text", text: "Two runs fit. Pick one." },
            ASK_TOOL("c1", [WHICH], {
              ask: { allowed: true },
              answers: { [WHICH.question]: "Coaching firms" },
            }),
            ASK_TOOL("c2", [SOURCES], { ask: { allowed: false } }),
          ],
        },
        you("u2", "Again, with sources."),
        {
          id: "a2",
          role: "assistant",
          state: "live",
          parts: [ASK_TOOL("c3", [WHICH, SOURCES])],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText("Skipped")).toBeTruthy();
    const send = c.getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    const firms = c.getAllByRole("button", { name: /^Coaching firms/ }).at(-1);
    if (!firms) throw new Error("no option");
    await userEvent.click(firms);
    await userEvent.click(c.getAllByRole("button", { name: /^Coach sites/ }).at(-1) as HTMLElement);
    await userEvent.click(
      c.getAllByRole("button", { name: /^Reddit threads/ }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => expect(c.queryByRole("button", { name: "Send" })).toBeNull());
    await expect(c.getAllByRole("button", { name: /^Reddit threads/, pressed: true })).toHaveLength(
      1,
    );
  },
};

/** A web address in a turn shows as a card: the site, then the path; it opens in a new tab. */
export const Links: Story = {
  render: () => (
    <Live
      messages={[
        you(
          "u1",
          "Compare the pricing on https://www.northwind.example/pricing/teams-and-enterprise-plans?billing=annual with https://acme.example.",
        ),
        {
          id: "a1",
          role: "assistant",
          state: "done",
          parts: [{ type: "text", text: "Northwind charges per seat; Acme charges per run." }],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = c.getByRole("link", { name: /northwind\.example/ });
    await expect(card).toHaveAttribute("target", "_blank");
    await expect(c.getByRole("link", { name: /^acme\.example/ })).toBeTruthy();
  },
};

const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)}`;
const CARD_ART = svg(
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6f5e"/><stop offset="1" stop-color="#d9b46a"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="900" cy="200" r="140" fill="#fff" opacity=".18"/>',
  1200,
  630,
);
const MARK = (fill: string) => svg(`<rect width="32" height="32" rx="7" fill="${fill}"/>`, 32, 32);
const PREVIEWS: Record<string, LinkPreview> = {
  "https://www.northwind.example/pricing": {
    title:
      "Northwind pricing: Teams, Business and Enterprise plans compared for growing sales teams",
    line: "Per-seat plans from $12 a month. Annual billing saves two months. Every plan has the API.",
    image: CARD_ART,
    icon: MARK("#2f6f5e"),
  },
  "https://acme.example/": { title: "Acme: runs, not seats", icon: MARK("#b4532a") },
};

/** A sent link reads its page's head: an image card, a titled row, or the bare site when the page
 * gives nothing. */
export const Previews: Story = {
  render: () => (
    <Live
      preview={async (href) => PREVIEWS[href] ?? {}}
      messages={[
        you(
          "u1",
          "Compare https://www.northwind.example/pricing with https://acme.example/ and https://plain.example/docs/start.",
        ),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(
      await c.findByRole("link", { name: /Teams, Business and Enterprise/ }),
    ).toBeTruthy();
    await expect(await c.findByRole("link", { name: /Acme: runs, not seats/ })).toBeTruthy();
    await expect(c.getByRole("link", { name: /^plain\.example/ })).toBeTruthy();
  },
};

const SHOT = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#f4f1ea"/><rect x="40" y="40" width="880" height="64" rx="10" fill="#e4dfd3"/><rect x="40" y="136" width="560" height="424" rx="14" fill="#2f6f5e"/><rect x="632" y="136" width="288" height="200" rx="14" fill="#d9b46a"/><rect x="632" y="360" width="288" height="200" rx="14" fill="#b4532a"/></svg>`;

/** Paths the agent names to an image or video show it under the path; a refused one shows nothing. */
export const Paths: Story = {
  render: () => (
    <Live
      readFile={async (path) => {
        if (path.endsWith("shot-1280.png")) return new Blob([SHOT], { type: "image/svg+xml" });
        throw new Error("relay 403");
      }}
      messages={[
        you("u1", "Shoot the pricing page at 1280."),
        {
          id: "a1",
          role: "assistant",
          state: "done",
          parts: [
            {
              type: "text",
              text: "Saved the shot to `~/Documents/shots/pricing/shot-1280.png`. The other one, /etc/far-away.png, is outside this chat's folders.",
            },
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByRole("img", { name: "shot-1280.png" })).toBeTruthy();
    await expect(
      c.getByText("~/Documents/shots/pricing/shot-1280.png", { selector: "figcaption" }),
    ).toBeTruthy();
    await expect(c.queryByText("/etc/far-away.png", { selector: "figcaption" })).toBeNull();
  },
};

/** One question, one pick: the click sends; "Something else…" opens a line for the person's own words. */
export const Choice: Story = {
  render: () => (
    <Live
      running
      messages={[
        you("u1", "Plan the next research run."),
        { id: "a1", role: "assistant", state: "live", parts: [ASK_TOOL("c1", [WHICH])] },
      ]}
    />
  ),
};
