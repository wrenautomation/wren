/** The sidebar and the phone dock. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Shell/Sidebar" };
export default meta;

/** Under 900px the sidebar is gone and the bottom tabs take over (`packages/ui/src/shell.tsx`). */
const onPhone = () => matchMedia("(max-width: 900px)").matches;

/** A name that starts a label, past a count badge ("1 Engage"). */
const named = (name: string) => new RegExp(`^(\\d+ )?${name}`);

/** How many links in `scope` carry this name: a page can show under its app too. */
const links = (scope: ReturnType<typeof within>, name: string) =>
  scope.queryAllByRole("link", { name: named(name) }).length;

/**
 * The sidebar at home: Wren's places (designs/2026-11-04-portal-places.md). Old app names are gone
 * from it; their pages sit under a place. A phone has no sidebar, so PhoneDock checks its tabs.
 */
export const Items = pageAt("/", {
  empty: false,
  me: ADMIN,
  check: async (page) => {
    if (onPhone()) return;
    const nav = within(await within(page).findByRole("navigation", { name: "Apps" }));
    for (const name of ["Map", "Today", "Campaigns", "Research", "People", "Back office"])
      expect(links(nav, name), `${name} is in the sidebar`).toBeGreaterThan(0);
    for (const name of ["Pipelines", "Outbound", "Ads", "Analytics", "Notes"])
      expect(links(nav, name), `${name} is gone`).toBe(0);
  },
});

/** A phone's bottom tabs at home: the Map, the four docked places, then Apps. */
export const PhoneDock = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (!onPhone()) return;
    const dock = within(await within(page).findByRole("navigation", { name: "Tabs" }));
    for (const name of ["Map", "Today", "Campaigns", "Research", "People"])
      expect(links(dock, name), `${name} is a tab`).toBe(1);
    await expect(dock.getByRole("button", { name: named("Apps") })).toBeVisible();
  },
});
