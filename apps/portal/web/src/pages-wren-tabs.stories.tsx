/**
 * Each tab of Wren's reshaped apps, as Wren's admin sees it, on the fake server
 * (designs/2026-10-19-portal-reshape.md): Content, Engage, Outbound, Ads, Analytics and Pipelines,
 * then the sidebar's four areas and a phone's dock. One story per visible tab, listed by hand:
 * a story is a static export. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "./mocks/data/index.js";
import { ADMIN } from "./mocks/data/me.js";
import { studioAnswers } from "./mocks/data/studio.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Wren apps" };
export default meta;

// Content: one story per tab.
export const ContentPlan = pageAt("/content/plan", { me: ADMIN });

// Studio: the desk (due cards, New, the waiting table), then compose with a line and a kind chosen.
// The shape has two sample lines; a phone shows the same page narrower (the story tests run at 390).
const STUDIO = studioAnswers({
  get: ANSWERS["pipeline/recordsGet"] as (b: Record<string, unknown>) => unknown,
  list: ANSWERS["pipeline/recordsList"] as (b: Record<string, unknown>) => unknown,
});
export const ContentStudio = pageAt("/content/studio", {
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
export const ContentStudioApprove = pageAt("/content/studio", {
  me: ADMIN,
  answers: STUDIO,
  check: async (page) => {
    const view = within(page);
    const row = "Behind the scenes: rebuilding the offer page";
    await userEvent.click(await view.findByRole("button", { name: `Approve ${row}` }));
    await waitFor(() => expect(view.queryByText(row)).toBeNull());
    await expect(await within(document.body).findByRole("button", { name: /undo/i })).toBeVisible();
  },
});
/** A draft's title opens its platforms side by side in a sheet. */
export const ContentStudioOpen = pageAt("/content/studio", {
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
/** Compose filled in: the sample post, a line and an angle picked, so each platform shows its version. */
const SAMPLE_POST = [
  "Most service sites list seven things they do.",
  "The ones that book calls list one.",
  "Last month I rebuilt an offer page down to a single line: who it is for, what changes in 30 days, the price. Three fewer sections.",
].join("\n\n");
export const ContentStudioCompose = pageAt(
  `/content/studio?make=post&idea=${encodeURIComponent(SAMPLE_POST)}`,
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
export const ContentPieces = pageAt("/content/pieces", { me: ADMIN });
export const ContentContent = pageAt("/content/content", { me: ADMIN });
export const ContentOverview = pageAt("/content/overview", { me: ADMIN });
export const ContentFeed = pageAt("/content/feed", { me: ADMIN });
export const ContentTopics = pageAt("/content/topics", { me: ADMIN });
export const ContentFacts = pageAt("/content/facts", { me: ADMIN });

// Engage: one story per tab.
export const EngageEngage = pageAt("/engage/engage", { me: ADMIN });
export const EngageDms = pageAt("/engage/dms", { me: ADMIN });
export const EngageInvites = pageAt("/engage/invites", { me: ADMIN });
export const EngagePeople = pageAt("/engage/people", { me: ADMIN });
export const EngageInbox = pageAt("/engage/inbox", { me: ADMIN });
/**
 * Engage's Inbox as a queue table (rows-everywhere F1, F2): its wait column reads late past 24h,
 * the foot counts them, and "By type" folds the rows by kind, each fold with its count and oldest
 * wait. A fold shuts on a press.
 */
export const EngageInboxByType = pageAt("/engage/inbox?view=all", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    // A row that waited past its promise says so in its wait, as text.
    await waitFor(() => expect(page.querySelectorAll("[data-late]").length).toBeGreaterThan(0));
    // The foot counts them (Late and Oldest hide on a phone).
    await expect(await view.findByText("Count")).toBeVisible();
    // Only open threads read late: a thread already answered shows its age and is not counted.
    const foot = (await view.findByText("Count")).parentElement?.parentElement;
    const nums = Array.from(foot?.querySelectorAll("b") ?? []).map((b) => Number(b.textContent));
    await expect(nums[0]).toBeGreaterThan(0);
    await expect(nums[1] ?? 0).toBeLessThan(nums[0] ?? 0);
    await userEvent.click(await view.findByRole("link", { name: "By type" }));
    const fold = await view.findByRole("button", { name: /DM/ });
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    // Two groups show, each its own fold.
    await expect(await view.findByRole("button", { name: /Comment/ })).toBeVisible();
    await userEvent.click(fold);
    await expect(fold).toHaveAttribute("aria-expanded", "false");
  },
});
export const EngageApprove = pageAt("/engage/approve", { me: ADMIN });
export const EngageComments = pageAt("/engage/comments", { me: ADMIN });
export const EngageReviews = pageAt("/engage/reviews", { me: ADMIN });
export const EngageConversation = pageAt("/engage/conversation", { me: ADMIN });
export const EngageFollowers = pageAt("/engage/followers", { me: ADMIN });
export const EngageSubscribers = pageAt("/engage/subscribers", { me: ADMIN });
export const EngageThreads = pageAt("/engage/threads", { me: ADMIN });
export const EngagePlaces = pageAt("/engage/places", { me: ADMIN });
export const EngageAccounts = pageAt("/engage/accounts", { me: ADMIN });
export const EngageDmCopy = pageAt("/engage/dm-copy", { me: ADMIN });
export const EngageAutoReply = pageAt("/engage/auto-reply", { me: ADMIN });
export const EngageKeywords = pageAt("/engage/keywords", { me: ADMIN });
export const EngageKeywordDms = pageAt("/engage/keyword-dms", { me: ADMIN });

// Outbound: one story per tab.
export const OutboundOverview = pageAt("/outbound/overview", { me: ADMIN });
export const OutboundCampaigns = pageAt("/outbound/campaigns", { me: ADMIN });
export const OutboundInboxes = pageAt("/outbound/inboxes", { me: ADMIN });
export const OutboundSignals = pageAt("/outbound/signals", { me: ADMIN });
export const OutboundSheet = pageAt("/outbound/sheet", { me: ADMIN });
export const OutboundCompanies = pageAt("/outbound/companies", { me: ADMIN });
export const OutboundStalls = pageAt("/outbound/stalls", { me: ADMIN });
export const OutboundTexts = pageAt("/outbound/texts", { me: ADMIN });
export const OutboundTextCopy = pageAt("/outbound/text-copy", { me: ADMIN });

// Ads: one story per tab.
export const AdsSets = pageAt("/ads/sets", { me: ADMIN });
export const AdsFormats = pageAt("/ads/formats", { me: ADMIN });

// Analytics: one story per tab.
export const AnalyticsVisits = pageAt("/analytics/visits", { me: ADMIN });
export const AnalyticsSessions = pageAt("/analytics/sessions", { me: ADMIN });
export const AnalyticsHeatmaps = pageAt("/analytics/heatmaps", { me: ADMIN });
export const AnalyticsExperiments = pageAt("/analytics/experiments", { me: ADMIN });
export const AnalyticsSurveys = pageAt("/analytics/surveys", { me: ADMIN });
export const AnalyticsSurveyAnswers = pageAt("/analytics/survey-answers", { me: ADMIN });
export const AnalyticsSearch = pageAt("/analytics/search", { me: ADMIN });
export const AnalyticsKeywords = pageAt("/analytics/keywords", { me: ADMIN });
export const AnalyticsAnswers = pageAt("/analytics/answers", { me: ADMIN });
export const AnalyticsFunnel = pageAt("/analytics/funnel", { me: ADMIN });

// Pipelines: one story per tab.
export const PipelinesBoard = pageAt("/pipelines/board", { me: ADMIN });
export const PipelinesJourneys = pageAt("/pipelines/journeys", { me: ADMIN });

/** Under 900px the sidebar is gone and the bottom tabs take over (`packages/ui/src/shell.tsx`). */
const onPhone = () => matchMedia("(max-width: 900px)").matches;
/** A name that starts a label, past a count badge ("1 Engage"). */
const named = (name: string) => new RegExp(`^(\\d+ )?${name}`);
/** How many links in `scope` carry this name: a page can show under its app too. */
const links = (scope: ReturnType<typeof within>, name: string) =>
  scope.queryAllByRole("link", { name: named(name) }).length;

/**
 * The sidebar at home: the Map, then Inbox, People, Money and Admin, and no other app. Parked and
 * unpinned apps keep their routes and their place in ⌘K, not in the sidebar. A phone has no
 * sidebar, so the look at phone width checks the bottom tabs in PhoneDock instead.
 */
export const SidebarItems = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (onPhone()) return;
    const nav = within(await within(page).findByRole("navigation", { name: "Apps" }));
    for (const name of ["Inbox", "People", "Money", "Admin"])
      expect(links(nav, name), `${name} is in the sidebar`).toBeGreaterThan(0);
    for (const name of ["Pipelines", "Content", "Engage", "Outbound", "Ads", "Analytics"])
      expect(links(nav, name), `${name} opens from the Map, not the sidebar`).toBe(0);
    for (const name of ["Notes", "Learn", "Voice"])
      expect(links(nav, name), `${name} is parked`).toBe(0);
    await expect(within(page).getAllByRole("link", { name: named("Map") }).length).toBeGreaterThan(
      0,
    );
  },
});

/** A phone's bottom tabs at home: the Map, Inbox, People, then Apps. */
export const PhoneDock = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (!onPhone()) return;
    const dock = within(await within(page).findByRole("navigation", { name: "Tabs" }));
    for (const name of ["Map", "Inbox", "People"])
      expect(links(dock, name), `${name} is a tab`).toBe(1);
    await expect(dock.getByRole("button", { name: named("Apps") })).toBeVisible();
  },
});
