/**
 * The Wren pages that draw their lists with `Rows` (designs/2026-10-21-crm-rows-everywhere.md,
 * batch B3), on the fake server: the home's client health and the company dossier. Settings has its own stories in
 * `pages-wren.stories.tsx`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { ANSWERS } from "./mocks/data/index.js";
import { ADMIN } from "./mocks/data/me.js";
import { FLAG_ROWS, HEALTH_ROWS, rowsOf } from "./mocks/data/wren-rows.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Wren rows", id: "pages-wren-rows" };
export default meta;

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
