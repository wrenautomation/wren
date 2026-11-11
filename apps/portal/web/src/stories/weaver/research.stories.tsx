/** Weaver in the portal, Research › Runs: the chat, Live, History, one run's graph and back and forth, runs together. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, type RequestHandler, sse, type WebSocketHandler } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "../../mocks/api.js";
import COMMANDS from "../../mocks/data/agent/commands.json";
import SETUPS from "../../mocks/data/agent/setups.json";
import { resetFolders } from "../../mocks/data/folders.js";
import { ADMIN } from "../../mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { pageAt, tidy } from "../../mocks/page.js";
import { fakeRelay, type TapeLine } from "../../mocks/relay.js";
import { SERVE } from "../../modules/research/serve.js";

const meta: Meta = { title: "Weaver/Research" };
export default meta;

/** The graph loads its drawing code late: a loaded Mac needs more than the 1 s default. */
const LATE = { timeout: 8000 };

const DOT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#9aa"/></svg>';

const SERVED = [
  http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: RESEARCH_ROWS })),
  // every listed run reads as the one fixture view: two runs together share all their sources
  http.get(`${SERVE}/runs/:run`, ({ params }) =>
    RESEARCH_ROWS.some((r) => r.run === params.run)
      ? HttpResponse.json({ ...RESEARCH_VIEW, run: params.run })
      : HttpResponse.json({ error: "no records" }, { status: 404 }),
  ),
  http.get(`${SERVE}/runs/:run/documents/:doc`, ({ params }) =>
    HttpResponse.json({
      id: params.doc,
      url: "https://bakers.example/wholesale-guide",
      title: "A wholesale guide for small bakers",
      media: "text",
      text: "Start with three cafes inside a short drive.",
    }),
  ),
  // the graph's icons and video stills: offline, one tinted square
  ...["https://icons.duckduckgo.com/*", "https://i.ytimg.com/*"].map((u) =>
    http.get(u, () => new HttpResponse(DOT, { headers: { "content-type": "image/svg+xml" } })),
  ),
  // Open and quiet: a story sends no change.
  sse(`${SERVE}/events`, () => {}),
];

const REFUSED = [
  http.get(`${SERVE}/*`, () => HttpResponse.error()),
  sse(`${SERVE}/events`, ({ client }) => client.error()),
];

const story = (
  at: string,
  check: (page: HTMLElement) => Promise<void>,
  served: readonly (RequestHandler | WebSocketHandler)[] = SERVED,
): StoryObj => {
  const base = pageAt(at, { me: ADMIN, check });
  // the side panel's chat: a quiet relay with the setups and the last `/` list
  const relay = fakeRelay({ tape: [], library: [COMMANDS as TapeLine[]], setups: SETUPS });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...relay, ...(base.parameters?.msw ?? [])] },
  };
};

const folderStory = (check: (page: HTMLElement) => Promise<void>): StoryObj => ({
  ...story("/research/runs?view=history", check),
  beforeEach: () => {
    resetFolders();
    freshStory();
  },
});

/** The runs as a list: folders first (Bakeries holds a run), then the runs in no folder. */
export const History = folderStory(async (page) => {
  const p = within(page);
  await p.findByRole("button", { name: /^Bakeries/ }, LATE);
  await expect(p.getByRole("heading", { name: "No folder" })).toBeTruthy();
  await p.findByRole("link", { name: /How do small bakeries find wholesale buyers/ });
});

/** A folder opened: its run shows in it, with where it came from and its numbers. */
export const HistoryFolderOpen = folderStory(async (page) => {
  const p = within(page);
  await userEvent.click(await p.findByRole("button", { name: /^Bakeries/ }, LATE));
  await p.findByRole("link", { name: /Which cafes buy pastries/ });
  await p.findByText(/From: How do small bakeries/);
});

/** One run opens full width as its graph: the claims web, the shelf, the summary. */
export const Graph = tidy(
  story("/research/runs?run=r1", async (page) => {
    const p = within(page);
    await p.findByRole("link", { name: "All runs" });
    await waitFor(() => expect(page.querySelector(".rg .rg-nodes [data-n]")).not.toBeNull(), LATE);
    // the list opens on Searches
    await p.findAllByText(/^bakery wholesale accounts first buyer/, {}, LATE);
  }),
);

/** Every decision in order, with its why and who made it; a human's steer among them. */
export const BackAndForth = story("/research/runs?run=r1&tab=talk", async (page) => {
  const p = within(page);
  await p.findByText("a vendor page");
  await p.findByText("numbers only; skip vendor pages");
  await p.findByText("the page gives no source");
});

/** serve is not running: the page says how to start it, never an empty list. */
export const NoServe = story(
  "/research/runs?view=history",
  async (page) => {
    await within(page).findByText("Can't reach weaver serve");
  },
  REFUSED,
);

/** Picked runs, or all of them, on one graph: a source both read is one node. */
export const AllRuns = tidy(
  story("/research/runs?run=all", async (page) => {
    const p = within(page);
    await p.findByRole("link", { name: "All runs" });
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
