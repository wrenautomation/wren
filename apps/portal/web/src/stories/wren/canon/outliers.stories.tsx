/**
 * Canon › Outliers: the gallery's state rows (studio-suite D8, D9, D10). The feed's rows are Studio ›
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

/** Typical: the creator strip over a grid, best multiple first; a text post fills its frame; In Canon. */
export const Outliers = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("312x", {}, WAIT)).toBeVisible();
      // every tile says its platform (D10)
      await expect(view.getAllByText("YouTube").length).toBeGreaterThan(1);
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
      await expect(await within(page).findByText("5 creators tracked", {}, WAIT)).toBeVisible();
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
        "412K views; they usually get 1,319 (the median of @cutsbymaya's last 30 videos)",
      );
    },
  }),
);

/** The strip (D10, YouTube's subscriptions bar): All lit, a face per person with its platforms. */
export const Strip = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const bar = within(await within(page).findByRole("navigation", { name: "Creators" }, WAIT));
      await expect(bar.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
      await expect(bar.getByRole("link", { name: "Maya Cuts" })).toHaveAccessibleDescription(
        "Maya Cuts: Instagram, YouTube, 118 posts",
      );
      // All, five faces, Add
      await expect(bar.getAllByRole("link")).toHaveLength(7);
      await expect(bar.getByRole("link", { name: "Add" })).toBeVisible();
    },
  }),
);

/** A face tapped: its ring lit, only that person's posts; a second tap goes back to All. */
export const StripPicked = tidy(
  pageAt("/canon/outliers?creator=5", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const bar = within(await view.findByRole("navigation", { name: "Creators" }, WAIT));
      const face = bar.getByRole("link", { name: "Agents Daily" });
      await expect(face).toHaveAttribute("aria-current", "true");
      await expect(face).toHaveAttribute("href", expect.not.stringContaining("creator="));
      await expect(await view.findByText(/best CRM/, {}, WAIT)).toBeVisible();
      await expect(view.queryByText("312x")).toBeNull();
    },
  }),
);

/** A hot post (10x+) outlines its frame and inks its multiple. */
export const HotTile = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const best = await within(page).findByText("312x", {}, WAIT);
      await expect(getComputedStyle(best).color).not.toBe(
        getComputedStyle(within(page).getByText("5.1x")).color,
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
      await expect(view.getByRole("button", { name: "By creator" })).toBeVisible();
    },
  }),
);

/** By platform: a section a platform, the best first; its head is the mark, the name, the count. */
export const GroupedByPlatform = tidy(
  pageAt("/canon/outliers?group=platform", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("heading", { name: "Instagram" }, WAIT)).toBeVisible();
      await expect(view.getByRole("heading", { name: "X" })).toBeVisible();
      await expect(view.getByRole("region", { name: "LinkedIn" })).toHaveTextContent("1 post");
    },
  }),
);

/** The Group menu: none, by creator, by platform; a pick groups the page. */
export const GroupMenu = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: "Group" }, WAIT));
      const menu = within(document.body);
      // a pick navigates, which the story harness cannot: GroupedByPlatform shows the result
      await expect(
        await menu.findByRole("button", { name: "By platform, top 12 each" }),
      ).toBeVisible();
    },
  }),
);

/** Shorts: reels, Shorts and TikToks only; the switch says which. */
export const FormatShorts = tidy(
  pageAt("/canon/outliers?format=short", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByRole("button", { name: "Shorts" }, WAIT)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await waitFor(() => expect(view.getAllByText("Instagram").length).toBeGreaterThan(0), WAIT);
      await expect(view.queryByText("YouTube")).toBeNull();
    },
  }),
);

