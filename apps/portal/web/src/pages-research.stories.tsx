/**
 * Research (WA-938): birdwatch runs read from `weaver serve` on this Mac. msw answers serve's
 * address with a made-up run (`./mocks/data/research.ts`). No pixel compare: render, axe.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http, sse } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "./mocks/data/research.js";
import { pageAt } from "./mocks/page.js";
import { SERVE } from "./modules/research/serve.js";

const meta: Meta = { title: "Revamp/Research", id: "pages-research" };
export default meta;

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
export const Tree = story("/research/runs", async (page) => {
  const p = within(page);
  await p.findByRole("link", { name: /How do small bakeries find wholesale buyers/ });
  await p.findByText(/From: How do small bakeries/);
  // The frame and the flow inside it both carry the label.
  const [tree] = await p.findAllByLabelText(/^The run's tree: How do small bakeries/);
  if (!tree) throw new Error("no tree");
  await waitFor(() =>
    expect(within(tree).getByText("bakery wholesale price list margin")).toBeVisible(),
  );
  await expect(within(tree).getByText("posts of youtube.com")).toBeVisible();
});

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
    await within(page).findByText("Can't reach weaver serve");
  },
  REFUSED,
);
