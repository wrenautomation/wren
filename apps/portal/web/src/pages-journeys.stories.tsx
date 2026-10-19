/**
 * Journeys → Board on the fake server (designs/2026-10-18-journeys.md): the shape's nodes as
 * columns, a drag down the shape, a drag back that is refused, a refused move that rolls back, and a drop
 * with a reason. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import { refuse } from "./mocks/api.js";
import { forgetCalls, JOURNEY_CALLS } from "./mocks/data/journeys.js";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Journeys" };
export default meta;

const lane = (page: HTMLElement, name: string) => within(page).findByRole("region", { name });
const person = (page: HTMLElement, name: string) =>
  within(page).findByRole("link", { name }) as Promise<HTMLElement>;

/**
 * A drag as the browser makes it: the card starts it, the lane takes the drop, and one
 * `DataTransfer` runs through the three events. Built by hand: the testing library copies a given
 * `dataTransfer` into a new one per event, so the card's id would not reach the drop.
 */
async function drag(page: HTMLElement, name: string, to: string) {
  const card = (await person(page, name)).closest("article");
  if (!card) throw new Error(`${name} has no card`);
  const target = await lane(page, to);
  const dataTransfer = new DataTransfer();
  const send = (el: HTMLElement, type: string) =>
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  send(card, "dragstart");
  send(target, "dragover");
  send(target, "drop");
}

const inLane = async (page: HTMLElement, name: string, who: string) =>
  within(await lane(page, name)).findByRole("link", { name: who });

/** The shape's nodes as lanes, each card with its time at the node, the stale one flagged. */
export const Board = pageAt("/pipelines/board", {
  me: ADMIN,
  check: async (page) => {
    for (const name of ["Engaged", "Booked", "Signed"]) await lane(page, name);
    await inLane(page, "Engaged", "Ada North");
    await inLane(page, "Booked", "Dee Okafor");
    // The finished ones sit in their own node's lane.
    await inLane(page, "Signed", "Eli Brandt");
    await expect(within(await lane(page, "Engaged")).getByText("Stale")).toBeVisible();
  },
});

/** The same page the Pipelines link opens: `/pipelines` lands on the board. */
export const BoardFromNav = pageAt("/pipelines", {
  me: ADMIN,
  check: async (page) => {
    await lane(page, "Engaged");
  },
});

/** A card dragged to a lane down the shape moves at once and sends one move. */
export const BoardMovesForward = pageAt("/pipelines/board", {
  me: ADMIN,
  check: async (page) => {
    forgetCalls();
    await drag(page, "Ada North", "Booked");
    await inLane(page, "Booked", "Ada North");
    await waitFor(() => expect(JOURNEY_CALLS).toHaveLength(1));
    expect(JOURNEY_CALLS[0]?.path).toBe("journeysMove");
    expect(JOURNEY_CALLS[0]?.body).toMatchObject({ journey: "j1", to: "booked" });
    expect(JOURNEY_CALLS[0]?.body.requestId).toBeTruthy();
  },
});

/** A card dragged back is refused with a plain note and sends nothing. */
export const BoardRefusesBackward = pageAt("/pipelines/board", {
  me: ADMIN,
  check: async (page) => {
    forgetCalls();
    await drag(page, "Dee Okafor", "Engaged");
    await expect(
      await within(page).findByText(
        "Dee Okafor cannot go from Booked to Engaged: no path leads there.",
      ),
    ).toBeVisible();
    await inLane(page, "Booked", "Dee Okafor");
    expect(JOURNEY_CALLS).toHaveLength(0);
  },
});

/** The server says the shape did not take the move: the card goes back and the note says why. */
export const BoardRollsBack = pageAt("/pipelines/board", {
  me: ADMIN,
  answers: {
    "pipeline/journeysMove": refuse(409, "Nothing moved. The shape did not take that move."),
  },
  check: async (page) => {
    await drag(page, "Ada North", "Booked");
    await waitFor(async () => {
      await expect(
        within(page).getAllByText("Nothing moved. The shape did not take that move.").length,
      ).toBeGreaterThan(0);
    });
    await inLane(page, "Engaged", "Ada North");
  },
});

/** Drop opens a reason; the reason sends the drop and the card leaves. */
export const BoardDropsWithReason = pageAt("/pipelines/board", {
  me: ADMIN,
  check: async (page) => {
    forgetCalls();
    const ui = within(page);
    (await ui.findByRole("button", { name: "Drop Dee Okafor" })).click();
    const reason = await ui.findByRole("textbox", {
      name: "Why does Dee Okafor leave?",
    });
    await fireEvent.change(reason, { target: { value: "Bought elsewhere" } });
    (await ui.findByRole("button", { name: "Drop" })).click();
    await waitFor(() => expect(JOURNEY_CALLS).toHaveLength(1));
    expect(JOURNEY_CALLS[0]?.path).toBe("journeysDrop");
    expect(JOURNEY_CALLS[0]?.body).toMatchObject({ journey: "j4", reason: "Bought elsewhere" });
    await waitFor(() => expect(ui.queryByRole("link", { name: "Dee Okafor" })).toBeNull());
  },
});

/** A journey on a node the newest version dropped sits in its own lane and can be dropped. */
export const BoardGhost = pageAt("/pipelines/board", {
  me: ADMIN,
  check: async (page) => {
    await inLane(page, "Joined (older version)", "Gus Held");
    await within(page).findByText("Older version");
    await expect(within(page).getByRole("button", { name: "Drop Gus Held" })).toBeVisible();
  },
});

/** No shape yet: one plain line. */
export const BoardEmpty = pageAt("/pipelines/board", {
  me: ADMIN,
  answers: {
    "pipeline/recordsGet": (b: Record<string, unknown>) => ({
      record: String(b.record),
      row: null,
      detail: null,
    }),
    "pipeline/recordsList": (b: Record<string, unknown>) => ({
      record: String(b.record),
      view: null,
      rows: [],
      total: 0,
      counts: {},
      next: null,
      totals: {},
    }),
  },
  check: async (page) => {
    await expect(await within(page).findByText("No shape yet.")).toBeVisible();
  },
});
