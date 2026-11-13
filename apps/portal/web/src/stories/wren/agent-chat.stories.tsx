/** The side chat: an agent's work, stop, commands, stored chats. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, sse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Answers } from "../../mocks/api.js";
import CARD from "../../mocks/data/agent/card.json";
import COMMANDS from "../../mocks/data/agent/commands.json";
import COMPACTED_CHAT from "../../mocks/data/agent/compacted.json";
import HISTORY from "../../mocks/data/agent/history.json";
import SETUPS from "../../mocks/data/agent/setups.json";
import STOP from "../../mocks/data/agent/stop.json";
import VIREO_CHAT from "../../mocks/data/agent/vireo.json";
import WORK from "../../mocks/data/agent/work.json";
import { ADMIN } from "../../mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { pageAt } from "../../mocks/page.js";
import { fakeRelay, type TapeLine, typedOn } from "../../mocks/relay.js";
import { PANEL_KEYS } from "../../modules/agent/panel.js";
import { SERVE } from "../../modules/research/serve.js";

const meta: Meta = { title: "Wren/Agent chat" };
export default meta;

const TAPES = { work: WORK, stop: STOP, commands: COMMANDS } as Record<string, TapeLine[]>;

const LIBRARY = Object.values(TAPES);

const STORED = "00000000-0000-4000-8000-000000000001";

const CARDED = "00000000-0000-4000-8000-000000000002";

const COMPACTED = "00000000-0000-4000-8000-000000000003";

const VIREO = "00000000-0000-4000-8000-000000000004";

const LONG = { timeout: 30_000 };

/** weaver serve with no runs */
const NO_RUNS = [
  http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: [] })),
  sse(`${SERVE}/events`, () => {}),
];

type Stored = NonNullable<Parameters<typeof fakeRelay>[0]["stored"]>[number];

/** `?setup=weaver[&chat=…]` in `at`: the side panel opens on that chat (the chat lives only there). */
const story = (
  at: string,
  tape: TapeLine[],
  check: (page: HTMLElement) => Promise<void>,
  more: Stored[] = [],
  answers: Answers = {},
): StoryObj => {
  const u = new URL(at, "http://x");
  const setup = u.searchParams.get("setup");
  const chat = u.searchParams.get("chat");
  u.searchParams.delete("setup");
  u.searchParams.delete("chat");
  // tests the chat, not the page behind it
  const base = pageAt(u.pathname + u.search, { me: ADMIN, check, empty: false, answers });
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
    beforeEach: () => {
      (base.beforeEach as (() => void) | undefined)?.();
      // each story starts clean: a door click never closes a panel an earlier story left open
      const clear = () => {
        localStorage.removeItem(PANEL_KEYS.open);
        sessionStorage.removeItem(PANEL_KEYS.chat);
      };
      clear();
      if (setup) {
        localStorage.setItem(PANEL_KEYS.open, JSON.stringify({ open: true }));
        sessionStorage.setItem(
          PANEL_KEYS.chat,
          JSON.stringify({ setup, chats: { [setup]: chat } }),
        );
      }
      return clear;
    },
    // last: a story's own serve wins; never the Mac's real weaver serve
    parameters: {
      ...base.parameters,
      msw: [...relay, ...(base.parameters?.msw ?? []), ...NO_RUNS],
    },
  };
};

