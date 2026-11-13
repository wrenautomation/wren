/** Aerie › Columns: the kit's Explorer over the page's rows (area › task › child), the task as its preview. */
import type { Meta } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { AERIE_BOARD } from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/Columns" };
export default meta;

const WAIT = { timeout: 5000 };
const COLUMNS = "/aerie/tasks?layout=columns";
const at = (route: string) => `${COLUMNS}&at=${encodeURIComponent(route)}`;
const link = (page: HTMLElement, name: string | RegExp) =>
  within(page).findByRole("link", { name }, WAIT);
/** the preview's heading: the Explorer names the task once */
/** wide: the columns draw side by side; a phone shows one pane */
const wide = () => window.innerWidth >= 1024;
const heading = (page: HTMLElement, name: string) =>
  within(page).findByRole("heading", { level: 2, name: new RegExp(`^${name}`) }, WAIT);

/** The root lists every area; a click walks into one. */
export const Typical = tidy(
  pageAt(COLUMNS, {
    me: ADMIN,
    check: async (page) => {
      // the root column only: the sidebar also has an Inbox link
      const root = wide() ? await within(page).findByRole("region", { name: "Aerie" }, WAIT) : page;
      for (const name of ["Development", "Growth", "Inbox", "Operations", "Content"])
        await expect(await link(root, new RegExp(`^${name}`))).toBeVisible();
      // the page's bar finds and switches: the part draws neither
      await expect(within(page).queryByRole("radiogroup", { name: "View" })).toBeNull();
      await userEvent.click(await link(page, /^Development/));
      await waitFor(() => expect(storyHref()).toContain("at=aerie%2Fdev"), WAIT);
      await expect(await link(page, /^Site(?! work)/)).toBeVisible();
    },
  }),
);

/** A task with a child: the child is the next column, the task the preview (no sheet). */
export const Walked = tidy(
  pageAt(at("aerie/dev/site/EX-101"), {
    me: ADMIN,
    check: async (page) => {
      await heading(page, "Move the sign-up form to the new page layout");
      await expect(await link(page, /Fix the broken link in the footer/)).toBeVisible();
      // the body's own title is off: one heading names it
      await expect(
        within(page).getAllByText("Move the sign-up form to the new page layout", {
          selector: "h2",
        }),
      ).toHaveLength(1);
      await expect(screen.queryByRole("dialog")).toBeNull();
      await expect(
        await within(page).findByText("Form above the fold at 390", {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/** A task another lists: the preview's Waits on leads to it, the other's Blocks back. */
export const WaitsOn = tidy(
  pageAt(at("aerie/dev/site/EX-106"), {
    me: ADMIN,
    check: async (page) => {
      await heading(page, "Archive the old pricing page");
      const waits = within(await within(page).findByRole("region", { name: "Waits on" }, WAIT));
      await userEvent.click(
        await waits.findByRole("link", { name: /Move the sign-up form/ }, WAIT),
      );
      await waitFor(() => expect(storyHref()).toContain("at=aerie%2Fdev%2Fsite%2FEX-101"), WAIT);
      await expect(await within(page).findByRole("region", { name: "Blocks" }, WAIT)).toBeVisible();
    },
  }),
);

/** A task in a second area shows there as an alias, with where its home is. */
export const Alias = tidy(
  pageAt(at("aerie/inbox"), {
    me: ADMIN,
    check: async (page) => {
      const row = await link(page, /Write the weekly numbers note/);
      await expect(row.textContent).toContain("Operations");
      await userEvent.click(row);
      await heading(page, "Write the weekly numbers note");
      await expect(
        await within(page).findByRole("link", { name: "Show original" }, WAIT),
      ).toBeVisible();
    },
  }),
);

const BY_HOLDER = `${COLUMNS}&holder=cc-9f8e7d6c`;

/** A filter keeps its matches; a parent kept only as the way to one says so. */
export const Filtered = tidy(
  pageAt(`${BY_HOLDER}&at=${encodeURIComponent("aerie/dev/site")}`, {
    me: ADMIN,
    check: async (page) => {
      const parent = await link(page, /Move the sign-up form/);
      await expect(parent.textContent).toContain("Outside filter");
      await expect(
        within(page).queryByRole("link", { name: /Archive the old pricing page/ }),
      ).toBeNull();
    },
  }),
);

/** With a filter on, an area with no match leaves the root. */
export const FilteredRoot = tidy(
  pageAt(BY_HOLDER, {
    me: ADMIN,
    check: async (page) => {
      await expect(await link(page, /^Development/)).toBeVisible();
      await expect(within(page).queryByRole("link", { name: /^Content/ })).toBeNull();
    },
  }),
);

/** An area with no task says how to file one. */
export const EmptyArea = tidy(
  pageAt(at("aerie/content"), {
    me: ADMIN,
    check: async (page) => {
      await expect(
        await within(page).findByText(/Content holds nothing yet/, {}, WAIT),
      ).toBeVisible();
      await expect(within(page).getByText(/--area content/)).toBeVisible();
    },
  }),
);

/** From List or Board with a task open: Columns stands on that task, and no sheet opens. */
export const FromOpenTask = tidy(
  pageAt(`${COLUMNS}&task=EX-108`, {
    me: ADMIN,
    check: async (page) => {
      await heading(page, "Fix the broken link in the footer");
      await expect(screen.queryByRole("dialog")).toBeNull();
    },
  }),
);

/** Writes on: the preview's status is a pick, as in the sheet. */
export const WritesOn = tidy(
  pageAt(at("aerie/ops/EX-104"), {
    me: ADMIN,
    answers: { "aerie/board": { ...AERIE_BOARD, writes: true } },
    check: async (page) => {
      await heading(page, "Write the weekly numbers note");
      await expect(await within(page).findByRole("button", { name: /Status/ }, WAIT)).toBeVisible();
    },
  }),
);

/** A route the tree does not hold: the columns before it stand, with the way up. */
export const UnknownPath = tidy(
  pageAt(at("aerie/dev/EX-999"), {
    me: ADMIN,
    check: async (page) => {
      await expect(await within(page).findByText(/Nothing is at “EX-999”/, {}, WAIT)).toBeVisible();
      // a phone shows only the miss; wide keeps the columns before it
      if (wide()) await expect(await link(page, /^Site(?! work)/)).toBeVisible();
    },
  }),
);

/** The board fails: the areas come with it, so the tree has no top; Try again reads it again. */
export const BoardFailed = pageAt(COLUMNS, {
  me: ADMIN,
  answers: { "aerie/board": () => refuse(500, "board read failed") },
  check: async (page) => {
    // the read retries first: the line shows after 3 to 6 s
    await expect(
      await within(page).findByText(/couldn.t load/, {}, { timeout: 10000 }),
    ).toBeVisible();
    await expect(within(page).getByRole("button", { name: "Try again" })).toBeVisible();
  },
});

/** The rows still read: the part's skeleton columns. */
export const Loading = pageAt(COLUMNS, {
  me: ADMIN,
  mode: "pending",
});
