/**
 * The agent chat as the page builds it (WA-1076): the real page, SDK and thread code over a fake
 * relay (`./mocks/relay.ts`) that replays tapes from the real one. The tapes set what the page must
 * show, so a story can't look better than the live chat; only the data is recorded. Re-record:
 * `wren agent serve --tape <dir>`, drive a chat, `node packages/agent/scripts/scrub-tape.mjs`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, sse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import CARD from "./mocks/data/agent/card.json";
import COMMANDS from "./mocks/data/agent/commands.json";
import COMPACTED_CHAT from "./mocks/data/agent/compacted.json";
import HISTORY from "./mocks/data/agent/history.json";
import SETUPS from "./mocks/data/agent/setups.json";
import STOP from "./mocks/data/agent/stop.json";
import WORK from "./mocks/data/agent/work.json";
import { ADMIN } from "./mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "./mocks/data/research.js";
import { pageAt } from "./mocks/page.js";
import { fakeRelay, type TapeLine, typedOn } from "./mocks/relay.js";
import { SERVE } from "./modules/research/serve.js";

const meta: Meta = { title: "Wren/Agent chat", id: "pages-agent" };
export default meta;

const TAPES = { work: WORK, stop: STOP, commands: COMMANDS } as Record<string, TapeLine[]>;
const LIBRARY = Object.values(TAPES);
const STORED = "00000000-0000-4000-8000-000000000001";
const CARDED = "00000000-0000-4000-8000-000000000002";
const COMPACTED = "00000000-0000-4000-8000-000000000003";
const LONG = { timeout: 30_000 };
type Stored = NonNullable<Parameters<typeof fakeRelay>[0]["stored"]>[number];

const story = (
  at: string,
  tape: TapeLine[],
  check: (page: HTMLElement) => Promise<void>,
  more: Stored[] = [],
): StoryObj => {
  const base = pageAt(at, { me: ADMIN, check });
  const relay = fakeRelay({
    tape,
    library: LIBRARY,
    setups: SETUPS,
    stored: [
      ...more,
      { session: STORED, at: "2026-11-04T23:01:40Z", title: "Bakery buyers", frames: HISTORY },
    ],
  });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...relay, ...(base.parameters?.msw ?? [])] },
  };
};

async function say(page: HTMLElement, text: string) {
  const c = within(page);
  const box = await c.findByRole("textbox", { name: "Message" }, LONG);
  await userEvent.click(box);
  await userEvent.paste(text);
  await userEvent.click(c.getByRole("button", { name: "Send" }));
}

/** The tape's background command: its chip carries the description. */
const background = (tape: TapeLine[]) => {
  for (const { frame } of tape) {
    const m = frame.message as { content?: { type: string; input?: Record<string, unknown> }[] };
    if (frame.type !== "assistant" || !Array.isArray(m?.content)) continue;
    const b = m.content.find((x) => x.type === "tool_use" && x.input?.run_in_background);
    if (b) return String(b.input?.description);
  }
  throw new Error("no background command on the tape");
};

/** Tools, a command allowed, a background task and its output, a question answered, a second turn. */
export const Work = story("/research/ask?setup=birdwatch", TAPES.work ?? [], async (page) => {
  const c = within(page);
  const tape = TAPES.work ?? [];
  const [first = "", second = ""] = typedOn(tape);
  await say(page, first);
  // each ask in turn: the command, then the question
  await waitFor(async () => {
    // answered asks stay disabled until the next frame lands
    const allow = c
      .queryAllByRole("button", { name: "Allow once" })
      .find((x) => !(x as HTMLButtonElement).disabled);
    if (allow) await userEvent.click(allow);
    await expect(c.getByRole("button", { name: /northwind\.example/ })).toBeTruthy();
  }, LONG);
  // a plugin skill shows by its own name
  expect(c.getByText("Load the birdwatch skill")).toBeTruthy();
  const task = background(tape);
  await userEvent.click(await c.findByRole("button", { name: task }, LONG));
  const out = await c.findByRole("region", { name: `Output of ${task}` }, LONG);
  await waitFor(() => expect(within(out).getByText(/tick 1/)).toBeTruthy(), LONG);
  await userEvent.click(c.getByRole("button", { name: /northwind\.example/ }));
  await c.findByText(/tokens/, {}, LONG);
  await waitFor(() => expect(c.getByRole("button", { name: "Send" })).toBeTruthy(), LONG);
  await say(page, second);
  await c.findByText(/42/, {}, LONG);
});

