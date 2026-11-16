/** Weaver in the portal: Research › Runs (the chat, Live), and a run opened whole in Explorer › Weaver (its graph, back and forth, runs together). Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, type RequestHandler, type WebSocketHandler } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import COMMANDS from "../../mocks/data/agent/commands.json";
import SETUPS from "../../mocks/data/agent/setups.json";
import { ADMIN } from "../../mocks/data/me.js";
import { RESEARCH_VIEW } from "../../mocks/data/research.js";
import { BOARD_VIEW } from "../../mocks/data/research-board.js";
import { pageAt, tidy } from "../../mocks/page.js";
import { fakeRelay, type TapeLine } from "../../mocks/relay.js";
import { REFUSED, SERVED } from "../../mocks/weaver-serve.js";
import { wholeHref } from "../../modules/explorer/href.js";
import { SERVE } from "../../modules/research/serve.js";

const meta: Meta = { title: "Weaver/Research" };
export default meta;

/** The graph loads its drawing code late: a loaded Mac needs more than the 1 s default. */
const LATE = { timeout: 8000 };

const story = (
  at: string,
  check: (page: HTMLElement) => Promise<void>,
  served: readonly (RequestHandler | WebSocketHandler)[] = SERVED,
): StoryObj => {
  // runs come from weaver serve (`served`), which Empty mode leaves full
  const readsServe = served.length > 0;
  const base = pageAt(at, { me: ADMIN, check, ...(readsServe ? { empty: false as const } : {}) });
  // the side panel's chat: a quiet relay with the setups and the last `/` list
  const relay = fakeRelay({ tape: [], library: [COMMANDS as TapeLine[]], setups: SETUPS });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...relay, ...(base.parameters?.msw ?? [])] },
  };
};

/** One run's graph tab: picks wear their rank; the claims web, the shelf, the summary. */
export const Graph = tidy(
  story(wholeHref("weaver/r1", { tab: "graph" }), async (page) => {
    const p = within(page);
    await p.findByRole("button", { name: "Explorer" }, LATE);
    await waitFor(() => expect(page.querySelector(".rg .rg-nodes [data-n]")).not.toBeNull(), LATE);
    // the list opens on Searches
    await p.findAllByText(/^bakery wholesale accounts first buyer/, {}, LATE);
  }),
);

/** Every decision in order, with its why and who made it; a human's steer among them. */
export const BackAndForth = story(wholeHref("weaver/r1", { tab: "talk" }), async (page) => {
  const p = within(page);
  await p.findByText("a vendor page");
  await p.findByText("numbers only; skip vendor pages");
  await p.findByText("the page gives no source");
});

/** A run with picks opens on its references: a gallery, best first. */
export const References = story(wholeHref("weaver/r1"), async (page) => {
  const p = within(page);
  await p.findByRole("list", { name: "References" });
  await p.findByText("Copy: the walk-in with samples, then the first order's numbers.");
});

/** A tile opens the post whole: why it stands out, why it's a reference, its findings. */
export const ReferenceOpen = story(wholeHref("weaver/r1"), async (page) => {
  const p = within(page);
  await userEvent.click(
    await p.findByRole("link", { name: "Open Maya Baker's video: How I landed 12 cafe accounts" }),
  );
  // the sheet sits in the body's top layer
  const sheet = within(await within(document.body).findByRole("dialog", {}, LATE));
  await sheet.findByText("Why it's a reference (rank 1)");
  await sheet.findByText("Show the stored copy");
});

/** An X pick opened from the address: its words whole, X's player behind Play, no findings yet. */
export const ReferenceX = story(wholeHref("weaver/r1", { open: "d:d4" }), async () => {
  const sheet = within(await within(document.body).findByRole("dialog", {}, LATE));
  await sheet.findByRole("button", { name: "Play Video by crumbandco" });
  await sheet.findByText("Findings (0 kept of 0)");
  await sheet.findByText("No findings on this page.");
});

/** No picks yet: the page says who fills it. Run r2: the page keeps r1's view across stories. */
export const ReferencesEmpty = story(
  wholeHref("weaver/r2", { tab: "refs" }),
  async (page) => {
    await within(page).findByText("No references yet", {}, LATE);
  },
  [
    http.get(`${SERVE}/runs/r2`, () =>
      HttpResponse.json({
        ...RESEARCH_VIEW,
        run: "r2",
        brief: { ...RESEARCH_VIEW.brief, readList: [] },
      }),
    ),
    ...SERVED,
  ],
);

/** Worst case: 180 pages over 30 channels, 12 picks, 5 patterns, posters missing on some. */
export const Board = story(
  wholeHref("weaver/rb"),
  async (page) => {
    const p = within(page);
    await p.findByRole("list", { name: "Pages read" }, LATE);
    await p.findByText("Walk in with samples; the first order comes on the spot.");
    await p.findByRole("button", { name: "Show all 168" });
  },
  [http.get(`${SERVE}/runs/rb`, () => HttpResponse.json({ ...BOARD_VIEW, run: "rb" })), ...SERVED],
);

/** serve is not running: the page says how to start it, never an empty list. */
export const NoServe = story(
  wholeHref("weaver/r1"),
  async (page) => {
    await within(page).findByText("Can't reach weaver serve");
  },
  REFUSED,
);

/** Picked runs, or all of them, on one graph: a source both read is one node. */
export const AllRuns = tidy(
  story(wholeHref("weaver"), async (page) => {
    const p = within(page);
    await p.findByRole("button", { name: "Explorer" }, LATE);
    await waitFor(() => expect(page.querySelector(".rg .rg-nodes [data-n]")).not.toBeNull(), LATE);
    await p.findAllByText("All runs", {}, LATE);
  }),
);

/** No chat and no run going: Live draws the newest run. */
export const Live = tidy(
  story("/research/runs", async (page) => {
    await within(page).findByText("The newest run");
    await waitFor(() => expect(page.querySelector(".rg .rg-nodes [data-n]")).not.toBeNull(), LATE);
  }),
);

/** The chat is the side panel over the run; a new chat has the `/` menu before its first turn. */
export const Chat = tidy(
  story("/research/runs", async (page) => {
    const p = within(page);
    await userEvent.click(
      (await p.findAllByRole("button", { name: "Agent" }, LATE))[0] as HTMLElement,
    );
    const panel = await p.findByRole("complementary", { name: "Agent" }, LATE);
    await userEvent.type(await within(panel).findByRole("textbox", { name: "Message" }, LATE), "/");
    await within(panel).findByRole("listbox", { name: "Commands" }, LATE);
  }),
);
