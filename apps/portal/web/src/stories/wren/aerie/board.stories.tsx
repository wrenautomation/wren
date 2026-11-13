/** Aerie › Board: lanes by status (or the group), Done shut, a lane strip on a phone. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { manyTasks, wholeOf } from "../../../mocks/data/aerie.js";
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