/** The panel's door: the sidebar's foot and a phone's top bar may both draw one. */
const agentDoor = async (c: ReturnType<typeof within>) =>
  (await c.findAllByRole("button", { name: "Agent" }, LONG))[0] as HTMLElement;

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
export const Work = story("/research/runs?setup=weaver", TAPES.work ?? [], async (page) => {
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
  expect(c.getByText("Load the weaver skill")).toBeTruthy();
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
export const Stop = story("/research/runs?setup=weaver", TAPES.stop ?? [], async (page) => {
  const c = within(page);
  const [first = "", second = ""] = typedOn(TAPES.stop ?? []);
  await say(page, first);
  await userEvent.click(await c.findByRole("button", { name: "Stop" }, LONG));
  await waitFor(() => expect(c.getByRole("button", { name: "Send" })).toBeTruthy(), LONG);
  await say(page, second);
  await c.findByText(/42/, {}, LONG);
});

/** Typed commands: two refused by the relay, the rest run; the pickers follow /model and /effort. */
export const Commands = story("/research/runs?setup=weaver", TAPES.commands ?? [], async (page) => {
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
});

/** A stored chat, read back from the relay. */
export const Stored = story(`/research/runs?setup=weaver&chat=${STORED}`, [], async (page) => {
  const c = within(page);
  await c.findByText(/A test of the chat page/, {}, LONG);
  await c.findByText(/42/, {}, LONG);
});

/** What the chat changed and asks (designs/2026-11-11-agent-panel.md): a Yes or No card over the box, a tally at the reply's foot, Changes per turn. */
export const ChangesAndAsk = story(
  `/research/runs?setup=weaver&chat=${STORED}`,
  [],
  async (page) => {
    const c = within(page);
    await c.findByText(/Send 12 emails to the spring list/, {}, LONG);
    await c.findByRole("button", { name: /Yes, send/ }, LONG);
    await userEvent.click(await c.findByRole("button", { name: /Changed 2 records/ }, LONG));
    await c.findByText(/Lead · 4521/, {}, LONG);
  },
  [],
  {
    "console/agentChanges": {
      lines: [
        {
          id: "903",
          at: "2026-11-04T23:20:29Z",
          turn: "t1",
          table: "leads",
          area: "client",
          op: "update",
          row: "4521",
          change: "stage: Engaged → Booked",
          undone: false,
          keyed: true,
          records: [],
        },
        {
          id: "902",
          at: "2026-11-04T23:20:28Z",
          turn: "t1",
          table: "leads",
          area: "client",
          op: "update",
          row: "4518",
          change: "owner: empty → ann",
          undone: false,
          keyed: true,
          records: [],
        },
        {
          id: "901",
          at: "2026-11-04T23:20:27Z",
          turn: "t1",
          table: "books.spend",
          area: "money",
          op: "insert",
          row: "77",
          change: null,
          undone: true,
          keyed: true,
          records: [],
        },
      ],
    },
    "console/agentConfirms": {
      asks: [
        {
          id: "a1",
          act: "send",
          client: "wren",
          what: "Send 12 emails to the spring list",
          args: { command: "crm approve", argv: ["--all"] },
          state: "pending",
          decidedBy: null,
          decidedAt: null,
          at: "2026-11-04T23:20:30Z",
          chat: STORED,
        },
      ],
    },
  },
);

/** A chat the Mac no longer holds (404): the box reads only and says why; no Retry (WA-1173). */
export const Gone = story(
  "/research/runs?setup=weaver&chat=00000000-0000-4000-8000-0000000000ff",
  [],
  async (page) => {
    const box = await within(page).findByRole("textbox", { name: "Message" }, LONG);
    await waitFor(() => expect(box).toBeDisabled(), LONG);
    await expect(box).toHaveAttribute("placeholder", expect.stringMatching(/Start a new chat/));
    await expect(within(page).queryByRole("button", { name: "Retry" })).toBeNull();
  },
);

/** The side panel's Chats menu lists the stored chats, by folder. */
export const Panel = story("/research/runs", [], async (page) => {
  const c = within(page);
  await userEvent.click(await agentDoor(c));
  await userEvent.click(await c.findByRole("button", { name: "Chats" }, LONG));
  const menu = within(document.body);
  // a filed chat sits in its folder: Bakeries › Buyers (mocks/data/folders.ts)
  await userEvent.click(await menu.findByText(/^Bakeries/, {}, LONG));
  await userEvent.click(await menu.findByText(/^Buyers/, {}, LONG));
  await menu.findByText("Bakery buyers", {}, LONG);
});

/** On the Map, the panel opens on Orrery: the Map's product. */
export const OnMap = story("/", [], async (page) => {
  const c = within(page);
  await userEvent.click(await agentDoor(c));
  await c.findByPlaceholderText("Ask Orrery", {}, LONG);
});

/**
 * A step's output names its run (`::view research.run`): the run's card, read from weaver
 * serve, once and under the last step. These frames are written by hand in the stored shape.
 */
// weaver serve for the run cards
const CARD_SERVED = [
  http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: RESEARCH_ROWS })),
  http.get(`${SERVE}/runs/:run`, () => HttpResponse.json(RESEARCH_VIEW)),
  sse(`${SERVE}/events`, () => {}),
];

