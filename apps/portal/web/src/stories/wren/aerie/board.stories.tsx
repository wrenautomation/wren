/** Aerie › Board: lanes by status (or the group), Done shut, a lane strip on a phone. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { AERIE_BOARD, manyTasks, wholeOf } from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/Board" };
export default meta;

const WAIT = { timeout: 5000 };
const BOARD = "/aerie/tasks?layout=board";
/** the kit's narrow query: a phone shows one lane, picked from the strip */
const narrow = () => matchMedia("(max-width: 899.98px)").matches;

/** a lane, wide or narrow: its region, or its tab ("To Do, 2") picked first */
async function lane(page: HTMLElement, name: string) {
  const view = within(page);
  if (!narrow()) return within(await view.findByRole("region", { name }, WAIT));
  const tab = await view.findByRole(
    "tab",
    { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) },
    WAIT,
  );
  if (tab.getAttribute("aria-selected") !== "true") await userEvent.click(tab);
  const panel = await view.findByRole("tabpanel", { name }, WAIT);
  // the lane change fades in from 0: wait it out
  await waitFor(() => expect(panel).toBeVisible(), WAIT);
  return within(panel);
}

/** scrolls what scrolls `el` to its end: a lane on a wide screen, the page on a phone */
function scrollToEnd(el: Element) {
  for (let e = el.parentElement; e; e = e.parentElement)
    if (e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
      e.scrollTop = e.scrollHeight;
      return;
    }
  window.scrollTo(0, document.documentElement.scrollHeight);
}

/** Lanes in board order, each with its count; Done starts shut and opens on a click. */
export const Typical = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    check: async (page) => {
      const todo = await lane(page, "To Do");
      await expect(await todo.findByText("Write the weekly numbers note", {}, WAIT)).toBeVisible();
      if (!narrow()) {
        const done = within(page).getByRole("button", { name: /^Done/ });
        await expect(done).toHaveAttribute("aria-expanded", "false");
        await expect(within(page).queryByText("Closed piece of work number 1")).toBeNull();
        await userEvent.click(done);
      }
      // writes off: no Move button
      await expect(within(page).queryByRole("button", { name: /^Move EX-/ })).toBeNull();
      const opened = await lane(page, "Done");
      await expect(
        await opened.findByText("Closed piece of work number 1", {}, WAIT),
      ).toBeVisible();
      if (!narrow()) {
        // opened past the board's right edge: it scrolls in whole
        const region = within(page).getByRole("region", { name: "Done" });
        const board = region.parentElement as HTMLElement;
        await waitFor(
          () =>
            expect(region.getBoundingClientRect().right).toBeLessThanOrEqual(
              board.getBoundingClientRect().right + 1,
            ),
          WAIT,
        );
      }
    },
  }),
);

/** A status lane with no card keeps its head and says so. */
export const EmptyLane = tidy(
  pageAt(`${BOARD}&area=growth`, {
    me: ADMIN,
    check: async (page) => {
      if (narrow()) {
        // a phone opens on the first lane with cards, its tab whole in the strip
        const on = await within(page).findByRole("tab", { selected: true }, WAIT);
        await expect(on).toHaveAccessibleName(/^Needs Human Input,/);
        const strip = on.parentElement as HTMLElement;
        await waitFor(() =>
          expect(on.getBoundingClientRect().right).toBeLessThanOrEqual(
            strip.getBoundingClientRect().right + 1,
          ),
        );
      }
      const todo = await lane(page, "To Do");
      await expect(await todo.findByText("No tasks", {}, WAIT)).toBeVisible();
    },
  }),
);

/** A status filter keeps only its lanes: no empty lane for a status it leaves out. */
export const StatusFilter = tidy(
  pageAt(`${BOARD}&status=To+Do`, {
    me: ADMIN,
    check: async (page) => {
      const todo = await lane(page, "To Do");
      await expect(await todo.findByText("Write the weekly numbers note", {}, WAIT)).toBeVisible();
      const gone = narrow()
        ? { role: "tab", name: /^In Progress,/ }
        : { role: "region", name: "In Progress" };
      await expect(within(page).queryByRole(gone.role, { name: gone.name })).toBeNull();
    },
  }),
);

