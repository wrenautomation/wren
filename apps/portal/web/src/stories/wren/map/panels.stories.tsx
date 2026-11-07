/** A part of the Map opens its panel. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { forgetMapCalls } from "../../../mocks/data/map.js";
import { LATE, mapAt, station } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Panels", globals: { data: "tidy" } };
export default meta;

/** Click a station: its details open as a card over the map, people newest first, each a link. */
export const Station = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Engaged"));
    const panel = await within(page).findByRole("region", { name: "Engaged, details" });
    const people = within(panel)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/people/people/"));
    await expect(people.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Ada North"),
      expect.stringContaining("Bo Fenwick"),
    ]);
    await expect(people[0]).toHaveAttribute("href", "/people/people/1");
    await expect(within(panel).getByText("Numbers in the last 30 days.")).toBeVisible();
    const open = within(panel).getByRole("link", { name: "Open" });
    await expect(open).toHaveAttribute("href", "/people/people?stepNode=%3Dengaged&view=journey");
    // A track of the station opens that track.
    await userEvent.click(within(panel).getByRole("button", { name: "Track to Booked" }));
    await expect(
      await within(page).findByRole("region", { name: "Engaged to Booked, details" }),
    ).toBeVisible();
  },
});

/** The hub holds the lead count and a link to People. */
export const Hub = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "First touch"));
    const panel = await within(page).findByRole("region", { name: "First touch, details" });
    await expect(within(panel).getByText(/18/)).toBeVisible();
    await expect(within(panel).getByRole("link", { name: "Open People" })).toHaveAttribute(
      "href",
      "/people/people",
    );
  },
});

/** A track opened by its address: who moves it, its promise, who waits and that they are late. */
export const Track = mapAt("/?track=engaged_to_booked", {
  check: async (page) => {
    const panel = await within(page).findByRole("region", { name: "Engaged to Booked, details" });
    await expect(within(panel).getByText("Moved by Ada North")).toBeVisible();
    await expect(within(panel).getByText("Promise 4h")).toBeVisible();
    await expect(within(panel).getByText(/waiting at Engaged/)).toHaveTextContent("Late");
    await expect(within(panel).getByText("Crossed: 5")).toBeVisible();
    await expect(await within(panel).findByRole("region", { name: "Track history" })).toBeVisible();
  },
});

/** A line opens from its chip on a station: its money, and its stations as buttons. */
export const Line = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await station(page, "Signed"));
    const station_ = await within(page).findByRole("region", { name: "Signed, details" });
    await userEvent.click(within(station_).getByRole("button", { name: "Line Signed" }));
    const panel = await within(page).findByRole("region", { name: "Signed, details" });
    await expect(within(panel).getByText("Core line")).toBeVisible();
    await expect(within(panel).getByText(/^Deals: 2/)).toBeVisible();
    await userEvent.click(within(panel).getByRole("button", { name: "Station Signed" }));
    await expect(
      await within(page).findByRole("region", { name: "Signed, details" }),
    ).toBeVisible();
  },
});

/** The view a viewer kept comes back: the panel they left open opens again on return. */
export const Kept = {
  ...mapAt("/", {
    check: async (page) => {
      const panel = await within(page).findByRole("region", { name: "Booked, details" }, LATE);
      await expect(panel).toBeVisible();
      // A pick is kept for the next visit.
      await userEvent.click(await station(page, "Engaged"));
      await within(page).findByRole("region", { name: "Engaged, details" });
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem("map:view:@wren") ?? "{}").panel).toEqual({
          kind: "station",
          id: "engaged",
        }),
      );
    },
  }),
  beforeEach: () => {
    freshStory();
    forgetMapCalls();
    localStorage.setItem(
      "map:view:@wren",
      JSON.stringify({ panel: { kind: "station", id: "booked" } }),
    );
  },
};
