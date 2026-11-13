/** Aerie › Tasks: the list grouped by status, search, and the states the page says. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { manyTasks, wholeOf } from "../../../mocks/data/aerie.js";
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

/** Every filter in force has a pill, even when nothing matches: two statuses, one exact area, a role. */
export const BarPills = pageAt(
  "/aerie/tasks?area=dev&sub=0&status=To+Do&status=In+Progress&who=%40william&role=owner",
  {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("No task matches these filters.", {}, WAIT)).toBeVisible();
      await expect(view.getByText("To Do, In Progress")).toBeVisible();
      await expect(view.getByText("william as owner")).toBeVisible();
    },
  },
);

/** The address equals a saved view: its tab is on and Save view hides. */
export const SavedViewOn = pageAt(
  "/aerie/tasks?area=dev%2Fsite&status=To+Do&status=In+Progress&sort=priority",
  {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const tab = await view.findByRole("link", { name: /^Site work/ }, WAIT);
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(view.queryByRole("button", { name: /Save view/ })).toBeNull();
    },
  },
);

/** Filter, then Status: each value with its count; a pick writes the address. */
export const PicksStatus = pageAt("/aerie/tasks", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await view.findByText(/^Move the sign-up form/, {}, WAIT);
    await userEvent.click(view.getByRole("button", { name: /^Filter/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^Status/ }));
    const list = await screen.findByRole("listbox", { name: "Status" });
    await userEvent.click(within(list).getByRole("option", { name: /^Parked/ }));
    await waitFor(() =>
      expect(new URL(storyHref(), "http://x").searchParams.getAll("status")).toEqual(["Parked"]),
    );
  },
});

/** A taken name says it replaces the view. */
export const SaveTaken = pageAt("/aerie/tasks?priority=high", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await userEvent.click(await view.findByRole("button", { name: /Save view/ }, WAIT));
    await userEvent.type(await screen.findByRole("textbox", { name: "View name" }), "Site work");
    await expect(await screen.findByText(/Replaces your view/)).toBeVisible();
    await expect(screen.getByRole("button", { name: "Replace view" })).toBeVisible();
  },
});

/** The board fails alone: rows still draw; only All tasks shows. */
export const BoardFailed = pageAt("/aerie/tasks", {
  me: ADMIN,
  answers: { "aerie/board": () => refuse(500, "board read failed") },
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByText(/^Move the sign-up form/, {}, WAIT)).toBeVisible();
    await expect(view.queryByRole("link", { name: /^Site work/ })).toBeNull();
  },
});

/** 800 tasks, prod's size: the List draws them grouped (the speed check opens Done too). */
const MANY = manyTasks(800);

/** Scrolls what scrolls the rows to its end: the shell's panel on a wide screen, else the window. */
function scrollToEnd(page: HTMLElement) {
  for (let e = page.querySelector("[data-index]")?.parentElement; e; e = e.parentElement)
    if (e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
      e.scrollTop = e.scrollHeight;
      return;
    }
  window.scrollTo(0, document.documentElement.scrollHeight);
}

export const ManyTasks = tidy(
  pageAt("/aerie/tasks", {
    me: ADMIN,
    answers: {
      "aerie/tasks": (b: Record<string, unknown>) =>
        (b.filter as { updatedAfter?: string } | undefined)?.updatedAfter ? [] : MANY,
      "aerie/task": (b: Record<string, unknown>) => wholeOf(String(b.id), MANY),
    },
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("Piece of work number 1", {}, WAIT)).toBeVisible();
      // the rows past the first screen draw as the page scrolls (was: a wide screen drew none)
      await waitFor(() => {
        scrollToEnd(page);
        expect(view.getByRole("button", { name: /^Done/ })).toBeInTheDocument();
      }, WAIT);
    },
  }),
);
