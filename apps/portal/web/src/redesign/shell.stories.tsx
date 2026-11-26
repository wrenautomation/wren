/**
 * Redesign › Shell: Wren's own workspace in v116's shape (designs/2026-11-26-redesign.md D2): the
 * bar on top, its places as pills, the rest under More, in the raycast look. Fake server: `mocks/`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ADMIN, OWNER } from "../mocks/data/me.js";
import { pageAt } from "../mocks/page.js";

const meta: Meta = { title: "Shell", globals: { look: "raycast" } };
export default meta;

/** His prefs as the drafts set them: the bar on top, Raycast light. */
const PREFS = { "console/prefs": () => ({ display: { sidebar: "top" }, look: "raycast" }) };

const onPhone = () => matchMedia("(max-width: 900px)").matches;

/** The pills, lit on `on`; More holds the rest. */
const pillsLit = (on: string | null) => async (page: HTMLElement) => {
  if (onPhone()) return;
  const bar = within(await within(page).findByRole("navigation", { name: "Places" }));
  for (const name of ["Today", "Variants", "Aerie", "Canon"])
    await expect(bar.getByRole("link", { name })).toBeVisible();
  const lit = bar.queryAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
  await expect(lit.map((a) => a.textContent)).toEqual(on ? [on] : []);
  await expect(bar.getByRole("button", { name: /More|People/ })).toBeVisible();
};

const wren = (at: string, check: (page: HTMLElement) => Promise<void>): StoryObj =>
  pageAt(at, { me: ADMIN, answers: PREFS, check });

export const Today = wren("/today", pillsLit("Today"));

/** Today in the night look: graphite glass. */
export const TodayNight: StoryObj = {
  ...pageAt("/today", {
    me: ADMIN,
    answers: { "console/prefs": () => ({ display: { sidebar: "top" }, look: "raycast-night" }) },
    check: pillsLit("Today"),
  }),
  globals: { look: "raycast", theme: "dark" },
};
export const AerieTasks = wren("/aerie/tasks", pillsLit("Aerie"));
export const Variants = wren("/variants", pillsLit("Variants"));

/** A place off the pills: More takes its name and lights. */
export const UnderMore = wren("/people", async (page) => {
  await pillsLit(null)(page);
  if (onPhone()) return;
  const bar = within(await within(page).findByRole("navigation", { name: "Places" }));
  await expect(bar.getByRole("button", { name: /People/ })).toBeVisible();
});

/** A client's portal with the bar on top keeps Apps: pills are Wren's own. */
export const ClientKeepsApps = pageAt("/", {
  me: OWNER,
  answers: PREFS,
  check: async (page) => {
    if (onPhone()) return;
    await expect(within(page).queryByRole("navigation", { name: "Places" })).toBeNull();
  },
});
