/** Focus on a station or a line, and saved views. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  bigAnswers,
  focusAnswers,
  MAP_CALLS,
  MAP_VIEW,
  viewsAnswers,
} from "../../../mocks/data/map.js";
import { LATE, mapAt, mapOf, SHARED, station } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Focus", globals: { data: "tidy" } };
export default meta;

/** The focus page's heading: the part's name, once its read is in. */
const focusHead = (page: HTMLElement, name: string) =>
  within(page).findByRole("heading", { level: 1, name }, LATE);

/**
 * A station's focus page (designs/2026-10-23-focus-view.md, F1): the crumbs up through its line
 * and group, its SOP and apps in Attached, a stub to the next station, Esc up one crumb.
 */
export const Station = mapAt("/map/station/book", {
  answers: focusAnswers(SHARED),
  check: async (page) => {
    await focusHead(page, "Book");
    const crumbs = within(page).getByRole("navigation", { name: "Breadcrumb" });
    await expect(
      within(crumbs)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Map", "Growth", "Sales talk"]);
    const attached = within(page).getByRole("region", { name: "Attached" });
    await expect(within(attached).getByRole("link", { name: "Booking SOP" })).toHaveAttribute(
      "href",
      "/map/sops/booking",
    );
    await expect(within(attached).getByRole("heading", { name: "Apps" })).toBeVisible();
    // A stub focuses the part on its far side.
    await userEvent.click(
      await (await mapOf(page)).findByRole("button", { name: "to Held" }, LATE),
    );
    await focusHead(page, "Held");
    // Esc goes up one crumb: the group, then the line.
    await userEvent.keyboard("{Escape}");
    await focusHead(page, "Sales talk");
    await expect(within(page).getByText(/^Group · Now:/)).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await focusHead(page, "Growth");
  },
});

/** A line's focus page: its own link, each station's attachments under the station, and + Attach. */
export const Line = mapAt("/map/line/growth", {
  answers: focusAnswers(SHARED),
  check: async (page) => {
    await focusHead(page, "Growth");
    const attached = within(page).getByRole("region", { name: "Attached" });
    await expect(within(attached).getByRole("link", { name: "Deck" })).toHaveAttribute(
      "href",
      "https://example.test/growth-deck",
    );
    await expect(within(attached).getByRole("link", { name: "Book" })).toBeVisible();
    await expect(within(attached).getByRole("link", { name: "Booking SOP" })).toBeVisible();
    await expect(within(page).getByRole("region", { name: "People here" })).toBeVisible();
    // Attach a link: one call, on the line.
    await userEvent.click(within(attached).getByRole("button", { name: "+ Attach" }));
    const form = within(attached).getByRole("form", { name: "Attach to Growth" });
    await userEvent.type(
      within(form).getByRole("textbox", { name: "Ref" }),
      "https://example.test/script",
    );
    await userEvent.type(within(form).getByRole("textbox", { name: "Label" }), "Call script");
    await userEvent.click(within(form).getByRole("button", { name: "Attach" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeAttach"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({
      on: "line",
      id: "growth",
      add: { kind: "link", ref: "https://example.test/script", label: "Call script" },
    });
    // Remove sits on the line's own row only.
    await userEvent.click(within(attached).getByRole("button", { name: "Remove Deck" }));
    await waitFor(() => expect(MAP_CALLS).toHaveLength(2));
    await expect(MAP_CALLS[1]?.body).toMatchObject({
      on: "line",
      id: "growth",
      remove: "https://example.test/growth-deck",
    });
    await expect(within(attached).queryByRole("button", { name: "Remove Booking SOP" })).toBeNull();
  },
});

/** A part the newest version does not hold: one line that says so, and the way back. */
export const Missing = mapAt("/map/group/gone", {
  answers: focusAnswers(SHARED),
  check: async (page) => {
    await expect(
      await within(page).findByText(/has no group called "gone"/, {}, LATE),
    ).toBeVisible();
    await expect(within(page).getByRole("link", { name: "Back to the Map" })).toHaveAttribute(
      "href",
      "/",
    );
  },
});

/** The Map's station panel links to the station's focus page. */
export const FromPanel = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Engaged"));
    const panel = await within(page).findByRole("region", { name: "Engaged, details" });
    await expect(within(panel).getByRole("link", { name: "Focus" })).toHaveAttribute(
      "href",
      "/map/station/engaged",
    );
  },
});

/**
 * A set of parts (F2): the line and the group drawn as one, a chip for each, Add, and Save
 * view, which keeps the set under record "map" and opens the saved view.
 */
