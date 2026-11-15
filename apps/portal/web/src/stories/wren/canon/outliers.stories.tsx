/**
 * Canon › Outliers: the gallery's state rows (studio-suite D8, D9). The feed's rows are Studio ›
 * Inspiration's (`stories/wren/studio/`). Fake server: `web/src/mocks/`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { canonAddAnswers } from "../../../mocks/data/canon.js";
import { ADMIN } from "../../../mocks/data/me.js";
import {
  OUTLIER_ROWS,
  OUTLIERS,
  OUTLIERS_NONE_SCORED,
  OUTLIERS_NONE_TRACKED,
} from "../../../mocks/data/outliers.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Canon/Outliers" };
export default meta;

const WAIT = { timeout: 5000 };
/** a save files each pick in turn: slower under a full test run */
const SAVE = { timeout: 10_000 };

/** Select on, then pick the first `n` posts that take a pick. */
async function pick(page: HTMLElement, n: number) {
  const view = within(page);
  await userEvent.click(await view.findByRole("button", { name: "Select" }, WAIT));
  const boxes = await view.findAllByRole("button", { name: /^Pick / }, WAIT);
  for (const b of boxes.slice(0, n)) await userEvent.click(b);
  await expect(await view.findByText(`${n} picked`, {}, WAIT)).toBeVisible();
  return view;
}

/** Typical: a grid, best multiple first; 10x+ washed; a text post fills its frame; In Canon. */
export const Outliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("312x", {}, WAIT)).toBeVisible();
      await expect(view.getByText(/We stopped sending weekly reports/)).toBeVisible();
      await expect(view.getByText("In Canon")).toBeVisible();
      await expect(view.getByRole("link", { name: "All outliers" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  }),
);

/** The picture link expired: its words stand in. */
export const PictureFails = tidy(
  pageAt("/canon/outliers?platform=instagram", {
    me: ADMIN,
    check: async (page) => {
      await expect(await within(page).findByText(/編集のコツ/, {}, WAIT)).toBeVisible();
    },
  }),
);

/** The loading skeleton: the read never answers. */
export const Loading = pageAt("/canon/outliers", { me: ADMIN, mode: "pending" });

/** The read failed: the error and Retry; the bar stays. */
export const Failed = pageAt("/canon/outliers", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("alert", {}, WAIT)).toBeVisible();
    await expect(view.getByRole("button", { name: "Select" })).toBeVisible();
  },
});

/** Nobody tracked: the CLI line that fills it. */
export const NoneTracked = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS_NONE_TRACKED },
    check: async (page) => {
      await expect(
        await within(page).findByText("No creators tracked yet", {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/** Tracked, nothing scored yet. */
export const NoneScored = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS_NONE_SCORED },
    check: async (page) => {
      await expect(await within(page).findByText("7 creators tracked", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Scored, none over the usual draw, no filter on. */
export const NoOutliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": { ...OUTLIERS, rows: [] } },
    check: async (page) => {
      await expect(await within(page).findByText("No outliers yet", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Filters in force: a pill each, then nothing fits: Clear filters. */
export const NoMatch = tidy(
  pageAt("/canon/outliers?creator=1,5&kind=short", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("No post fits these filters", {}, WAIT)).toBeVisible();
      await expect(view.getByText("Maya Cuts, Agents Daily")).toBeVisible();
      await expect(view.getByRole("link", { name: "Clear filters" })).toBeVisible();
    },
  }),
);

/** Filter open on Creator: each tracked creator, with post counts. */
export const FilterOpen = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: /Filter/ }, WAIT));
      const pop = within(document.body);
      await userEvent.click(await pop.findByRole("option", { name: /Creator/ }, WAIT));
      await expect(await pop.findByRole("listbox", { name: "Creator" }, WAIT)).toBeVisible();
    },
  }),
);

/** Select on, two picked: boxes on the tiles, the bar at the foot. */
export const Selecting = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      await pick(page, 2);
    },
  }),
);

/** All filed: select ends, each says it is filing. */
export const Saved = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = await pick(page, 2);
      await userEvent.click(view.getByRole("button", { name: "Save to Canon" }));
      await waitFor(() => expect(view.getAllByText("Filing into Canon")).toHaveLength(2), SAVE);
      await expect(view.queryByText(/picked/)).toBeNull();
    },
  }),
);

/** One refused: the rest file, the refused one stays picked with the reason. */
export const SavePartFailed = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: {
      ...canonAddAnswers([]),
      "canon/add": (b: Record<string, unknown>) =>
        String(b.what).includes("FakeVid0002")
          ? refuse(403, "sign in to add to Canon")
          : {
              id: 1,
              what: String(b.what),
              fileName: null,
              note: null,
              person: "william",
              state: "pending",
              error: null,
              records: [],
              at: new Date().toISOString(),
            },
    },
    check: async (page) => {
      const view = await pick(page, 2);
      await userEvent.click(view.getByRole("button", { name: "Save to Canon" }));
      await expect(await view.findByRole("alert", {}, SAVE)).toHaveTextContent(
        /1 saved\. 1 not saved: sign in/,
      );
      await expect(view.getByText("1 picked")).toBeVisible();
    },
  }),
);

/** the record panel, once it is up */
async function panel() {
  return within(await within(document.body).findByRole("dialog", {}, WAIT));
}

const ADDED = (b: Record<string, unknown>) => ({
  id: 1,
  what: String(b.what),
  fileName: null,
  note: null,
  person: "william",
  state: "pending",
  error: null,
  records: [],
  at: new Date().toISOString(),
});

