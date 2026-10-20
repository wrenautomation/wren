/**
 * The Map on the fake server (designs/2026-10-19-business-map.md, "Map page", "Map page, M2.1"):
 * Wren's Home for the team, the shape drawn down the whole page. Today is a sheet over it (a tab on
 * a phone). Hover, click and History run in `play`. `pnpm --filter @wren/portal storybook`.
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

const onPhone = () => matchMedia("(max-width: 900px)").matches;
/** The Map's own width: the canvas box inside its section. */
const widthOf = (page: HTMLElement) =>
  page.querySelector<HTMLElement>('[aria-label="Map of the shape"]')?.getBoundingClientRect()
    .width ?? 0;

/**
 * Home for the team: the shape's sources, steps and offer, a ribbon between each, and the ghost, a
 * node an older version had that one person still sits on, dashed with its count. The
 * Map is the whole page; Today waits behind its header button.
 */
export const Default = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    for (const name of ["Spring list", "Winter ads", "Engaged", "Booked", "Signed", "Joined"])
      await node(page, name);
    await expect(await within(page).findByRole("heading", { name: "Map" })).toBeVisible();
    // The ghost holds its one person.
    await expect(await node(page, "Joined")).toHaveTextContent("1");
    // Today is no column beside the Map: closed, it takes no room (on a phone it is a tab).
    await expect(within(page).queryByRole("heading", { name: "Today", level: 1 })).toBeNull();
    if (!onPhone()) {
      await expect(within(page).queryByRole("heading", { name: /^Write/ })).toBeNull();
      const map = within(page).getByRole("region", { name: "Map" });
      // Edge to edge of the window, which sits 10px in from the screen (--ui-frame).
      await expect(Math.round(map.getBoundingClientRect().right)).toBeGreaterThanOrEqual(
        innerWidth - 12,
      );
    }
  },
});

/** Today opens as a sheet over the Map from its header; the canvas keeps its width. */
export const TodaySheet = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      const before = widthOf(page);
      await expect(before).toBeGreaterThan(300);
      const open = within(page).getByRole("button", { name: "Today" });
      await expect(open).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(open);
      const sheet = await within(document.body).findByRole("dialog", { name: "Today" });
      await expect(await within(sheet).findByRole("heading", { name: /^Write/ })).toBeVisible();
      await expect(Math.abs(widthOf(page) - before)).toBeLessThan(20);
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** Dark theme: the Map wears the app's tokens, nothing forces a look of its own. */
export const Dark = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      await node(page, "Joined");
      await expect(within(page).getByRole("region", { name: "Map" })).toBeVisible();
    },
  }),
  globals: { theme: "dark" },
};

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

/** Click a node: its details open as a card over the canvas, people newest first, each a link. */
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

/** On a phone the Map fills the width and Today is a tab under it, open. */
export const Phone = {
  ...pageAt("/", {
    me: ADMIN,
    check: async (page) => {
      await node(page, "Engaged");
      const tab = within(page).getByRole("button", { name: /Today/ });
      await expect(tab).toHaveAttribute("aria-expanded", "true");
      await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
      // Closing the tab hides Today and leaves the Map as it was.
      await userEvent.click(tab);
      await expect(tab).toHaveAttribute("aria-expanded", "false");
      await expect(within(page).queryByRole("heading", { name: /^Write/ })).toBeNull();
    },
  }),
  globals: { viewport: { value: "phone" } },
};
