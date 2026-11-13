/** Aerie › Tasks: the list grouped by status, search, and the states the page says. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/Tasks" };
export default meta;

const WAIT = { timeout: 5000 };

/** Grouped by status in board order; Done starts shut; a long title wraps whole. */
export const Typical = tidy(
  pageAt("/aerie/tasks", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText("Move the sign-up form to the new page layout", {}, WAIT),
      ).toBeVisible();
      const done = view.getByRole("button", { name: /^Done/ });
      await expect(done).toHaveAttribute("aria-expanded", "false");
      await expect(view.queryByText("Closed piece of work number 1")).toBeNull();
      await userEvent.click(done);
      await expect(await view.findByText("Closed piece of work number 1")).toBeVisible();
    },
  }),
);

/** The address filters: one status, grouped by area. */
export const Filtered = pageAt("/aerie/tasks?status=In+Progress&group=area", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(
      await view.findByText(/^Fix the broken link in the footer/, {}, WAIT),
    ).toBeVisible();
    await expect(view.queryByText(/^Write the weekly numbers note/)).toBeNull();
  },
});

/** One key twice ORs its values; opening a row keeps both. */
export const TwoStatuses = pageAt("/aerie/tasks?status=To+Do&status=In+Progress", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await expect(
      await view.findByText(/^Fix the broken link in the footer/, {}, WAIT),
    ).toBeVisible();
    await expect(view.queryByText(/^Archive the old pricing page/)).toBeNull();
    await userEvent.click(view.getByRole("link", { name: /^Write the weekly numbers note/ }));
    const at = new URL(storyHref(), "http://x").searchParams;
    await expect(at.get("task")).toBe("EX-104");
    await expect(at.getAll("status")).toEqual(["To Do", "In Progress"]);
  },
});

/** A row opens its task in the address. */
export const OpensTask = pageAt("/aerie/tasks", {
  me: ADMIN,
  check: async (page) => {
    const link = await within(page).findByRole(
      "link",
      { name: /^Write the weekly numbers note/ },
      WAIT,
    );
    await userEvent.click(link);
    await expect(storyHref()).toContain("task=EX-104");
  },
});

export const NoHits = pageAt("/aerie/tasks?q=zebra", {
  me: ADMIN,
  check: async (page) => {
    await expect(await within(page).findByText(/No task mentions/, {}, WAIT)).toBeVisible();
  },
});

export const NoFilterMatch = pageAt("/aerie/tasks?status=Parked&priority=high", {
  me: ADMIN,
  check: async (page) => {
    await expect(
      await within(page).findByText("No task matches these filters.", {}, WAIT),
    ).toBeVisible();
  },
});

export const EmptyBoard = pageAt("/aerie/tasks", {
  me: ADMIN,
  answers: { "aerie/tasks": [] },
  check: async (page) => {
    await expect(await within(page).findByText("No tasks yet", {}, WAIT)).toBeVisible();
  },
});

export const NoActor = pageAt("/aerie/tasks", {
  me: ADMIN,
  answers: {
    "aerie/board": () => refuse(403, "no Aerie actor for team@example.test"),
    "aerie/tasks": () => refuse(403, "no Aerie actor for team@example.test"),
  },
  check: async (page) => {
    await expect(
      await within(page).findByText("No Aerie actor for team@example.test", {}, WAIT),
    ).toBeVisible();
  },
});

export const Failed = pageAt("/aerie/tasks", { me: ADMIN, mode: "fails" });

export const Pending = pageAt("/aerie/tasks", { me: ADMIN, mode: "pending" });
