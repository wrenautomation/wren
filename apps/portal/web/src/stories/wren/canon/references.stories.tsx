/** Canon › References: the reel grid, his note whole, one reference open. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Canon/References" };
export default meta;

const WAIT = { timeout: 5000 };

/** The grid: a 600-char note shows whole, Show more brings the next page. */
export const References = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText(/steal the zoom on the punchline/, {}, WAIT),
      ).toBeVisible();
      // never clamped: the note's last words are on screen
      await expect(
        view.getByText(/keep the music under the voice the whole time\.$/),
      ).toBeVisible();
      await expect(view.getByText("12 references")).toBeVisible();
      await userEvent.click(view.getByRole("button", { name: "Show more" }));
      await expect(await view.findByText("Reference 12", {}, WAIT)).toBeVisible();
      await waitFor(() => expect(view.queryByRole("button", { name: "Show more" })).toBeNull());
    },
  }),
);

/** A filter goes in the address; nothing matches, so the page offers to clear. */
export const NoMatch = tidy(
  pageAt("/canon/references?q=nothing-matches-this", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText("No reference matches these filters.", {}, WAIT),
      ).toBeVisible();
      await userEvent.click(view.getByRole("link", { name: "Clear filters" }));
      await expect(await view.findByText("12 references", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Only his: the select narrows the grid and writes `provider=human` in the address. */
export const OnlyHis = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.selectOptions(await view.findByLabelText("Saved by", {}, WAIT), "human");
      await expect(await view.findByText("2 references", {}, WAIT)).toBeVisible();
      await expect(storyHref()).toContain("provider=human");
    },
  }),
);

/** One reference open: the player, his note, the rule lines it backs, the beats. */
export const Opened = tidy(
  pageAt("/canon/references?r=instagram-Fake1", {
    me: ADMIN,
    check: async () => {
      const sheet = within(await within(document.body).findByRole("dialog", {}, WAIT));
      await expect(await sheet.findByText("VC-1", {}, WAIT)).toBeVisible();
      await expect(sheet.getByText("Cut on the beat, never between beats.")).toBeVisible();
      await expect(sheet.getByText(/keep the music under the voice/)).toBeVisible();
      await expect(sheet.getByText("Zoom on the punchline")).toBeVisible();
    },
  }),
);

/** A YouTube talk with no stored file and no poster: the page shows a plain frame. */
export const OpenedNoFile = tidy(
  pageAt("/canon/references?r=youtube-fakeVideo01", {
    me: ADMIN,
    check: async () => {
      const sheet = within(await within(document.body).findByRole("dialog", {}, WAIT));
      await expect(await sheet.findByText("No rule line cites it yet.", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Before the first sync: the page says how to fill it. */
export const NotIndexed = pageAt("/canon/references", {
  me: ADMIN,
  answers: {
    "canon/references": {
      indexed: false,
      head: null,
      total: 0,
      rows: [],
      next: null,
      facets: { platform: [], tag: [], provider: [] },
    },
  },
  check: async (page) => {
    await expect(await within(page).findByText("No index here yet", {}, WAIT)).toBeVisible();
  },
});

export const Loading = pageAt("/canon/references", { me: ADMIN, mode: "pending" });

export const Failed = pageAt("/canon/references", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
  },
});
