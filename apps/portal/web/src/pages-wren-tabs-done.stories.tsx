/**
 * The tabs of Wren's apps that follow an artifact, as Wren's admin sees them, on the fake server:
 * Studio (Studio and Marketing artifact), then the sidebar's areas and a phone's dock (Design
 * Language). Same story ids as before the split (`pages-wren-apps--<app>-<tab>`).
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "./mocks/data/index.js";
import { ADMIN } from "./mocks/data/me.js";
import { studioAnswers } from "./mocks/data/studio.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Done/Wren apps", id: "pages-wren-apps" };
export default meta;

// Content's Plan: what the week still asks for.
export const ContentPlan = pageAt("/content/plan", { me: ADMIN });

// Studio: the desk (due cards, New, the waiting table), then compose with a line and a kind chosen.
// The shape has two sample lines; a phone shows the same page narrower (the story tests run at 390).
const STUDIO = studioAnswers({
  get: ANSWERS["pipeline/recordsGet"] as (b: Record<string, unknown>) => unknown,
  list: ANSWERS["pipeline/recordsList"] as (b: Record<string, unknown>) => unknown,
});
export const ContentStudio = pageAt("/content/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: /still due this week/i })).toBeVisible();
    // The drafts: a table wide, a list on a phone; both carry the label.
    await expect(await view.findByLabelText("drafts", {}, { timeout: 5000 })).toBeVisible();
  },
});
/** A row's check approves in place: the row goes aside and the toast offers Undo. */
export const ContentStudioApprove = pageAt("/content/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    const row = "Behind the scenes: rebuilding the offer page";
    await userEvent.click(await view.findByRole("button", { name: `Approve ${row}` }));
    await waitFor(() => expect(view.queryByText(row)).toBeNull());
    await expect(await within(document.body).findByRole("button", { name: /undo/i })).toBeVisible();
  },
});
/** A draft's title opens its platforms side by side in a sheet. */
export const ContentStudioOpen = pageAt("/content/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    // Not the draft the Approve story sets aside: its hold outlives that story.
    const title = "Most service sites list seven things they do.";
    await userEvent.click(await view.findByRole("button", { name: title }, { timeout: 5000 }));
    await expect(await within(document.body).findByRole("dialog")).toBeVisible();
  },
});
/** Compose filled in: the sample post, a line and an angle picked, so each platform shows its version. */
const SAMPLE_POST = [
  "Most service sites list seven things they do.",
  "The ones that book calls list one.",
  "Last month I rebuilt an offer page down to a single line: who it is for, what changes in 30 days, the price. Three fewer sections.",
].join("\n\n");
export const ContentStudioCompose = pageAt(
  `/content/studio?make=post&idea=${encodeURIComponent(SAMPLE_POST)}`,
  {
    me: ADMIN,
    answers: STUDIO,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: /offer builder/i }));
      await userEvent.click(await view.findByRole("button", { name: "Proof" }));
      await expect(await view.findByRole("button", { name: /approve and slot/i })).toBeEnabled();
      // The picked chip drops its focus ring: a shot of this story shows the page at rest.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    },
  },
);
/** Under 900px the sidebar is gone and the bottom tabs take over (`packages/ui/src/shell.tsx`). */
const onPhone = () => matchMedia("(max-width: 900px)").matches;
/** A name that starts a label, past a count badge ("1 Engage"). */
const named = (name: string) => new RegExp(`^(\\d+ )?${name}`);
/** How many links in `scope` carry this name: a page can show under its app too. */
const links = (scope: ReturnType<typeof within>, name: string) =>
  scope.queryAllByRole("link", { name: named(name) }).length;

/**
 * The sidebar at home: the Map, then Inbox, People, Money and Admin, then every other app under its
 * area, Marketing open (designs/2026-10-23-focus-view.md, F3). Parked apps keep their routes and
 * their place in ⌘K, not in the sidebar. A phone has no sidebar, so the look at phone width checks
 * the bottom tabs in PhoneDock instead.
 */
export const SidebarItems = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (onPhone()) return;
    const nav = within(await within(page).findByRole("navigation", { name: "Apps" }));
    for (const name of ["Inbox", "People", "Money", "Admin"])
      expect(links(nav, name), `${name} is in the sidebar`).toBeGreaterThan(0);
    for (const name of ["Pipelines", "Content", "Engage", "Outbound", "Ads", "Analytics"])
      expect(links(nav, name), `${name} is in the sidebar`).toBeGreaterThan(0);
    for (const name of ["Notes", "Learn", "Voice"])
      expect(links(nav, name), `${name} is parked`).toBe(0);
    await expect(within(page).getAllByRole("link", { name: named("Map") }).length).toBeGreaterThan(
      0,
    );
  },
});

/** A phone's bottom tabs at home: the Map, Inbox, People, then Apps. */
export const PhoneDock = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (!onPhone()) return;
    const dock = within(await within(page).findByRole("navigation", { name: "Tabs" }));
    for (const name of ["Map", "Inbox", "People"])
      expect(links(dock, name), `${name} is a tab`).toBe(1);
    await expect(dock.getByRole("button", { name: named("Apps") })).toBeVisible();
  },
});