/** Grouped by area: a lane per area; a card shows its status, not its area. */
export const ByArea = tidy(
  pageAt(`${BOARD}&group=area`, {
    me: ADMIN,
    check: async (page) => {
      const site = await lane(page, "dev/site");
      const card = await site.findByRole("link", { name: /^Move the sign-up form/ }, WAIT);
      await expect(within(card).getByText("In Progress")).toBeVisible();
    },
  }),
);

/** The open task's card is marked; ↑ ↓ in the panel walk the Board's order. */
export const OpenWalks = tidy(
  pageAt(`${BOARD}&task=EX-104`, {
    me: ADMIN,
    check: async (page) => {
      // the open sheet hides the board from the tree: find the card by its mark
      await screen.findByRole("dialog", {}, WAIT);
      const marked = () =>
        [...page.querySelectorAll('a[aria-current="true"]')].map((a) => a.textContent ?? "");
      await waitFor(
        () =>
          expect(marked().some((t) => t.startsWith("Write the weekly numbers note"))).toBe(true),
        WAIT,
      );
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() => expect(storyHref()).not.toContain("task=EX-104"), WAIT);
    },
  }),
);

/** 800 tasks: Done opened draws only the cards in view of its lane, down to its last. */
const MANY = manyTasks(800);

export const ManyCards = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: {
      "aerie/tasks": (b: Record<string, unknown>) =>
        (b.filter as { updatedAfter?: string } | undefined)?.updatedAfter ? [] : MANY,
      "aerie/task": (b: Record<string, unknown>) => wholeOf(String(b.id), MANY),
    },
    check: async (page) => {
      if (!narrow())
        await userEvent.click(await within(page).findByRole("button", { name: /^Done/ }));
      const done = await lane(page, "Done");
      const first = await done.findAllByRole("link", {}, WAIT);
      await expect(first.length).toBeLessThan(100);
      await waitFor(() => {
        scrollToEnd(first[0] as Element);
        expect(page.querySelector('[data-index="399"]')).not.toBeNull();
      }, WAIT);
    },
  }),
);

/** The rows still read: three lane skeletons (one on a phone) under the bar. */
export const Loading = pageAt(BOARD, {
  me: ADMIN,
  mode: "pending",
});

const WRITES = { "aerie/board": { ...AERIE_BOARD, writes: true } };

/** opens a card's Move menu in `from` and picks `to` */
async function move(page: HTMLElement, from: string, id: string, to: string | RegExp) {
  const l = await lane(page, from);
  await userEvent.click(await l.findByRole("button", { name: `Move ${id}` }, WAIT));
  const menu = within(await screen.findByRole("menu", {}, WAIT));
  await userEvent.click(menu.getByRole("menuitemradio", { name: to }));
}

const cardIn = (page: HTMLElement, laneKey: string, id: string) =>
  page.querySelector<HTMLElement>(`[data-lane="${laneKey}"] a[data-id="${id}"]`);

/**
 * Move: the menu names the field and ticks the card's lane; a pick shows the card in its new lane at once,
 * says so on the live line and, wide, puts focus on it. A phone keeps the lane and focuses the next card.
 */
export const Move = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      const todo = await lane(page, "To Do");
      await userEvent.click(await todo.findByRole("button", { name: "Move EX-104" }, WAIT));
      const menu = within(await screen.findByRole("menu", {}, WAIT));
      // the menu fades in from 0
      await waitFor(() => expect(menu.getByText("Move to Status")).toBeVisible(), WAIT);
      await expect(menu.getByRole("menuitemradio", { name: "To Do" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await userEvent.click(menu.getByRole("menuitemradio", { name: "In Progress" }));
      await expect(await screen.findByText("EX-104 moved to In Progress", {}, WAIT)).toBeTruthy();
      if (!narrow()) {
        await waitFor(() => expect(cardIn(page, "status:In Progress", "EX-104")).not.toBeNull());
        await waitFor(() => expect(document.activeElement?.getAttribute("data-id")).toBe("EX-104"));
      } else {
        await waitFor(() =>
          expect(within(page).getByRole("tab", { selected: true })).toHaveAccessibleName(/^To Do,/),
        );
        const focused = document.activeElement as HTMLElement;
        await expect(
          focused.closest('[role="tabpanel"]') ?? focused.closest('[role="tab"]'),
        ).not.toBeNull();
        await expect(cardIn(page, "status:To Do", "EX-104")).toBeNull();
      }
      // the answer lands: the dim lifts, and an own write does not wash
      await waitFor(() => expect(page.querySelector('[aria-busy="true"]')).toBeNull(), WAIT);
      await expect(page.querySelector(".animate-ui-changed")).toBeNull();
    },
  }),
);

