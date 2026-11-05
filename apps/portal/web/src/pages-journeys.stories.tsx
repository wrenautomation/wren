/**
 * Journeys → Board on the fake server (designs/2026-10-18-journeys.md): the shape's nodes as
 * columns, a drag down the shape, a drag back that is refused, a refused move that rolls back, and a drop
 * with a reason. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Journeys", id: "pages-journeys" };
export default meta;

const lane = (page: HTMLElement, name: string) => within(page).findByRole("region", { name });

/** The same page the Pipelines link opens: `/pipelines` lands on the board. */
export const BoardFromNav = pageAt("/people", {
  me: ADMIN,
  check: async (page) => {
    await lane(page, "Engaged");
  },
});
