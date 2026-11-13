/** Aerie › Tasks with a task open (`?task=`): the panel's states. Fake server: `web/src/mocks/data/aerie.ts`. */
import type { Meta } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { AERIE_BOARD } from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/Task" };
export default meta;

const WAIT = { timeout: 5000 };
const WRITES_ON = { "aerie/board": { ...AERIE_BOARD, writes: true } };
/** the sheet portals out of the page */
const sheet = async () => within(await screen.findByRole("dialog", {}, WAIT));
/** the sheet names itself with the title too (a hidden heading): the shown one is the last */
const headOf = async (s: Awaited<ReturnType<typeof sheet>>, name: string | RegExp) => {
  const all = await s.findAllByRole("heading", { name }, WAIT);
  return all[all.length - 1] as HTMLElement;
};

/** Every part: checks with counts, plan, notes, roles up the area tree, a holder, a comment, history newest first. */
export const Open = tidy(
  pageAt("/aerie/tasks?task=EX-101", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await headOf(s, "Move the sign-up form to the new page layout")).toBeVisible();
      await expect(await s.findByText("Definition of done (1 of 3)", {}, WAIT)).toBeVisible();
      await expect(s.getByText("william on dev")).toBeVisible();
      await expect(s.getByText("Held by")).toBeVisible();
      await expect(s.getAllByText("cc-1a2b3c4d").length).toBe(2);
      await expect(s.getByText(/Edits from the web open at the switch/)).toBeVisible();
      const history = s.getAllByRole("listitem").map((li) => li.textContent ?? "");
      const first = history.findIndex((t) => t.includes("changed notes"));
      const made = history.findIndex((t) => t.includes("made it"));
      await expect(first).toBeLessThan(made);
      await expect(s.queryByRole("button", { name: /^Status:/ })).toBeNull();
    },
  }),
);

/** ↓ opens the next task in the List's order; the sheet stays. */
export const Walks = tidy(
  pageAt("/aerie/tasks?task=EX-101", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await s.findByText("Definition of done (1 of 3)", {}, WAIT);
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() => expect(storyHref()).toContain("task=EX-108"));
      await expect(await headOf(await sheet(), "Fix the broken link in the footer")).toBeVisible();
    },
  }),
);

/** A child shows its parent as a link. */
export const Child = tidy(
  pageAt("/aerie/tasks?task=EX-108", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(
        await s.findByRole("link", { name: /EX-101 Move the sign-up form/ }, WAIT),
      ).toBeVisible();
    },
  }),
);

export const NotFound = pageAt("/aerie/tasks?task=EX-999", {
  me: ADMIN,
  check: async () => {
    const s = await sheet();
    await expect(await headOf(s, "No task EX-999")).toBeVisible();
  },
});

/** The read fails: the head still shows from the row; the body says why. */
export const LoadFails = pageAt("/aerie/tasks?task=EX-104", {
  me: ADMIN,
  answers: { "aerie/task": () => refuse(500, "the task read failed") },
  check: async () => {
    const s = await sheet();
    await expect(await headOf(s, /^Write the weekly numbers note/)).toBeVisible();
    await expect(await s.findByRole("alert", {}, WAIT)).toBeVisible();
  },
});

/** The body reads; the head is the row's at once. */
export const Reading = pageAt("/aerie/tasks?task=EX-104", {
  me: ADMIN,
  answers: { "aerie/task": () => new Promise(() => {}) },
  check: async () => {
    const s = await sheet();
    await expect(await headOf(s, /^Write the weekly numbers note/)).toBeVisible();
    await expect(s.getByRole("status", { name: "Reading the task" })).toBeVisible();
  },
});

/** Writes on: status and priority are picks; a pick writes with the version read. */
export const WritesOn = tidy(
  pageAt("/aerie/tasks?task=EX-104", {
    me: ADMIN,
    answers: WRITES_ON,
    check: async () => {
      const s = await sheet();
      await s.findByText("Opens, replies and booked calls for the week.", {}, WAIT);
      await expect(s.queryByText(/Edits from the web open at the switch/)).toBeNull();
      await userEvent.click(s.getByRole("button", { name: "Status: To Do" }));
      const pick = within(await screen.findByRole("dialog", { name: "Status" }));
      await userEvent.click(pick.getByRole("button", { name: "In Progress" }));
      await expect(screen.queryByText(/changed since you read it/)).toBeNull();
    },
  }),
);

/** A write over a newer version: the toast says so and the panel reads again. */
export const EditStale = tidy(
  pageAt("/aerie/tasks?task=EX-104", {
    me: ADMIN,
    answers: {
      ...WRITES_ON,
      "aerie/edit": () => refuse(409, "stale: EX-104 is at version 2"),
    },
    check: async () => {
      const s = await sheet();
      await s.findByText("Opens, replies and booked calls for the week.", {}, WAIT);
      await userEvent.click(s.getByRole("button", { name: "Priority: low" }));
      const pick = within(await screen.findByRole("dialog", { name: "Priority" }));
      await userEvent.click(pick.getByRole("button", { name: "high" }));
      await expect(
        await screen.findByText(/EX-104 changed since you read it/, {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/** A title one word long: it wraps whole in the head (a phone gets a bottom sheet). */
export const LongTitle = tidy(
  pageAt("/aerie/tasks?task=EX-103", {
    me: ADMIN,
    check: async () => {
      await expect(await headOf(await sheet(), /^Supercalifragilistic/)).toBeVisible();
    },
  }),
);