/** Stopped mid-answer: the turn ends where it was, and the next one runs. */
export const Stop = story("/research/ask?setup=birdwatch", TAPES.stop ?? [], async (page) => {
  const c = within(page);
  const [first = "", second = ""] = typedOn(TAPES.stop ?? []);
  await say(page, first);
  await userEvent.click(await c.findByRole("button", { name: "Stop" }, LONG));
  await waitFor(() => expect(c.getByRole("button", { name: "Send" })).toBeTruthy(), LONG);
  await say(page, second);
  await c.findByText(/42/, {}, LONG);
});

/** Typed commands: two refused by the relay, the rest run; the pickers follow /model and /effort. */
export const Commands = story(
  "/research/ask?setup=birdwatch",
  TAPES.commands ?? [],
  async (page) => {
    const c = within(page);
    const typed = typedOn(TAPES.commands ?? []);
    const after: Record<string, () => Promise<unknown>> = {
      "/effort huge": () =>
        c.findByText(/Effort is one of low, medium, high, xhigh, max\./, {}, LONG),
      "/model gpt": () =>
        c.findByText(/This chat offers sonnet, haiku, opus, fable, not gpt\./, {}, LONG),
      "/context": () => c.findByText(/Context Usage/, {}, LONG),
      "/model haiku": () => c.findByRole("button", { name: /^Model: Haiku/ }, LONG),
      "/effort low": () => c.findByRole("button", { name: /^Effort: Low/ }, LONG),
    };
    for (const t of typed) {
      await waitFor(() => expect(c.getByRole("button", { name: "Send" })).toBeTruthy(), LONG);
      await say(page, t);
      await after[t]?.();
    }
  },
);

/** A stored chat, read back from the relay. */
export const Stored = story(`/research/ask?setup=birdwatch&chat=${STORED}`, [], async (page) => {
  const c = within(page);
  await c.findByText(/A test of the chat page/, {}, LONG);
  await c.findByText(/42/, {}, LONG);
});

/** The side panel on a page past Ask: its Chats menu lists the stored chats. */
export const Panel = story("/research/runs", [], async (page) => {
  const c = within(page);
  await userEvent.click(await c.findByRole("button", { name: "Agent" }, LONG));
  await userEvent.click(await c.findByRole("button", { name: "Chats" }, LONG));
  await within(document.body).findByText("Bakery buyers", {}, LONG);
});

/**
 * A step's output names its run (`::view research.run`): the run's card, read from birdwatch
 * serve, once and under the last step. These frames are written by hand in the stored shape.
 */
export const Card = (() => {
  const base = story(
    `/research/ask?setup=birdwatch&chat=${CARDED}`,
    [],
    async (page) => {
      const c = within(page);
      const card = await c.findByRole("article", { name: /^Birdwatch run: / }, LONG);
      expect(within(card).getByText("How do small bakeries find wholesale buyers?")).toBeTruthy();
      expect(c.getAllByRole("article", { name: /^Birdwatch run: / })).toHaveLength(1);
      await c.findByText(/The review is next/, {}, LONG);
    },
    [{ session: CARDED, at: "2026-11-05T18:00:00Z", title: "Wholesale buyers", frames: CARD }],
  );
  const served = [
    http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: RESEARCH_ROWS })),
    http.get(`${SERVE}/runs/:run`, () => HttpResponse.json(RESEARCH_VIEW)),
    sse(`${SERVE}/events`, () => {}),
  ];
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...(base.parameters?.msw ?? [])] },
  };
})();

/**
 * A chat after `/compact` (a real session, scrubbed): the turns before stay, a rule marks the
 * compaction, and the meter, kept from the chat's last turn, opens its menu.
 */
export const Compacted: StoryObj = {
  ...story(
    `/research/ask?setup=birdwatch&chat=${COMPACTED}`,
    [],
    async (page) => {
      const c = within(page);
      await c.findByText(/Strawberry/, {}, LONG);
      await c.findByText("Compacted: 12k to 1.2k tokens", {}, LONG);
      expect(c.queryByText(/This session is being continued/)).toBeNull();
      await userEvent.click(await c.findByRole("button", { name: /^Context: / }, LONG));
      const menu = await within(document.body).findByRole("menu", { name: "Context" });
      expect(within(menu).getByRole("menuitemcheckbox", { name: "Auto-compact" }).ariaChecked).toBe(
        "true",
      );
      expect(within(menu).getByRole("menuitem", { name: "Compact now" })).toBeTruthy();
    },
    [
      {
        session: COMPACTED,
        at: "2026-11-06T16:29:30Z",
        title: "Fruit list",
        frames: COMPACTED_CHAT,
      },
    ],
  ),
  beforeEach: () => {
    const key = `agent-status:${COMPACTED}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        model: "claude-haiku-5-5",
        effort: "medium",
        context: { used: 15_598, max: 1_000_000 },
        autoCompact: true,
        compactAt: 967_000,
      }),
    );
    return () => localStorage.removeItem(key);
  },
};
