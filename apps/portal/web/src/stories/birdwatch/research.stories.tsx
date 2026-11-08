/** Birdwatch in the portal: the runs, one run's graph and back and forth, the web. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, type RequestHandler, sse, type WebSocketHandler } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import COMMANDS from "../../mocks/data/agent/commands.json";
import SETUPS from "../../mocks/data/agent/setups.json";
import { ADMIN } from "../../mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW, RESEARCH_WEB } from "../../mocks/data/research.js";
import { pageAt, tidy } from "../../mocks/page.js";
import { fakeRelay, type TapeLine } from "../../mocks/relay.js";
import { SERVE } from "../../modules/research/serve.js";

const meta: Meta = { title: "Birdwatch/Research" };
export default meta;

/** The graph and the web load their drawing code late: a loaded Mac needs more than the 1 s default. */
const LATE = { timeout: 8000 };

const DOT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#9aa"/></svg>';

const SERVED = [
  http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: RESEARCH_ROWS })),
  http.get(`${SERVE}/runs/:run`, ({ params }) =>
    params.run === RESEARCH_VIEW.run
      ? HttpResponse.json(RESEARCH_VIEW)
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
  http.get(`${SERVE}/web`, () => HttpResponse.json(RESEARCH_WEB)),
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
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...(base.parameters?.msw ?? [])] },
  };
};

/** The runs as a list: each with its ask, where it came from, and its numbers. */
export const Runs = story("/research/runs", async (page) => {
  const p = within(page);
  await p.findByRole("link", { name: /How do small bakeries find wholesale buyers/ });
  await p.findByText(/From: How do small bakeries/);
});

/** One run opens full width as its graph: the claims web, the shelf, the summary. */
export const Graph = tidy(
  story("/research/runs?run=r1", async (page) => {
    const p = within(page);
    await p.findByRole("link", { name: "All runs" });
    await waitFor(() => expect(page.querySelector(".rg .rg-nodes [data-n]")).not.toBeNull(), LATE);
    await p.findAllByText(/^Samples win cafes/, {}, LATE);
  }),
);

/** The same run as its search tree: rounds, searches, the sources each found first. */
export const GraphTree = tidy(
  story("/research/runs?run=r1&lay=tree", async (page) => {
    await waitFor(
      () => expect(page.querySelector('.rg .rg-nodes [data-n="q0"]')).not.toBeNull(),
      LATE,
    );
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
  "/research/runs",
  async (page) => {
    await within(page).findByText("Can't reach birdwatch serve");
  },
  REFUSED,
);

/** Every run on one web; a search finds a run and the side shows it, with a way into the run. */
export const WebAll = tidy(
  story("/research/web", async (page) => {
    const p = within(page);
    await p.findByRole("img", { name: /^Research web: 5 runs/ }, LATE);
    await p.findByText(/5 runs · 20 queries/);
    await userEvent.type(p.getByRole("searchbox", { name: "Find on the web" }), "croissants");
    await userEvent.click(
      await p.findByRole("button", { name: /What do cafes pay for wholesale croissants/ }),
    );
    await expect(await p.findByRole("link", { name: "Open run" })).toBeVisible();
  }),
);

/** A page picked: its video plays beside the web, its findings under it, kept or cut. */
export const WebPicked = story("/research/web?at=m1-h00", async (page) => {
  const p = within(page);
  await p.findByRole("heading", { name: "How I landed 12 cafe accounts" });
  await p.findByText("Wholesale runs at about half of retail.");
  await p.findByRole("button", { name: "How do small bakeries find wholesale buyers?" });
});

/** ⌘J opens the chat beside the page; its head names the product whose agent answers. */
export const Chat = tidy(
  story(
    "/research/runs",
    async (page) => {
      await within(page).findByRole("link", {
        name: /How do small bakeries find wholesale buyers/,
      });
      await userEvent.keyboard("{Control>}j{/Control}");
      const chat = await within(page).findByRole("complementary", { name: "Agent" });
      await within(chat).findByText("Birdwatch", {}, LATE);
      // the page's own head carries the same name
      expect(within(page).getAllByText("Birdwatch").length).toBeGreaterThan(1);
      // a new chat has the `/` menu before its first turn: the relay keeps the last list
      await userEvent.type(within(chat).getByRole("textbox", { name: "Message" }), "/");
      await within(chat).findByRole("listbox", { name: "Commands" }, LATE);
    },
    [...SERVED, ...fakeRelay({ tape: [], library: [COMMANDS as TapeLine[]], setups: SETUPS })],
  ),
);
