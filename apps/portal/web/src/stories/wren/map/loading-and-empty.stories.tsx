/** The Map before a shape: loading, the ghost, empty and cannot draw. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { liveShape, MAP_CALLS, SHAPE_HUB_CLASH, shapeAnswers } from "../../../mocks/data/map.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { LATE, mapAt, SHARED, station, tools } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Loading and empty", globals: { data: "tidy" } };
export default meta;

const NONE = {
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
};

/**
 * The first read of the map has not come back: no box, no ring, no words. The frame holds the dot
 * grid and a few ghost lines and stations, the size the map will fill. The title carries no ring.
 */
export const Loading = {
  ...mapAt("/", { mode: "pending" }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const page = canvasElement;
    const skeleton = await within(page).findByRole("status", { name: "Reading your map" }, LATE);
    await expect(skeleton).toBeVisible();
    // One card says what is out (William 10-24: a dedicated loading screen); no ring beside a title.
    const frame = skeleton.parentElement as HTMLElement;
    await expect(skeleton.textContent).toBe("Reading your map");
    const title = within(page).getByRole("heading", { name: "Your business", level: 1 });
    await expect(title.parentElement?.querySelectorAll("[data-busy]").length).toBe(0);
    // It fills the frame the map fills.
    await expect(
      Math.abs(skeleton.getBoundingClientRect().height - frame.clientHeight),
    ).toBeLessThan(2);
  },
};

/** A ghost's panel lists the person who sits on the dropped station. */
export const Ghost = mapAt("/", {
  check: async (page) => {
    await userEvent.click(await within(page).findByRole("button", { name: "Open Joined" }));
    const panel = await within(page).findByRole("region", { name: "Joined, details" });
    await expect(within(panel).getByText("Dropped from the newest version")).toBeVisible();
    await expect(within(panel).getByRole("link", { name: /Gus Held/ })).toBeVisible();
  },
});

/** No shape yet: one line and the start, ready for a login that may edit. */
export const Empty = mapAt("/", {
  answers: NONE,
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeEnabled();
    await expect(within(page).getByRole("list", { name: "Parts of a shape" })).toBeVisible();
  },
});

/** A login that only reads cannot start one, and the page says so. */
export const EmptyReadOnly = mapAt("/", {
  me: { ...ADMIN, team: { role: "viewer", wren: ["read"], flags: {} } },
  answers: NONE,
  check: async (page) => {
    await expect(await within(page).findByText(/^No shape yet/)).toBeVisible();
    await expect(
      within(page).getByRole("button", { name: "Start from Wren's shape" }),
    ).toBeDisabled();
    await expect(within(page).getByText("You need edit access to start a shape.")).toBeVisible();
  },
});

/** Start from Wren's shape: one click imports the starter, and the Map draws it. */
export const EmptyStart = mapAt("/", {
  answers: liveShape(SHARED, null),
  check: async (page) => {
    const start = await within(page).findByRole("button", { name: "Start from Wren's shape" });
    await userEvent.click(start);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeStart"]));
    await station(page, "Engaged");
    await expect(within(page).queryByText(/^No shape yet/)).toBeNull();
  },
});

/** A shape the map cannot draw says so, with the server's reasons, and the page still works. */
export const CannotDraw = mapAt("/", {
  answers: shapeAnswers(SHARED, SHAPE_HUB_CLASH),
  check: async (page) => {
    await expect(
      await within(page).findByText("This shape cannot be drawn on the map."),
    ).toBeVisible();
    const why = within(page).getByRole("list", { name: "Why" });
    await expect(within(why).getAllByRole("listitem").length).toBeGreaterThan(0);
    await expect(within(page).queryByRole("group", { name: /./ })).toBeNull();
    // History and Export still answer for the shape.
    await expect((await tools(page)).getByRole("button", { name: /History/ })).toBeVisible();
  },
});