/** Long-form with nothing in it: the empty state offers to clear the filters. */
export const FormatEmpty = tidy(
  pageAt("/canon/outliers?format=long&platform=x", {
    me: ADMIN,
    check: async (page) => {
      await expect(
        await within(page).findByText("No post fits these filters", {}, WAIT),
      ).toBeVisible();
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

/** Sort by views per follower: a small account's big post first; each tile says the ratio. */
export const SortReach = tidy(
  pageAt("/canon/outliers?sort=reach", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByRole("button", { name: /Views per follower/ }, WAIT),
      ).toBeVisible();
      const [first] = view.getAllByRole("link", { name: /^Open / });
      await expect(first).toHaveAccessibleName(/^Open Maya Cuts/);
      await expect(view.getByText("22 views per follower")).toBeVisible();
    },
  }),
);

/** One person on two platforms: the panel names the other account. */
export const DetailAlsoOn = tidy(
  pageAt("/canon/outliers?post=youtube:FakeVid0001", {
    me: ADMIN,
    check: async () => {
      const box = await panel();
      await expect(box.getByRole("heading", { name: "Also on" })).toBeVisible();
      await expect(box.getByRole("region", { name: "Also on" })).toHaveTextContent(
        "Instagram @cutsbymaya · 52K followers",
      );
      await expect(box.getByText("Views per follower")).toBeVisible();
    },
  }),
);

/** A copied video (WA-1391): it plays on open, muted, with its controls in view. */
export const DetailVideo = tidy(
  pageAt("/canon/outliers?post=instagram:FakeReel007", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS },
    check: async () => {
      const box = await panel();
      const video = box.getByLabelText("Reel by Maya Cuts") as HTMLVideoElement;
      await expect(video.tagName).toBe("VIDEO");
      await expect(video).toHaveAttribute("src", "/outliers/reel.mp4");
      await expect(video.muted).toBe(true);
      await waitFor(() => expect(video.paused).toBe(false), WAIT);
      // the whole frame fits the sheet: its controls show without a scroll
      await expect(video.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    },
  }),
);

/**
 * YouTube, or a reel IG gave no file of: its picture behind Play; the player loads only on the click,
 * a ring on Play until it does.
 */
export const DetailEmbed = tidy(
  pageAt("/canon/outliers?post=youtube:FakeVid0002", {
    me: ADMIN,
    check: async () => {
      const box = await panel();
      const frame = () => document.querySelector("[role=dialog] iframe");
      await expect(frame()).toBeNull();
      await userEvent.click(box.getByRole("button", { name: /^Play / }));
      await waitFor(() => expect(frame()).not.toBeNull(), WAIT);
      await expect(box.getByRole("button", { name: /^Loading / })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(frame()?.getAttribute("src")).toMatch(
        /^https:\/\/www\.youtube-nocookie\.com\/embed\//,
      );
    },
  }),
);

/**
 * A mouse that rests on a tile with a copied video plays it, muted, over the picture; leave stops
 * it. Reduced motion (the test browsers): the tile stays still.
 */
export const TileHover = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS },
    check: async (page) => {
      const tile = (await within(page).findByText(/^Day 3 of editing/, {}, WAIT)).closest(
        "article",
      ) as HTMLElement;
      await expect(tile.querySelector("video")).toBeNull();
      await userEvent.hover(tile);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((r) => setTimeout(r, 400));
        await expect(tile.querySelector("video")).toBeNull();
        return;
      }
      await waitFor(() => {
        const v = tile.querySelector("video");
        expect(v?.muted).toBe(true);
        expect(getComputedStyle(v as HTMLVideoElement).opacity).toBe("1");
      }, WAIT);
      await userEvent.unhover(tile);
      await waitFor(() => expect(tile.querySelector("video")).toBeNull(), WAIT);
    },
  }),
);

const R = OUTLIER_ROWS as (typeof OUTLIER_ROWS)[number][];
const WORDS = [
  R[1],
  R[6],
  R[5],
  // a picture with no words: no hook line
  { ...R[0], ref: "FakeVidNoWords", title: null, text: null, multiple: 7 },
  // worst case: one huge line, no sentence end; the hook stops at 8 lines
  {
    ...R[6],
    ref: "FakeReelOneLine",
    text: `${"one take no cuts just talking straight to camera about the edit ".repeat(10)}#editing`,
    multiple: 2,
  },
].filter((r) => r != null);

/** Under each picture its hook (PT-6): the title, else the text's first line, else nothing. */
export const TileWords = tidy(
  pageAt("/canon/outliers", {
    me: ADMIN,
    answers: { "canon/feed": { ...OUTLIERS, rows: WORDS } },
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText(/^The one edit that tripled/, {}, WAIT)).toBeVisible();
      await expect(view.getByText(/^My agent's morning/)).toBeVisible();
      // a long first line stops at its first sentence; the tags below it never show
      await expect(
        view.getByText(
          /^Day 3 of editing one reel a day and today it is the hook: the cut I almost threw away\.$/,
        ),
      ).toBeVisible();
      // the huge line is clamped: its hook is no taller than 8 lines
      const huge = view.getByText(/^one take no cuts/);
      await expect(huge.getBoundingClientRect().height).toBeLessThanOrEqual(8 * 14 * 1.35 + 1);
      // a picture with a hook below it has no alt of its own: no double reading
      await expect(view.queryByRole("img", { name: /^The one edit/ })).toBeNull();
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