/** Escape shuts the menu and gives focus back to the Move button; nothing writes. */
export const MoveEscape = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      const todo = await lane(page, "To Do");
      const button = await todo.findByRole("button", { name: "Move EX-104" }, WAIT);
      await userEvent.click(button);
      await screen.findByRole("menu", {}, WAIT);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull(), WAIT);
      await waitFor(() => expect(document.activeElement).toBe(button), WAIT);
      await expect(within(page).queryByText(/moved to/)).toBeNull();
    },
  }),
);

/** Wide: a move into the shut Done lane puts focus on its strip; the count follows. */
export const MoveToShut = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      if (narrow()) return;
      const strip = await within(page).findByRole("button", { name: "Done, 24" }, WAIT);
      await move(page, "To Do", "EX-104", "Done");
      await waitFor(() => expect(strip).toHaveAccessibleName("Done, 25"), WAIT);
      await waitFor(() => expect(document.activeElement).toBe(strip), WAIT);
    },
  }),
);

/** A refused move: the card goes back to its lane and the toast names it. */
export const MoveRefused = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: { ...WRITES, "aerie/edit": () => refuse(409, "stale: EX-104 is at version 2") },
    check: async (page) => {
      await move(page, "To Do", "EX-104", "In Progress");
      // toast fades in: wait past opacity 0
      await waitFor(
        () => expect(screen.getByText(/EX-104 changed since you read it/)).toBeVisible(),
        WAIT,
      );
      await lane(page, "To Do");
      await waitFor(() => expect(cardIn(page, "status:To Do", "EX-104")).not.toBeNull(), WAIT);
      await expect(cardIn(page, "status:In Progress", "EX-104")).toBeNull();
    },
  }),
);

/** Labels: a move swaps one label; a card in two lanes keeps its other copy. */
export const MoveLabel = tidy(
  pageAt(`${BOARD}&group=labels`, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      // a phone shows one lane: open each before looking in it
      const has = async (name: string, id: string) => {
        await lane(page, name);
        return cardIn(page, `labels:${name}`, id) !== null;
      };
      await move(page, "repo:site", "EX-101", "worst-case");
      await waitFor(async () => expect(await has("worst-case", "EX-101")).toBe(true), WAIT);
      await expect(await has("repo:site", "EX-101")).toBe(false);
      // EX-103 sits in both lanes: a move from worst-case to repo:site leaves one copy
      await move(page, "worst-case", "EX-103", "repo:site");
      await waitFor(async () => expect(await has("repo:site", "EX-103")).toBe(true), WAIT);
      await waitFor(
        () =>
          expect(
            page.querySelector('[data-lane="labels:worst-case"] a[data-id="EX-103"]'),
          ).toBeNull(),
        WAIT,
      );
    },
  }),
);

/** Held by has no move (claims are peers' job): no Move button, writes on or not. */
export const NoMoveHeld = tidy(
  pageAt(`${BOARD}&group=holder`, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      await lane(page, "Not held");
      await expect(within(page).queryByRole("button", { name: /^Move EX-/ })).toBeNull();
    },
  }),
);

/** The menu open on a card: the field's name, the lanes in board order, the card's own ticked. */
export const MoveOpen = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: WRITES,
    check: async (page) => {
      const todo = await lane(page, "To Do");
      await userEvent.click(await todo.findByRole("button", { name: "Move EX-104" }, WAIT));
      const menu = within(await screen.findByRole("menu", {}, WAIT));
      const items = menu.getAllByRole("menuitemradio").map((i) => i.textContent);
      await expect(items.at(-1)).toBe("Done");
    },
  }),
);

/** The answer is still out: the card waits in its new lane, dimmed, with a busy ring. */
export const MoveBusy = tidy(
  pageAt(BOARD, {
    me: ADMIN,
    answers: { ...WRITES, "aerie/edit": () => new Promise<never>(() => {}) },
    check: async (page) => {
      await move(page, "To Do", "EX-104", "In Progress");
      // a phone stays on To Do: open the lane the card went to
      await lane(page, "In Progress");
      await waitFor(() => expect(page.querySelector('[aria-busy="true"]')).not.toBeNull(), WAIT);
    },
  }),
);
