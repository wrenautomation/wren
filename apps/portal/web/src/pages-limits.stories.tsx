/**
 * Daily limits on Vendors (designs/2026-10-26-limits.md), on the fake server: Wren's admin reads
 * each limit, what holds and where from, and sets one. Synthetic data only.
 * `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import type { accountsApi, LimitsView, VendorsView } from "@wren/core/accounts/console";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { serve } from "./mocks/api.js";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Account/Limits", id: "pages-limits" };
export default meta;

const SENT: Record<string, unknown>[] = [];

const LIMITS: LimitsView = {
  owner: "Wren",
  wren: true,
  money: true,
  limits: [
    {
      name: "research.google",
      unit: "Google searches a local day",
      why: "profiles, team, company events and signals together, under autobrowse's `web` cap",
      scope: "shared",
      default: { perDay: 300, burst: null },
      wren: null,
      client: null,
      holds: { perDay: 300, burst: null },
      from: "default",
    },
    {
      name: "research.triggers",
      unit: "news searches",
      why: "RSS is free; this spaces the reads",
      scope: "wren",
      default: { perDay: 400, burst: 100 },
      wren: { perDay: 800, burst: 200 },
      client: null,
      holds: { perDay: 800, burst: 200 },
      from: "wren",
    },
  ],
};

const VENDORS: VendorsView = {
  owner: { id: null, name: "Wren" },
  team: true,
  mayMoney: false,
  keyStore: true,
  reservePct: 10,
  vendors: [],
};

const limitsAt = (money: boolean, check: (page: HTMLElement) => Promise<void>) => ({
  ...pageAt("/account/vendors", {
    me: ADMIN,
    answers: serve<ReturnType<typeof accountsApi>>("accounts", {
      vendors: VENDORS,
      limits: { ...LIMITS, money },
      setLimit: (b) => {
        SENT.push(b);
        return { ok: true };
      },
    }),
    check,
  }),
});

/** Each limit as a row: what holds now and where it comes from. */
export const Limits = limitsAt(true, async (page) => {
  const c = within(page);
  await expect(await c.findByText("Daily limits")).toBeVisible();
  // `stack`: the table, and its rows again as a phone's list.
  await expect(c.getAllByText("800 a day, 200 at once").length).toBeGreaterThan(0);
  await expect(c.getAllByText("Set Wren-wide").length).toBeGreaterThan(0);
  await expect(c.getAllByText("Code default").length).toBeGreaterThan(0);
});

/** Set one: the form sends the name and the day; a row of its own offers the way back. */
export const LimitSet = limitsAt(true, async (page) => {
  const c = within(page);
  SENT.length = 0;
  const form = within(await c.findByRole("form", { name: "Change a limit" }));
  await userEvent.selectOptions(form.getByLabelText("Limit"), "research.triggers");
  await expect(form.getByRole("button", { name: "Back to the code default" })).toBeVisible();
  await userEvent.type(form.getByLabelText(/A day/), "1200");
  await userEvent.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(SENT).toHaveLength(1));
  expect(SENT[0]).toMatchObject({ name: "research.triggers", perDay: 1200, burst: null });
});

/** Not an admin: the rows show, the form does not. */
export const LimitsNoMoney = limitsAt(false, async (page) => {
  const c = within(page);
  await expect(await c.findByText("Limits are spend: an admin changes them.")).toBeVisible();
  await expect(c.queryByRole("form", { name: "Change a limit" })).toBeNull();
});
