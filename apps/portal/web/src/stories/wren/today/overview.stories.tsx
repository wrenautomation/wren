/** Today's board: counts, failures, phone. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { failedIn, pageAt } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Today/Overview" };
export default meta;

/** A records answer with no rows. */
const NONE = { record: "", view: null, rows: [], total: 0, counts: {}, next: null, totals: {} };

/**
 * Today: Write (a quota short on YouTube long-form and Instagram, met on LinkedIn and TikTok, X
 * on Autopilot) and Move (Ada's and Bo's lines under their journeys, the rest under Others).
 */
export const Default = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: /^Write/ })).toBeVisible();
    await expect(await view.findByRole("heading", { name: /^Move/ })).toBeVisible();
    await expect(await view.findByText("YouTube long-form")).toBeVisible();
    await expect(await view.findByText("Autopilot")).toBeVisible();
    // Met quotas fold away.
    await expect(await view.findByText(/^Met today/)).toBeVisible();
    await expect((await view.findAllByText("Prepare call")).length).toBeGreaterThan(1);
    await expect((await view.findAllByText("Nudge or drop")).length).toBe(1);
    await expect(await view.findByText("Others")).toBeVisible();
    // Parked, activity and a draft are not moves.
    await expect(view.queryByText("Kit")).toBeNull();
  },
});

export const Place = pageAt("/today", { me: ADMIN });

/** Nothing to write and nothing to move: Today says so once every read is in. */
export const Empty = pageAt("/", {
  me: ADMIN,
  answers: {
    "console/recordsList": () => NONE,
    "console/recordsCounts": (b) => ({
      totals: (Array.isArray(b.asks) ? b.asks : []).map(() => 0),
    }),
  },
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByText("Nothing waits on you.")).toBeVisible();
    await expect(await view.findByText("Nothing is due today.")).toBeVisible();
  },
});

/** Every read fails: Move says so with a retry, never "Nothing waits on you." */
export const Failed = pageAt("/", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => failedIn("Move")(page),
});

/** Only the counts fail: Move says so, and Write still draws. */
export const CountsFailed = pageAt("/", {
  me: ADMIN,
  answers: { "console/recordsCounts": refuse(500, "The counts failed, as asked.") },
  check: async (page) => {
    const today = page;
    await failedIn("Move")(today);
    await expect(await within(today).findByText("YouTube long-form")).toBeVisible();
  },
});

/** On a phone: the dock under the page carries the Move count, . */
export const Phone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("heading", { name: /^Move/ })).toBeVisible();
    },
  }),
  globals: { viewport: { value: "phone" } },
};
