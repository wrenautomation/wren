/** Explorer › Business map: the newest map as one tree (`paths/*`): lines, groups, stations; tracks as links each way. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { focusAnswers } from "../../../mocks/data/map.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";
import { explorerHref } from "../../../modules/explorer/href.js";
import { SHARED } from "../map/map-kit.js";
import { linkTo, relation, WAIT } from "./explorer-kit.js";

const meta: Meta = { title: "Wren/Explorer/Business map" };
export default meta;

const at = (route: string, view?: "map") => explorerHref(route, view);
const GROWTH = "metro/lines/growth";
/** One part open: an empty map holds none, so Empty mode has no state to check here. The Map's own read (the preview's drawing) gets the shape the paths read. */
const ONE = { me: ADMIN, empty: false, answers: focusAnswers(SHARED) } as const;

/** The root: lines and the stations on no line; empty, where a map starts. */
export const Default = tidy(
  pageAt("/explorer/metro", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await linkTo(view, /^Lines/, at("metro/lines"));
      await linkTo(view, /^Stations on no line/, at("metro/stations"));
    },
  }),
);

/** A line: its stations and groups in map order; the preview draws its sub-line and opens it on the Map. */
export const Line = tidy(
  pageAt(at(GROWTH), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await linkTo(view, /^Sales talk/, at(`${GROWTH}/talk`));
      // the Map's own drawing, focused on this line
      await waitFor(() => expect(page.querySelector("svg.mm")).not.toBeNull(), WAIT);
      await expect(
        await view.findByRole("link", { name: "Open on the Map" }, WAIT),
      ).toHaveAttribute("href", "/map/line/growth");
    },
  }),
);

/** A station in a group: its fields past the sub, and its tracks each way as relations. */
export const Station = tidy(
  pageAt(at(`${GROWTH}/talk/book`), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText(/attached sop: Booking SOP/, {}, WAIT)).toBeVisible();
      await relation(view, "Goes to", `${GROWTH}/talk/book/goes-to`);
      await relation(view, "Comes from", `${GROWTH}/talk/book/comes-from`);
      await expect(view.getByRole("link", { name: "Open on the Map" })).toHaveAttribute(
        "href",
        "/map/station/book",
      );
    },
  }),
);

/** A transfer: Kick-off hands on to Retain, a planned line. */
export const Transfer = tidy(
  pageAt(at(`${GROWTH}/kickoff/transfers-to`), {
    ...ONE,
    check: async (page) => {
      await linkTo(
        within(page),
        /^Retain start/,
        at(`${GROWTH}/kickoff/transfers-to/retain_start`),
      );
    },
  }),
);

/** Map: every line a box, the hub's tracks drawn to each. */
export const MapRoot = tidy(
  pageAt(at("metro", "map"), {
    ...ONE,
    check: async (page) => {
      await waitFor(
        () =>
          expect(
            page.querySelector('[data-line="metro/lines/social>metro/stations/hub"]'),
          ).not.toBeNull(),
        { timeout: 10_000 },
      );
    },
  }),
);
