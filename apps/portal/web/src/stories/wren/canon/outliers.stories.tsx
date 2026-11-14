/**
 * Canon › Outliers: the gallery's state rows (studio-suite D8). The feed's rows are Studio ›
 * Inspiration's (`stories/wren/studio/`). Fake server: `web/src/mocks/`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { canonAddAnswers } from "../../../mocks/data/canon.js";
import { ADMIN } from "../../../mocks/data/me.js";
import {
  OUTLIERS,
  OUTLIERS_NONE_SCORED,
  OUTLIERS_NONE_TRACKED,
} from "../../../mocks/data/outliers.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Canon/Outliers" };
export default meta;

const WAIT = { timeout: 5000 };
/** a save files each pick in turn: slower under a full test run */
const SAVE = { timeout: 10_000 };

/** Select on, then pick the first `n` posts that take a pick. */
async function pick(page: HTMLElement, n: number) {
  const view = within(page);
  await userEvent.click(await view.findByRole("button", { name: "Select" }, WAIT));
  const boxes = await view.findAllByRole("button", { name: /^Pick / }, WAIT);
  for (const b of boxes.slice(0, n)) await userEvent.click(b);
  await expect(await view.findByText(`${n} picked`, {}, WAIT)).toBeVisible();
  return view;
}

/** Typical: a grid, best multiple first; 10x+ washed; a text post fills its frame; In Canon. */
export const Outliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("312x", {}, WAIT)).toBeVisible();
      await expect(view.getByText(/We stopped sending weekly reports/)).toBeVisible();
      await expect(view.getByText("In Canon")).toBeVisible();
      await expect(view.getByRole("link", { name: "All outliers" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  }),
);

/** The picture link expired: its words stand in. */
export const PictureFails = tidy(
  pageAt("/canon/outliers?platform=instagram", {
    me: ADMIN,
    check: async (page) => {
      await expect(await within(page).findByText(/編集のコツ/, {}, WAIT)).toBeVisible();
    },
  }),
);

/** The loading skeleton: the read never answers. */
export const Loading = pageAt("/canon/outliers", { me: ADMIN, mode: "pending" });

/** The read failed: the error and Retry; the bar stays. */
export const Failed = pageAt("/canon/outliers", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("alert", {}, WAIT)).toBeVisible();
    await expect(view.getByRole("button", { name: "Select" })).toBeVisible();
  },
});

/** Nobody tracked: the CLI line that fills it. */
export const NoneTracked = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS_NONE_TRACKED },
    check: async (page) => {
      await expect(
        await within(page).findByText("No creators tracked yet", {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/** Tracked, nothing scored yet. */
export const NoneScored = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS_NONE_SCORED },
    check: async (page) => {
      await expect(await within(page).findByText("7 creators tracked", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Scored, none over the usual draw, no filter on. */
export const NoOutliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": { ...OUTLIERS, rows: [] } },
    check: async (page) => {
      await expect(await within(page).findByText("No outliers yet", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Filters in force: a pill each, then nothing fits: Clear filters. */
export const NoMatch = tidy(
  pageAt("/canon/outliers?creator=1,5&kind=short", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("No post fits these filters", {}, WAIT)).toBeVisible();
      await expect(view.getByText("Maya Cuts, Agents Daily")).toBeVisible();
      await expect(view.getByRole("link", { name: "Clear filters" })).toBeVisible();
    },
  }),
);

/** Filter open on Creator: each tracked creator, with post counts. */
export const FilterOpen = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: /Filter/ }, WAIT));
      const pop = within(document.body);
      await userEvent.click(await pop.findByRole("option", { name: /Creator/ }, WAIT));
      await expect(await pop.findByRole("listbox", { name: "Creator" }, WAIT)).toBeVisible();
    },
  }),
);

/** Select on, two picked: boxes on the tiles, the bar at the foot. */
export const Selecting = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      await pick(page, 2);
    },
  }),
);

/** All filed: select ends, each says it is filing. */
export const Saved = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = await pick(page, 2);
      await userEvent.click(view.getByRole("button", { name: "Save to Canon" }));
      await waitFor(() => expect(view.getAllByText("Filing into Canon")).toHaveLength(2), SAVE);
      await expect(view.queryByText(/picked/)).toBeNull();
    },
  }),
);

/** One refused: the rest file, the refused one stays picked with the reason. */
export const SavePartFailed = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: {
      ...canonAddAnswers([]),
      "canon/add": (b: Record<string, unknown>) =>
        String(b.what).includes("FakeVid0002")
          ? refuse(403, "sign in to add to Canon")
          : {
              id: 1,
              what: String(b.what),
              fileName: null,
              note: null,
              person: "william",
              state: "pending",
              error: null,
              records: [],
              at: new Date().toISOString(),
            },
    },
    check: async (page) => {
      const view = await pick(page, 2);
      await userEvent.click(view.getByRole("button", { name: "Save to Canon" }));
      await expect(await view.findByRole("alert", {}, SAVE)).toHaveTextContent(
        /1 saved\. 1 not saved: sign in/,
      );
      await expect(view.getByText("1 picked")).toBeVisible();
    },
  }),
);

/**
 * Save pressed, the add never answers: Save stays busy. Last in the file: its write stays in the
 * write queue and would hold the saves of any story after it.
 */
export const Saving = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/add": () => new Promise<never>(() => {}) },
    check: async (page) => {
      const view = await pick(page, 2);
      const save = view.getByRole("button", { name: "Save to Canon" });
      await userEvent.click(save);
      await waitFor(() => expect(save).toBeDisabled(), WAIT);
    },
  }),
);
