/** Explorer › Weaver: the runs on this Mac as one tree, read beside `weaver serve`. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RequestHandler, WebSocketHandler } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";
import { REFUSED, SERVED } from "../../../mocks/weaver-serve.js";
import { explorerHref } from "../../../modules/explorer/href.js";
import { relation, WAIT } from "./explorer-kit.js";

const meta: Meta = { title: "Wren/Explorer/Weaver" };
export default meta;

const at = (route: string, view?: "map") => explorerHref(route, view);
const line = (page: HTMLElement, from: string, to: string) =>
  page.querySelector(`[data-line="${from}>${to}"]`);

/** A page reading `weaver serve`, which Empty mode leaves full. */
const story = (
  route: string,
  check: (page: HTMLElement) => Promise<void>,
  served: readonly (RequestHandler | WebSocketHandler)[] = SERVED,
): StoryObj => {
  const base = pageAt(route, { me: ADMIN, check, empty: false });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...served, ...(base.parameters?.msw ?? [])] },
  };
};

/** The root: every run, newest first. */
export const Default = tidy(
  story("/explorer/weaver", async (page) => {
    const view = within(page);
    await expect(
      await view.findByRole("link", { name: /How do small bakeries find wholesale buyers/ }, WAIT),
    ).toHaveAttribute("href", at("weaver/r1"));
  }),
);

/** A run: its pages and queries in the column; its counts in the preview. */
export const Run = tidy(
  story(at("weaver/r1"), async (page) => {
    const view = within(page);
    await expect(await view.findByText("3 queries", {}, WAIT)).toBeVisible();
    await expect(view.getByRole("link", { name: "Open in Research" })).toHaveAttribute(
      "href",
      "/research/runs?run=r1",
    );
  }),
);

/** A page it read: its source and text in the preview; its findings are its rows. */
export const ReadPage = tidy(
  story(at("weaver/r1/pages/d1"), async (page) => {
    const view = within(page);
    const source = await view.findByRole("link", { name: "Open the video" }, WAIT);
    await waitFor(() => expect(source).toBeVisible(), WAIT);
    await expect(source.getAttribute("href")).toContain("youtube.com");
    // once: the row, not the preview again
    await expect(
      view.getAllByRole("link", { name: /She won 12 cafe accounts in a year/ }),
    ).toHaveLength(1);
    await relation(view, "Hit by", "weaver/r1/pages/d1/hit-by");
  }),
);

/** A query: why the agent ran it; the pages it hit are its rows. */
export const Query = tidy(
  story(at("weaver/r1/queries/q1"), async (page) => {
    const view = within(page);
    await expect(await view.findByText("the ask's words", {}, WAIT)).toBeVisible();
    const open = view.getByRole("link", { name: "Open in Research" });
    await expect(decodeURIComponent(open.getAttribute("href") ?? "")).toContain("open=q:q1");
  }),
);

/** The root as a map: runs stay closed (one view each is too dear); one round grew into the next. */
export const MapRoot = tidy(
  story(at("weaver", "map"), async (page) => {
    await waitFor(() => expect(line(page, "weaver/r1", "weaver/r2")).not.toBeNull(), {
      timeout: 10_000,
    });
    await expect(page.querySelector('[data-map="b:weaver/r1"]')?.hasAttribute("data-open")).toBe(
      false,
    );
  }),
);

/** A run's queries in Map: its run opens; which queries hit which pages is one line. */
export const MapRun = tidy(
  story(at("weaver/r1/queries", "map"), async (page) => {
    await waitFor(() => expect(line(page, "weaver/r1/queries", "weaver/r1/pages")).not.toBeNull(), {
      timeout: 10_000,
    });
    await expect(
      page.querySelector('[data-map="b:weaver/r1/queries"]')?.hasAttribute("data-picked"),
    ).toBe(true);
    // a picked folder lists its rows beside the map; each stays in Map
    const rows = within(page).getByRole("region", { name: "Queries" });
    await expect(within(rows).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      at("weaver/r1/queries/q1", "map"),
    );
  }),
);

/** serve is not running: the tree says how to start it, never an empty list. */
export const Offline = story(
  "/explorer/weaver",
  async (page) => {
    await expect(await within(page).findByText(/weaver serve/, {}, WAIT)).toBeVisible();
  },
  REFUSED,
);