export const Parts = mapAt(`/map/parts/${encodeURIComponent("line:webinar,group:talk")}`, {
  answers: { ...focusAnswers(SHARED), ...viewsAnswers([]) },
  check: async (page) => {
    await focusHead(page, "Webinar + Sales talk");
    await expect(within(page).getByText(/^View · Now:/)).toBeVisible();
    const parts = within(page).getByRole("list", { name: "Parts" });
    await expect(within(parts).getByRole("link", { name: "Webinar" })).toHaveAttribute(
      "href",
      "/map/line/webinar",
    );
    const map = await mapOf(page);
    await expect(map.getByRole("button", { name: /^Book\b/ })).toBeVisible();
    // Add: the set grows by a line.
    await userEvent.click(within(parts).getByRole("button", { name: "Add a line or group" }));
    const pick = await within(document.body).findByRole("dialog", { name: "Add a line or group" });
    await userEvent.click(within(pick).getByRole("option", { name: "Audit" }));
    await focusHead(page, "Webinar + Sales talk + Audit");
    // Drop a part: back to two.
    await userEvent.click(within(page).getByRole("button", { name: "Drop Audit" }));
    await focusHead(page, "Webinar + Sales talk");
    await userEvent.click(within(page).getByRole("button", { name: "Save view" }));
    const pop = await within(document.body).findByRole("dialog", { name: "Save view" });
    await userEvent.type(within(pop).getByRole("textbox", { name: "View name" }), "Demo desk");
    await userEvent.click(within(pop).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["saveView"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({
      record: "map",
      name: "Demo desk",
      params: "parts=line%3Awebinar%2Cgroup%3Atalk",
      shared: false,
    });
    await focusHead(page, "Demo desk");
  },
});

/** A saved view (F2): its name, the Map crumb back; in Views, Make it the home view sets `map.home`. */
export const View = mapAt("/map/view/41", {
  answers: { ...focusAnswers(SHARED), ...viewsAnswers() },
  check: async (page) => {
    await focusHead(page, "Sales desk");
    const crumbs = within(page).getByRole("navigation", { name: "Breadcrumb" });
    await expect(within(crumbs).getByRole("link", { name: "Map" })).toHaveAttribute("href", "/");
    await expect(within(page).queryByRole("button", { name: "Save view" })).toBeNull();
    await userEvent.click(within(page).getByRole("button", { name: "Views: Sales desk" }));
    const pop = await within(document.body).findByRole("dialog", { name: "Views" });
    const home = within(pop).getByRole("button", { name: "Make it the home view" });
    await expect(home).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(home);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["setPref"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ key: "map.home", value: 41 });
  },
});

/** The Map bar's Views: Whole map, each saved view with its look, and Save view beside it. */
export const ViewsMenu = mapAt("/", {
  answers: {
    ...bigAnswers(SHARED),
    ...viewsAnswers([
      MAP_VIEW,
      {
        ...MAP_VIEW,
        id: 42,
        name: "Plates, audit shut",
        params: "look=layers&shut=node%3Aaudit%40",
      },
    ]),
  },
  check: async (page) => {
    await userEvent.click(await within(page).findByRole("button", { name: /^Views:/ }, LATE));
    const pop = await within(document.body).findByRole("dialog", { name: "Views" });
    await expect(within(pop).getByRole("link", { name: "Whole map" })).toBeVisible();
    await expect(within(pop).getByRole("link", { name: /Plates, audit shut/ })).toHaveAttribute(
      "href",
      expect.stringContaining("sv=42"),
    );
  },
});

/** "/" with a home view: the view above Today, and Whole map to leave it. */
export const HomeView = mapAt("/", {
  answers: { ...focusAnswers(SHARED), ...viewsAnswers([MAP_VIEW], { "map.home": 41 }) },
  check: async (page) => {
    await focusHead(page, "Sales desk");
    await expect(within(page).getByRole("link", { name: "Whole map" })).toHaveAttribute(
      "href",
      "/?whole=1",
    );
  },
});

/** A home view the shape lost all of: the whole Map, and one line that says so. */
export const HomeViewGone = mapAt("/", {
  answers: {
    ...focusAnswers(SHARED),
    ...viewsAnswers([{ ...MAP_VIEW, params: "parts=line%3Agone" }], { "map.home": 41 }),
  },
  check: async (page) => {
    await expect(
      await within(page).findByText(/holds no part of the shape now/, {}, LATE),
    ).toBeVisible();
    await expect(
      within(page).getByRole("heading", { level: 1, name: "Your business" }),
    ).toBeVisible();
  },
});
