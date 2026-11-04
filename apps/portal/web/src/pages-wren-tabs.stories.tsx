/**
 * Each tab of Wren's reshaped apps that follows no artifact yet (Revamp), as Wren's admin sees it,
 * on the fake server (designs/2026-10-19-portal-reshape.md): Content, Ads, Analytics and
 * Pipelines. Studio, the sidebar and the dock are in `pages-wren-tabs-done.stories.tsx`; Engage
 * and Outbound in `pages-wren-tabs-port.stories.tsx`. One story per visible tab, listed by hand:
 * a story is a static export. `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Revamp/Wren apps", id: "pages-wren-apps" };
export default meta;

// Content: one story per tab.
export const ContentPieces = pageAt("/content/pieces", { me: ADMIN });
export const ContentContent = pageAt("/content/content", { me: ADMIN });
export const ContentOverview = pageAt("/content/overview", { me: ADMIN });
export const ContentExplore = pageAt("/campaigns/explore", { me: ADMIN });
export const ContentTopics = pageAt("/content/topics", { me: ADMIN });
export const ContentFacts = pageAt("/content/facts", { me: ADMIN });

// Ads: one story per tab.
export const AdsSets = pageAt("/campaigns/ads", { me: ADMIN });
export const AdsFormats = pageAt("/campaigns/formats", { me: ADMIN });

// Analytics: one story per tab.
export const AnalyticsVisits = pageAt("/campaigns/visits", { me: ADMIN });
export const AnalyticsSessions = pageAt("/campaigns/sessions", { me: ADMIN });
export const AnalyticsHeatmaps = pageAt("/campaigns/heatmaps", { me: ADMIN });
export const AnalyticsExperiments = pageAt("/campaigns/experiments", { me: ADMIN });
export const AnalyticsSurveys = pageAt("/campaigns/surveys", { me: ADMIN });
export const AnalyticsSurveyAnswers = pageAt("/campaigns/survey-answers", { me: ADMIN });
export const AnalyticsSearch = pageAt("/campaigns/visits", { me: ADMIN });
export const AnalyticsKeywords = pageAt("/campaigns/visits", { me: ADMIN });
export const AnalyticsAnswers = pageAt("/campaigns/visits", { me: ADMIN });
export const AnalyticsFunnel = pageAt("/campaigns/funnel", { me: ADMIN });

// Pipelines: one story per tab.
export const PipelinesBoard = pageAt("/people/board", { me: ADMIN });
export const PipelinesJourneys = pageAt("/people/journeys", { me: ADMIN });