export const Card = (() => {
  const base = story(
    // Explorer's Weaver root draws no graph: the card keeps its own
    `/explorer/weaver?setup=weaver&chat=${CARDED}`,
    [],
    async (page) => {
      const c = within(page);
      const card = await c.findByRole("article", { name: /^Weaver run: / }, LONG);
      expect(within(card).getByText("How do small bakeries find wholesale buyers?")).toBeTruthy();
      expect(c.getAllByRole("article", { name: /^Weaver run: / })).toHaveLength(1);
      expect(card.querySelector(".rg")).not.toBeNull();
      await c.findByText(/The review is next/, {}, LONG);
    },
    [{ session: CARDED, at: "2026-11-05T18:00:00Z", title: "Wholesale buyers", frames: CARD }],
  );
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...CARD_SERVED, ...(base.parameters?.msw ?? [])] },
  };
})();

/**
 * Research › Runs draws the chat's runs live: the card drops its second graph (WA-1292). Tape:
 * Work's session start, then the Card chat's turns live in that session.
 */
export const CardOnLive = (() => {
  const sid = "00000000-0000-4000-8000-000000000001";
  const start = WORK.findIndex((l) => l.from === "cli" && l.frame.type === "stream_event");
  const ask = (CARD[0] as { message: unknown }).message;
  const pre = (WORK as TapeLine[])
    .slice(0, start)
    .map((l) =>
      l.from === "page" && l.frame.type === "user"
        ? { ...l, frame: { ...l.frame, message: ask } }
        : l,
    );
  const t0 = pre.at(-1)?.t ?? 0;
  const turns = (CARD as TapeLine["frame"][]).slice(1).map((frame, k) => ({
    t: t0 + 300 * (k + 1),
    from: "cli",
    frame: { ...frame, session_id: sid },
  }));
  const end = (WORK as TapeLine[]).findLast((l) => l.frame.type === "result");
  const tape = [
    ...pre,
    ...turns,
    ...(end ? [{ ...end, t: t0 + 300 * CARD.length }] : []),
  ] as TapeLine[];
  const base = story("/research/runs?setup=weaver", tape, async (page) => {
    const c = within(page);
    await say(page, typedOn(tape)[0] ?? "");
    await c.findByRole("article", { name: /^Weaver run: / }, LONG);
    const card = c.getByRole("article", { name: /^Weaver run: / });
    await within(card).findByText("Its graph is on this page.", {}, LONG);
    expect(card.querySelector(".rg")).toBeNull();
  });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...CARD_SERVED, ...(base.parameters?.msw ?? [])] },
  };
})();

/**
 * Vireo's cards (WA-1262): a closed batch with its calls, an open batch to mark, a subject's
 * tree. Each reads the page's own call from the fake server.
 */
export const VireoCards = story(
  `/research/runs?setup=weaver&chat=${VIREO}`,
  [],
  async (page) => {
    const c = within(page);
    await c.findByRole("article", { name: /^Vireo batch: Openers that name a place/ }, LONG);
    const open = await c.findByRole("article", { name: /^Vireo batch: Openers with a next step/ });
    expect(within(open).getByText(/marked$/)).toBeTruthy();
    const subject = await c.findByRole("article", { name: /^Vireo subject: Hero background/ });
    await within(subject).findByRole("group", { name: /^Generation tree of / }, LONG);
  },
  [{ session: VIREO, at: "2026-11-09T18:00:00Z", title: "Bakery openers", frames: VIREO_CHAT }],
);

/**
 * A chat after `/compact` (a real session, scrubbed): the turns before stay, a rule marks the
 * compaction, and the meter, kept from the chat's last turn, opens its menu.
 */
const Compacted0 = story(
  `/research/runs?setup=weaver&chat=${COMPACTED}`,
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
);
export const Compacted: StoryObj = {
  ...Compacted0,
  beforeEach: () => {
    const base = Compacted0.beforeEach as () => (() => void) | undefined;
    const done = base();
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
    return () => {
      localStorage.removeItem(key);
      done?.();
    };
  },
};
