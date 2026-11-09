/** Campaigns › Content: Studio and posts. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "../../../mocks/data/index.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { studioAnswers } from "../../../mocks/data/studio.js";
import { pageAt, shows, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Campaigns/Content" };
export default meta;

const LONG = { timeout: 5000 };

// Studio: the desk (due cards, New, the waiting table), then compose with a line and a kind chosen.
// The shape has two sample lines; a phone shows the same page narrower (the story tests run at 390).
const STUDIO = studioAnswers({
  get: ANSWERS["pipeline/recordsGet"] as (b: Record<string, unknown>) => unknown,
  list: ANSWERS["pipeline/recordsList"] as (b: Record<string, unknown>) => unknown,
});

/** Compose filled in: the sample post, a line and an angle picked, so each platform shows its version. */
const SAMPLE_POST = [
  "Most service sites list seven things they do.",
  "The ones that book calls list one.",
  "Last month I rebuilt an offer page down to a single line: who it is for, what changes in 30 days, the price. Three fewer sections.",
].join("\n\n");

export const Studio = pageAt("/campaigns/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    await expect(await view.findByRole("heading", { name: /still due this week/i })).toBeVisible();
    // The drafts: a table wide, a list on a phone; both carry the label.
    await expect(await view.findByLabelText("drafts", {}, { timeout: 5000 })).toBeVisible();
  },
});

/** A row's check approves in place: the row goes aside and the toast offers Undo. */
export const StudioApprove = tidy(
  pageAt("/campaigns/studio", {
    me: ADMIN,
    answers: STUDIO,
    check: async (page) => {
      const view = within(page);
      const row = "Behind the scenes: rebuilding the offer page";
      await userEvent.click(await view.findByRole("button", { name: `Approve ${row}` }));
      await waitFor(() => expect(view.queryByText(row)).toBeNull());
      await expect(
        await within(document.body).findByRole("button", { name: /undo/i }),
      ).toBeVisible();
    },
  }),
);

/**
 * Picked rows act together: a shift-click takes the run, Approve skips the one that lacks a field
 * and says why, Drop takes them all, and one toast offers Undo (WA-1174).
 */
export const StudioPick = tidy(
  pageAt("/campaigns/studio", {
    me: ADMIN,
    answers: STUDIO,
    check: async (page) => {
      const view = within(page);
      const box = (title: string) => view.findByRole("checkbox", { name: `Select ${title}` }, LONG);
      // a thread, then a run from the reply-rate post to the TikTok (rows in the server's order)
      const thread = "1/ A one-line offer page books more calls than a seven-section one.";
      const test =
        "We changed one thing after the first reply-rate test: the first line. Replies doubled.";
      const tiktok = "The offer page, cut live.";
      await userEvent.click(await box(thread));
      await userEvent.click(await box(test));
      await userEvent.keyboard("{Shift>}");
      await userEvent.click(await box(tiktok));
      await userEvent.keyboard("{/Shift}");
      await expect(await view.findByText("3 selected")).toBeVisible();
      await expect(view.getByText("Approve skips 1: fill in privacy first.")).toBeVisible();
      await userEvent.click(view.getByRole("button", { name: "Approve 2" }));
      await waitFor(() => expect(view.queryByText(thread)).toBeNull());
      expect(view.queryByText(test)).toBeNull();
      await expect(view.getByRole("button", { name: `Approve ${tiktok}` })).toBeDisabled();
      expect(view.queryByText(/ selected$/)).toBeNull();
      // its own toast fades in (an earlier hold's toast can still show)
      const line = await within(document.body).findByText(/Approved: 2 ideas/, {}, LONG);
      const toast = line.closest<HTMLElement>("[data-sonner-toast]");
      if (!toast) throw new Error("the line sits in a toast");
      const undo = within(toast).getByRole("button", { name: /undo/i });
      await waitFor(() => expect(undo).toBeVisible());
    },
  }),
);

/** A draft's title opens its platforms side by side in a sheet. */
export const StudioOpen = pageAt("/campaigns/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    // Not the draft the Approve story sets aside: its hold outlives that story.
    const title = "Most service sites list seven things they do.";
    await userEvent.click(await view.findByRole("button", { name: title }, { timeout: 5000 }));
    await expect(await within(document.body).findByRole("dialog")).toBeVisible();
  },
});

export const StudioCompose = pageAt(
  `/campaigns/studio?make=post&idea=${encodeURIComponent(SAMPLE_POST)}`,
  {
    me: ADMIN,
    answers: STUDIO,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: /offer builder/i }));
      await userEvent.click(await view.findByRole("button", { name: "Proof" }));
      await expect(await view.findByRole("button", { name: /approve and slot/i })).toBeEnabled();
      // The picked chip drops its focus ring: a shot of this story shows the page at rest.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    },
  },
);

export const Content = pageAt("/campaigns/content", { me: ADMIN });


export const Drafts = pageAt("/campaigns/drafts", {
  me: ADMIN,
  check: shows("Drafts", "Redraft"),
});

export const Videos = pageAt("/campaigns/videos", {
  me: ADMIN,
  check: shows("Recordings", "Approve"),
});

/** Write folded into Studio: its old links land on Studio's New. */
export const Write = pageAt("/campaigns/write", {
  me: ADMIN,
  lands: "/campaigns/studio",
  // "New" is the wide studio's; a phone has the New post link
  check: shows("Still due this week"),
});

export const Followers = pageAt("/campaigns/followers", { me: ADMIN });
