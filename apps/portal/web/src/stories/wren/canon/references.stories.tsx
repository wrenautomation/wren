/** Canon › References: the reel grid, his note whole, one reference open. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { canonAddAnswers } from "../../../mocks/data/canon.js";
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

/** The Add box: a link and his note go in; the new row says Filing at once. */
export const AddLink = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    answers: canonAddAnswers(),
    check: async (page) => {
      const view = within(page);
      await userEvent.type(
        await view.findByLabelText("Add to Canon", {}, WAIT),
        "https://www.instagram.com/reel/FakeAdd99/",
      );
      await userEvent.type(view.getByLabelText("Your note (kept whole)"), "steal the captions");
      await userEvent.click(view.getByRole("button", { name: "Add" }));
      const rows = within(await view.findByRole("list", { name: "Recent adds" }, WAIT));
      await expect(await rows.findByText(/FakeAdd99/, {}, WAIT)).toBeVisible();
      await expect(rows.getByText(/FakeAdd99/).closest("li")).toHaveTextContent("Filing");
      await waitFor(() => expect(view.getByLabelText("Add to Canon")).toHaveValue(""));
    },
  }),
);

/** A picture or PDF: picked, uploaded on a signed link, then asked. */
export const AddFile = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = within(page);
      const pick = page.querySelector<HTMLInputElement>('input[type="file"]');
      if (!pick) throw new Error("no file input");
      await userEvent.upload(
        pick,
        new File(["%PDF-1.4 made up"], "pricing-teardown.pdf", { type: "application/pdf" }),
      );
      await expect(await view.findByText("pricing-teardown.pdf", {}, WAIT)).toBeVisible();
      await userEvent.click(view.getByRole("button", { name: "Add" }));
      const rows = within(await view.findByRole("list", { name: "Recent adds" }, WAIT));
      await expect(await rows.findByText("pricing-teardown.pdf", {}, WAIT)).toBeVisible();
    },
  }),
);

/** A failed add shows why, and Retry puts it back in line. */
export const AddFailed = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    answers: canonAddAnswers(),
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("yt-dlp: this video is private", {}, WAIT)).toBeVisible();
      await userEvent.click(view.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(view.queryByText("yt-dlp: this video is private")).toBeNull());
    },
  }),
);

/** Nothing pasted: the box says what it needs. */
export const AddEmpty = tidy(
  pageAt("/canon/references", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: "Add" }, WAIT));
      await expect(await view.findByRole("alert", {}, WAIT)).toHaveTextContent(/Paste a link/);
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