/** One post open (D9): every count in full, the usual draw beside it, Save. */
export const Detail = tidy(
  pageAt("/canon/outliers?post=youtube:FakeVid0001", {
    me: ADMIN,
    check: async () => {
      const box = await panel();
      await expect(box.getByText("Why it stands out")).toBeVisible();
      await expect(
        box.getByText(/This video got 412,000 views, 312x @cutsbymaya's usual/),
      ).toBeVisible();
      await expect(
        box.getByText(
          /Their usual video gets 1,319 views: the median of @cutsbymaya's last 30 videos/,
        ),
      ).toBeVisible();
      await expect(box.getByRole("button", { name: "Save to Canon" })).toBeVisible();
    },
  }),
);

/** A score with no stored usual draw (before the rescore): the multiple alone; In Canon, no Save. */
export const DetailNoBase = tidy(
  pageAt("/canon/outliers?post=linkedin:FakePost004", {
    me: ADMIN,
    check: async () => {
      const box = await panel();
      await expect(box.getByText(/5\.1x the median of @ops-notes's last 30 posts/)).toBeVisible();
      await expect(box.getByText("In Canon")).toBeVisible();
      await expect(box.queryByRole("button", { name: "Save to Canon" })).toBeNull();
    },
  }),
);

/** A post with no score yet: says when it gets one. */
export const DetailNotScored = tidy(
  pageAt("/canon/outliers?post=instagram:FakeReel007", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS },
    check: async () => {
      const box = await panel();
      await expect(box.getByRole("heading", { name: "Score" })).toBeVisible();
      await expect(box.getByText(/^Not scored yet\. A post gets a score/)).toBeVisible();
    },
  }),
);

/** The address names a post the list no longer holds. */
export const DetailGone = tidy(
  pageAt("/canon/outliers?post=youtube:NoSuchVideo", {
    me: ADMIN,
    check: async () => {
      const box = await panel();
      await expect(box.getByText("This post isn't in this list")).toBeVisible();
    },
  }),
);

/** Save from the panel: it files, and the tag says so. */
export const DetailSaved = tidy(
  pageAt("/canon/outliers?post=youtube:FakeVid0001", {
    me: ADMIN,
    answers: { ...canonAddAnswers([]), "canon/add": ADDED },
    check: async () => {
      const box = await panel();
      await userEvent.click(box.getByRole("button", { name: "Save to Canon" }));
      // the tag fades in from 0
      await waitFor(() => expect(box.getByText("Filing into Canon")).toBeVisible(), SAVE);
    },
  }),
);

/** Save refused: the reason under the button; Save stays to try again. */
export const DetailSaveFailed = tidy(
  pageAt("/canon/outliers?post=youtube:FakeVid0002", {
    me: ADMIN,
    answers: { "canon/add": () => refuse(403, "sign in to add to Canon") },
    check: async () => {
      const box = await panel();
      await userEvent.click(box.getByRole("button", { name: "Save to Canon" }));
      await expect(await box.findByRole("alert", {}, SAVE)).toHaveTextContent(
        "Not saved: sign in to add to Canon",
      );
      await expect(box.getByRole("button", { name: "Save to Canon" })).toBeEnabled();
    },
  }),
);

/** A tile's multiple says what it means on hover and focus. */
export const UsualTip = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const best = await view.findByText("312x", {}, WAIT);
      await expect(best.parentElement).toHaveAccessibleDescription(
        "412K views, 312x their usual 1,319 (the median of @cutsbymaya's last 30 videos)",
      );
    },
  }),
);

/** By creator: a section a creator, their best first; the head says who and how many. */
export const Grouped = tidy(
  pageAt("/canon/outliers?group=creator", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("heading", { name: "Maya Cuts" }, WAIT)).toBeVisible();
      await expect(view.getByRole("region", { name: "Agents Daily" })).toHaveTextContent("2 posts");
      await expect(view.getByRole("button", { name: "By creator" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
  }),
);

const MANY = Array.from({ length: 12 }, (_, i) => ({
  ...(OUTLIER_ROWS[0] as (typeof OUTLIER_ROWS)[number]),
  ref: `FakeVidM${String(i).padStart(3, "0")}`,
  multiple: 40 - i * 3,
  creatorPosts: 30,
}));

/** A creator with more posts than the section holds: a link to all of them. */
export const GroupedMore = tidy(
  pageAt("/canon/outliers?group=creator", {
    me: ADMIN,
    answers: { "canon/feed": { ...OUTLIERS, rows: MANY } },
    check: async (page) => {
      await expect(
        await within(page).findByRole("link", { name: "All 30 posts by Maya Cuts" }, WAIT),
      ).toHaveAttribute("href", expect.stringContaining("creator=1"));
    },
  }),
);

/** Sort by views: the most watched first; the chip names the sort. */
export const SortViews = tidy(
  pageAt("/canon/outliers?sort=views", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("button", { name: /Most views/ }, WAIT)).toBeVisible();
      const [first] = view.getAllByRole("link", { name: /^Open / });
      await expect(first).toHaveAccessibleName(/^Open Bartholomew/);
    },
  }),
);

/**
 * Save pressed, the add never answers: Save stays busy. Last in the file: its write stays in the
 * write queue and would hold the saves of any story after it.
 */
export const Saving = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/add": () => new Promise<never>(() => {}) },
    check: async (page) => {
      const view = await pick(page, 2);
      const save = view.getByRole("button", { name: "Save to Canon" });
      await userEvent.click(save);
      await waitFor(() => expect(save).toBeDisabled(), WAIT);
    },
  }),
);
