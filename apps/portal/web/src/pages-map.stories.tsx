/**
 * The Map on the fake server (designs/2026-10-19-business-map.md, "Map page"): Wren's Home for the
 * team, the shape drawn down the page with Today docked on the right. Hover, click and History run
 * in `play`. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "./mocks/data/index.js";
import { planAnswers } from "./mocks/data/map.js";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Map" };
export default meta;

/** The layout is async: a node shows when elk has placed it. */
const LATE = { timeout: 10_000 };
const node = (page: HTMLElement, name: RegExp | string) =>
  within(page).findByRole(
    "button",
    { name: new RegExp(typeof name === "string" ? name : name.source) },
    LATE,
  );

type Reply = (b: Record<string, unknown>) => unknown;
const SHARED = {
  get: ANSWERS["pipeline/recordsGet"] as Reply,
  list: ANSWERS["pipeline/recordsList"] as Reply,
};

/**
 * Home for the team: the shape's sources, steps and offer, a ribbon between each, and the ghost, a
 * node an older version had that one person still sits on, dashed and faded with its count.
 */
export const Default = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    for (const name of ["Spring list", "Winter ads", "Engaged", "Booked", "Signed", "Joined"])
      await node(page, name);
    await expect(await within(page).findByRole("heading", { name: "Map" })).toBeVisible();
    // Today is docked on the right, without its page title.
    await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
    await expect(within(page).queryByRole("heading", { name: "Today", level: 1 })).toBeNull();
    // The ghost holds its one person.
    await expect(await node(page, "Joined")).toHaveTextContent("1");
  },
});

/** The window is in the address; 7 days is lit and the numbers are the window's. */
export const Window = pageAt("/?window=7", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
    await expect(within(page).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
});

/** No shape yet: one line, the palette inert, the start disabled. */
export const Empty = pageAt("/", {
  me: ADMIN,
  answers: {
    "pipeline/recordsGet": (b: Record<string, unknown>) =>
      b.record === "pipeline.shape"
        ? { record: "pipeline.shape", row: null, detail: null }
        : SHARED.get(b),
    "pipeline/recordsList": (b: Record<string, unknown>) =>
      String(b.record).startsWith("pipeline.")
        ? {
            record: String(b.record),
            view: null,
            rows: [],
            total: 0,
            counts: {},
            next: null,
            totals: {},
          }
        : SHARED.list(b),
  },
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeDisabled();
    await expect(within(page).getByText("Source")).toHaveAttribute("aria-disabled", "true");
  },
});

/** Click a node: its details open on the right, people newest first, each a link to its journey. */
export const NodePanel = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await userEvent.click(await node(page, "Engaged"));
    const panel = await within(page).findByRole("region", { name: "Engaged, details" });
    const people = within(panel)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/pipelines/journeys/"));
    await expect(people.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Ada North"),
      expect.stringContaining("Bo Fenwick"),
    ]);
    await expect(people[0]).toHaveAttribute("href", "/pipelines/journeys/j1");
    await expect(within(panel).getByText("Numbers in the last 30 days.")).toBeVisible();
    const open = within(panel).getByRole("link", { name: "Open" });
    await expect(open).toHaveAttribute("href", "/pipelines/journeys?node=engaged&view=all");
  },
});

/** A ghost's panel lists the person who sits on the dropped node. */
export const Ghost = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await userEvent.click(await node(page, "Joined"));
    const panel = await within(page).findByRole("region", { name: "Joined, details" });
    await expect(within(panel).getByText("Dropped from the newest version")).toBeVisible();
    await expect(within(panel).getByRole("link", { name: /Gus Held/ })).toBeVisible();
  },
});

/** History: pick version 1 and 2, and the Map draws the difference, the Joined node gone. */
export const History = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
    await userEvent.click(within(page).getByRole("button", { name: /History/ }));
    const panel = await within(page).findByRole("region", { name: "History" });
    const versions = within(panel).getAllByRole("button", { name: /^Version/ });
    await expect(versions.map((v) => v.textContent)).toEqual([
      expect.stringContaining("Version 2"),
      expect.stringContaining("Version 1"),
    ]);
    await userEvent.click(versions[0] as HTMLElement);
    await userEvent.click(versions[1] as HTMLElement);
    await expect(await within(panel).findByText("Removed node Joined.", {}, LATE)).toBeVisible();
    await expect(within(panel).getByText("Added edge Engaged to Booked.")).toBeVisible();
    await waitFor(() => expect(within(page).getAllByText("Gone").length).toBeGreaterThan(0), LATE);
  },
});

/** A plan after the offer shows its collected money, and a loop back from Booked stays thin. */
export const Plan = pageAt("/", {
  me: ADMIN,
  answers: planAnswers(SHARED),
  check: async (page) => {
    const plan = await node(page, "Standard plan");
    await expect(plan).toHaveTextContent("CAD collected");
    await waitFor(
      () => expect(page.querySelectorAll(".react-flow__edge").length).toBeGreaterThanOrEqual(6),
      LATE,
    );
  },
});

/** The dock folds away and stays folded: the choice is kept on this device. */
export const DockCollapsed = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    await node(page, "Engaged");
    // A phone has no dock to hide: Today is a tab (see Phone).
    if (matchMedia("(max-width: 900px)").matches) return;
    await userEvent.click(await within(page).findByRole("button", { name: "Hide" }));
    await expect(within(page).queryByRole("heading", { name: /^Write/ })).toBeNull();
    await expect(localStorage.getItem("wren.portal.map.dock")).toBe("closed");
    const show = within(page).getByRole("button", { name: /Today/ });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(show);
    await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
    localStorage.removeItem("wren.portal.map.dock");
  },
});

/** On a phone the Map fills the width and Today is a tab under it. */
export const Phone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      const tab = within(page).getByRole("button", { name: /Today/ });
      await expect(tab).toHaveAttribute("aria-expanded", "true");
      await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
    },
  }),
  globals: { viewport: { value: "phone" } },
};
