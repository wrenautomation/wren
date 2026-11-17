/** Aerie › History (aerie D16 History table): one story per row that can be shown. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { feedOf, manyFeed } from "../../../mocks/data/aerie.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Aerie/History" };
export default meta;

const WAIT = { timeout: 5000 };
const AT = "/aerie/history";

/**
 * Today, Yesterday, then dates. Each row: who and the plain change, the task as a link, its own words.
 * A task gone from the board is its id alone; a kind the page does not know says its name.
 */
export const Feed = pageAt(AT, {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await view.findByRole("heading", { name: "Today" }, WAIT);
    await expect(view.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
    await expect(view.getByText("set status to Done")).toBeVisible();
    await expect(view.getByText("had a run fail")).toBeVisible();
    await expect(view.getByText(/timed out twice at the mail provider/)).toBeVisible();
    await expect(view.getByText("sent it to claude")).toBeVisible();
    await expect(view.getByText("label sync")).toBeVisible();
    await expect(
      view.getAllByRole("link", { name: /EX-104 Weekly digest/ })[0]?.getAttribute("href"),
    ).toContain("task=EX-104");
    await expect(view.queryByRole("link", { name: /EX-990/ })).toBeNull();
    await expect(view.getByText("EX-990")).toBeVisible();
    // newest first: the latest change leads
    await expect(view.getAllByRole("article")[0]).toHaveTextContent(/set status to Done/);
    await expect(view.queryByRole("button", { name: "Show older" })).toBeNull();
  },
});

/** Words match the title, the why and the change; other rows leave. */
export const Search = pageAt(`${AT}?q=digest`, {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(3), WAIT);
    await expect(view.queryByText("set status to Done")).toBeNull();
  },
});

/** Words that match nothing: the line and Clear. */
export const NoHits = pageAt(`${AT}?q=zebra`, {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    await view.findByText("Nothing matches “zebra”", {}, WAIT);
    await expect(view.getByRole("button", { name: "Clear" })).toBeVisible();
  },
});

/** No event at all. */
export const Empty = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/feed": [] },
  check: async (page) => {
    await within(page).findByText("Nothing has happened yet", {}, WAIT);
  },
});

/** 160 events: page one holds 100, Show older adds the last 60, then the button goes. */
export const Many = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: { "aerie/feed": feedOf(manyFeed(160)) },
    check: async (page) => {
      const view = within(page);
      await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(100), WAIT);
      await userEvent.click(view.getByRole("button", { name: "Show older" }));
      await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(160), WAIT);
      await expect(view.queryByRole("button", { name: "Show older" })).toBeNull();
    },
  }),
);

/** Show older failed: the line says so, the button turns to Try again, the rows stay. */
export const OlderFailed = tidy(
  pageAt(AT, {
    me: ADMIN,
    answers: {
      "aerie/feed": (b: Record<string, unknown>) =>
        b.before ? refuse(500, "older read failed") : feedOf(manyFeed(160))(b),
    },
    check: async (page) => {
      const view = within(page);
      await waitFor(() => expect(view.getAllByRole("article")).toHaveLength(100), WAIT);
      await userEvent.click(view.getByRole("button", { name: "Show older" }));
      await view.findByText("Older events didn't load.", {}, WAIT);
      await expect(view.getByRole("button", { name: "Try again" })).toBeEnabled();
      await expect(view.getAllByRole("article")).toHaveLength(100);
    },
  }),
);

/** The read is in flight. */
export const Loading = pageAt(AT, { me: ADMIN, mode: "pending" });

/** The read failed: the error and Try again, never the empty line. */
export const Failed = pageAt(AT, {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await within(page).findByText("The fake server failed, as asked.", {}, { timeout: 10_000 });
    await expect(within(page).getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(within(page).queryByText("Nothing has happened yet")).toBeNull();
  },
});

/** The sign-in has no Aerie actor: the one CLI line that adds it. */
export const NoActor = pageAt(AT, {
  me: ADMIN,
  answers: { "aerie/feed": () => refuse(403, "no Aerie actor for ada@example.com") },
  check: async (page) => {
    await within(page).findByText("No Aerie actor for ada@example.com", {}, WAIT);
  },
});
