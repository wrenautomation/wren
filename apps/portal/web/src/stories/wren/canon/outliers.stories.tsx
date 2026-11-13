/** Canon › Outliers: every state row of designs/2026-11-12-eden-method.md §4. Fake server: `web/src/mocks/`. */
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

/** Typical: best multiple first, a long title whole, a row with no title, date or followers; Save files it. */
export const Outliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("312x", {}, WAIT)).toBeVisible();
      await expect(view.getByText(/a 40-minute teardown of twelve channels$/)).toBeVisible();
      await expect(view.getByText(/編集のコツ/)).toBeVisible();
      await expect(view.getByText("In Canon")).toBeVisible();
      const [save] = view.getAllByRole("button", { name: "Save to Canon" });
      if (!save) throw new Error("no Save button");
      await userEvent.click(save);
      const filing = await view.findByText("Filing into Canon", {}, WAIT);
      await waitFor(() => expect(filing).toBeVisible(), WAIT); // after its fade-in
    },
  }),
);

/** The loading skeleton: the read never answers. */
export const Loading = pageAt("/canon/outliers", { me: ADMIN, mode: "pending" });

/** The read failed: the error and Retry. */
export const Failed = pageAt("/canon/outliers", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
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

/** Save pressed, the add never answers: the button stays busy and off. */
export const Saving = tidy(
  pageAt("/canon/outliers?platform=instagram", {
    me: ADMIN,
    answers: { "canon/add": () => new Promise<never>(() => {}) },
    check: async (page) => {
      const view = within(page);
      const [save] = await view.findAllByRole("button", { name: "Save to Canon" }, WAIT);
      if (!save) throw new Error("no Save button");
      await userEvent.click(save);
      await expect(save).toBeDisabled();
    },
  }),
);

/** A filter nothing clears: Clear filters. */
export const NoMatch = tidy(
  pageAt("/canon/outliers?kind=short", {
    me: ADMIN,
    check: async (page) => {
      await expect(
        await within(page).findByText("No post clears these filters.", {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/** Save refused: the reason under the row, Save back. */
export const SaveFailed = tidy(
  pageAt("/canon/outliers?platform=youtube", {
    me: ADMIN,
    answers: { "canon/add": () => refuse(403, "sign in to add to Canon") },
    check: async (page) => {
      const view = within(page);
      const [save] = await view.findAllByRole("button", { name: "Save to Canon" }, WAIT);
      if (!save) throw new Error("no Save button");
      await userEvent.click(save);
      await expect(await view.findByRole("alert", {}, WAIT)).toHaveTextContent(/sign in/);
      await expect(view.getAllByRole("button", { name: "Save to Canon" }).length).toBeGreaterThan(
        0,
      );
    },
  }),
);
