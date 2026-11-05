/**
 * Research (WA-938): birdwatch runs read from `birdwatch serve` on this Mac. msw answers serve's
 * address with a made-up run (`./mocks/data/research.ts`). No pixel compare: render, axe.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, sse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW, RESEARCH_WEB } from "./mocks/data/research.js";
import { pageAt, tidy } from "./mocks/page.js";
import { SERVE } from "./modules/research/serve.js";

const meta: Meta = { title: "Wren/Research", id: "pages-research" };
export default meta;

/** The tree and the web load their drawing code late: a loaded Mac needs more than the 1 s default. */
const LATE = { timeout: 8000 };

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
  served = SERVED,
): StoryObj => {
  const base = pageAt(at, { me: ADMIN, check });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...(base.parameters?.msw ?? [])] },
  };
};

/** The runs down the side; the first run's tree drawn: the ask, its facets, queries and pages. */
export const Tree = tidy(
  story("/research/runs", async (page) => {
    const p = within(page);
    await p.findByRole("link", { name: /How do small bakeries find wholesale buyers/ });
    await p.findByText(/From: How do small bakeries/);
    // The frame and the flow inside it both carry the label.
    const [tree] = await p.findAllByLabelText(/^The run's tree: How do small bakeries/, {}, LATE);
    if (!tree) throw new Error("no tree");
    await waitFor(() =>
      expect(within(tree).getByText("bakery wholesale price list margin")).toBeVisible(),
    );
    await expect(within(tree).getByText("posts of youtube.com")).toBeVisible();
  }),
);

/** Every decision in order, with its why and who made it; a human's steer among them. */
export const BackAndForth = story("/research/runs?run=r1&tab=talk", async (page) => {
  const p = within(page);
  await p.findByText("a vendor page");
  await p.findByText("numbers only; skip vendor pages");
  await p.findByText("the page gives no source");
});

/** Each hit with its link to check by hand, dropped ones too. */
export const Sources = story("/research/runs?run=r1&tab=sources&hits=all", async (page) => {
  const p = within(page);
  await p.findByText("How I landed 12 cafe accounts");
  await p.findByRole("link", { name: "https://www.youtube.com/watch?v=abcdefghijk" });
  await p.findByText("Bakery software for every shop");
  await expect(
    p
      .getAllByRole("link")
      .some((a) => a.getAttribute("href")?.startsWith("https://www.reddit.com/")),
  ).toBe(true);
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
