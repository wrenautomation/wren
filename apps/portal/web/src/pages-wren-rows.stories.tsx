/**
 * The Wren pages that draw their lists with `Rows` (designs/2026-10-21-crm-rows-everywhere.md,
 * batch B3), on the fake server: the home's client health, the company dossier and a split's
 * ended pages (Retire). Settings has its own stories in
 * `pages-wren.stories.tsx`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { freshStory } from "./mocks/api.js";
import { ANSWERS } from "./mocks/data/index.js";
import { ADMIN } from "./mocks/data/me.js";
import { detailOf, ENDED_SPLIT, FLAG_ROWS, HEALTH_ROWS, rowsOf } from "./mocks/data/wren-rows.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Wren rows", id: "pages-wren-rows" };
export default meta;

type Reply = (body: Record<string, unknown>) => unknown;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Wren's home: clients at risk and urgent flags, one list. */
export const HealthAtRisk = pageAt("/", {
  me: ADMIN,
  answers: rowsOf(ANSWERS, "console", {
    "console.health": { rows: HEALTH_ROWS },
    "console.flag": { rows: FLAG_ROWS },
  }),
  check: async (page) => {
    // Client health sits on Wren's home, under the map.
    const view = within(page);
    const rows = await view.findByLabelText("Client health");
    // The sheet slides in: wait for it to settle before the visible checks.
    await waitFor(async () => {
      await expect(within(rows).getByText("Acme Plumbing")).toBeVisible();
      await expect(within(rows).getByText("Sender domain flagged")).toBeVisible();
      await expect(within(rows).getByText("Urgent")).toBeVisible();
    });
  },
});

// A split that ended: Retire asks once and the row waits.
const RETIRES: Record<string, unknown>[] = [];
// A client's page: Wren's own page detail also draws a Notes section twice (its key clashes).
const retire = (check: (page: HTMLElement) => Promise<void>) => ({
  ...pageAt("/campaigns/pages/1", {
    answers: {
      ...detailOf(ANSWERS, "sites.page", ENDED_SPLIT),
      "sites/retireAsk": ((b) => {
        RETIRES.push({ id: b.id });
        return { ok: true };
      }) as Reply,
    },
    check,
  }),
  beforeEach: () => {
    RETIRES.length = 0;
    freshStory();
  },
});

/** The ended split's other pages as rows; a live one has Retire, a retired or waiting one has none. */
export const SplitEnded = retire(async (page) => {
  const view = within(page);
  const rows = await view.findByLabelText("Other versions");
  await expect(within(rows).getByText("Roof check, short")).toBeVisible();
  await expect(within(rows).getByText("Retired")).toBeVisible();
  await expect(within(rows).getByText("Waiting to retire")).toBeVisible();
  await expect(within(rows).getAllByRole("button", { name: /^Retire / })).toHaveLength(2);
});

/** Retire asks once, even when pressed twice, and says what happens next. */
export const SplitRetire = retire(async (page) => {
  const view = within(page);
  const b = await view.findByRole("button", { name: "Retire B" });
  fireEvent.click(b);
  fireEvent.click(b);
  await waitFor(() => expect(RETIRES).toEqual([{ id: "p2" }]));
  await expect(await view.findByText(/Asked\. B comes down/)).toBeVisible();
});

/** Two Retire buttons pressed together run one ask: the page does one thing at a time. */
export const SplitRetireTwo = retire(async (page) => {
  const view = within(page);
  const b = await view.findByRole("button", { name: "Retire B" });
  const c = await view.findByRole("button", { name: "Retire C" });
  fireEvent.click(b);
  fireEvent.click(c);
  await waitFor(() => expect(RETIRES).toHaveLength(1));
  await wait(300);
  expect(RETIRES).toEqual([{ id: "p2" }]);
});
