import { userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { ANSWERS } from "../../../mocks/data/index.js";
import { forgetMapCalls } from "../../../mocks/data/map.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { type PageAt, pageAt } from "../../../mocks/page.js";

/** The layout is async: a station shows when the renderer has placed it. */
export const LATE = { timeout: 10_000 };

/** The drawn map: the renderer's svg, apart from Today's task buttons that share a name. */
export const mapOf = async (page: HTMLElement) => {
  const svg = await waitFor(() => {
    const el = page.querySelector<HTMLElement>("svg[role='group']");
    if (!el) throw new Error("The map is not drawn yet.");
    return el;
  }, LATE);
  return within(svg);
};

/**
 * A station of the map, by the start of its name: "Engaged, 5 now" is found by "Engaged". The map
 * opens one level at a time first, until every station shows.
 */
export const station = async (page: HTMLElement, name: RegExp | string) => {
  const depth = await within(page).findByRole("group", { name: "Fold depth" }, LATE);
  const open = within(depth).getByRole("button", { name: "Open one level" });
  for (let i = 0; i < 12 && !(open as HTMLButtonElement).disabled; i++) await userEvent.click(open);
  return (await mapOf(page)).findByRole(
    "button",
    { name: new RegExp(`^${typeof name === "string" ? name : name.source}`) },
    LATE,
  );
};

/**
 * The map is drawn at real size (one scene px is one css px), sits at the top of its frame and
 * across its middle when it is smaller, and pans inside it when it is bigger. Returns whether it pans.
 */
/** Window, Client, History, Export and Import sit in the ⋯ menu; it opens in a portal. */
export const tools = async (page: HTMLElement) => {
  await userEvent.click(within(page).getByRole("button", { name: "Map tools" }));
  return within(document.body);
};

export type Reply = (b: Record<string, unknown>) => unknown;

export const SHARED = {
  get: ANSWERS["pipeline/recordsGet"] as Reply,
  list: ANSWERS["pipeline/recordsList"] as Reply,
};

/**
 * A Map story: nothing of an earlier story is left. The view a viewer keeps (zoom, folds, the open
 * panel) is in the browser store, and the call log outlives a story in one frame.
 */
export const mapAt = (at: string, opts: PageAt = {}) => ({
  // a diagram, not a list: its empty state has its own stories (loading-and-empty)
  ...pageAt(at, { me: ADMIN, empty: false, ...opts }),
  beforeEach: () => {
    freshStory();
    forgetMapCalls();
    for (const k of Object.keys(localStorage))
      if (k.startsWith("map:view:")) localStorage.removeItem(k);
  },
});

// --- history: versions, compare, restore, tags, undo --------------------------------------------

export const openHistory = async (page: HTMLElement) => {
  await station(page, "Engaged");
  await userEvent.click((await tools(page)).getByRole("button", { name: /History/ }));
  return within(page).findByRole("region", { name: "History" });
};

export const banner = (page: HTMLElement) =>
  within(page).findByRole("status", { name: "Open draft" });
