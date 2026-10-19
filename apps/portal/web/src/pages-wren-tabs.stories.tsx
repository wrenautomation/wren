/**
 * Each tab of Wren's reshaped apps, as Wren's admin sees it, on the fake server
 * (designs/2026-10-19-portal-reshape.md): Content, Engage, Outbound, Ads, Analytics and Pipelines,
 * then the sidebar's four areas and a phone's dock. One story per visible tab, listed by hand:
 * a story is a static export. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Wren apps" };
export default meta;

// Content: one story per tab.
export const ContentPlan = pageAt("/content/plan", { me: ADMIN });
export const ContentStudio = pageAt("/content/studio", { me: ADMIN });
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
export const PipelinesFunnels = pageAt("/pipelines/funnels", { me: ADMIN });

/** Under 900px the sidebar is gone and the bottom tabs take over (`packages/ui/src/shell.tsx`). */
const onPhone = () => matchMedia("(max-width: 900px)").matches;
/** A name that starts a label, past a count badge ("1 Engage"). */
const named = (name: string) => new RegExp(`^(\\d+ )?${name}`);
/** How many links in `scope` carry this name: a page can show under its app too. */
const links = (scope: ReturnType<typeof within>, name: string) =>
  scope.queryAllByRole("link", { name: named(name) }).length;

/**
 * The sidebar at home: Primary and Marketing open, Tools shut, and no parked app. A phone has no
 * sidebar, so the look at phone width checks the bottom tabs in PhoneDock instead.
 */
export const SidebarAreas = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (onPhone()) return;
    const nav = within(await within(page).findByRole("navigation", { name: "Apps" }));
    const area = (name: string) => nav.getByRole("button", { name: named(name) });
    await expect(area("Primary")).toHaveAttribute("aria-expanded", "true");
    await expect(area("Marketing")).toHaveAttribute("aria-expanded", "true");
    await expect(area("Tools")).toHaveAttribute("aria-expanded", "false");
    for (const name of ["Pipelines", "People", "Content", "Engage", "Outbound", "Ads", "Analytics"])
      expect(links(nav, name), `${name} is in the sidebar`).toBeGreaterThan(0);
    // Parked apps keep their routes and their place in the command menu, not in the sidebar.
    for (const name of ["Notes", "Learn", "Voice"])
      expect(links(nav, name), `${name} is parked`).toBe(0);
  },
});

/** A phone's bottom tabs at home: Home (Today), Pipelines, Studio, Engage, then Apps. */
export const PhoneDock = pageAt("/", {
  me: ADMIN,
  check: async (page) => {
    if (!onPhone()) return;
    const dock = within(await within(page).findByRole("navigation", { name: "Tabs" }));
    for (const name of ["Home", "Pipelines", "Studio", "Engage"])
      expect(links(dock, name), `${name} is a tab`).toBe(1);
    await expect(dock.getByRole("button", { name: named("Apps") })).toBeVisible();
  },
});
