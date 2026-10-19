/**
 * Pages and apps that moved, by their old address: the router sends an old link on to the new one
 * before anything draws, the rest of its path, search and hash kept. One table for every move, so
 * a link from a mail, a saved view, a pin or a ping still lands (designs/2026-10-19-portal-reshape.md).
 */

/** Old `/app/page` → new `/app/page`, for a page that left its app. */
export const MOVED: Readonly<Record<string, string>> = {
  // Marketing's Outbound went to Outreach (2026-10-16), and Outreach is Engage now.
  ...Object.fromEntries(
    ["engage", "dms", "invites", "people", "threads", "places", "accounts", "dm-copy"].map((p) => [
      `/marketing/${p}`,
      `/engage/${p}`,
    ]),
  ),
  // The Marketing pages that talk with other people: Engage.
  ...Object.fromEntries(
    [
      "inbox",
      "approve",
      "comments",
      "reviews",
      "conversation",
      "followers",
      "subscribers",
      "auto-reply",
      "keywords",
      "keyword-dms",
    ].map((p) => [`/marketing/${p}`, `/engage/${p}`]),
  ),
  // Inbox kept the mail; what came in and what waits on a yes are Engage's.
  "/inbox/waiting": "/engage/inbox",
  "/inbox/approve": "/engage/approve",
  // The site's numbers: Analytics. Marketing's copies, then Sites' own.
  ...Object.fromEntries(
    [
      "funnel",
      "links",
      "sessions",
      "heatmaps",
      "experiments",
      "surveys",
      "survey-answers",
      "search-days",
      "search",
      "answers",
    ].map((p) => [`/marketing/${p}`, `/analytics/${p}`]),
  ),
  "/marketing/site": "/analytics/visits",
  ...Object.fromEntries(
    [
      "visits",
      "sessions",
      "heatmaps",
      "experiments",
      "surveys",
      "survey-answers",
      "search-days",
      "search",
      "keywords",
      "answers",
    ].map((p) => [`/sites/${p}`, `/analytics/${p}`]),
  ),
  // The texts are Outbound's.
  "/marketing/texts": "/outbound/texts",
  "/marketing/text-copy": "/outbound/text-copy",
  // Ads has its own app.
  "/marketing/ads": "/ads/sets",
  // The More page is gone: Plan is the app's front.
  "/marketing/more": "/content/plan",
  // The lead sheet's first page is Outbound's `sheet`.
  "/pipeline/overview": "/outbound/sheet",
};

/** An app whose id changed: every page of it, same id, in the new one. */
export const MOVED_APPS: Readonly<Record<string, string>> = {
  deals: "pipelines",
  outreach: "engage",
  pipeline: "outbound",
  marketing: "content",
};

/**
 * Old app ids a client's workspace also holds (its own Marketing and Sites). At a client these
 * addresses are live, so a move of them applies at Wren only (`moved.test.ts` checks the list
 * against the modules).
 */
export const CLIENT_HELD: ReadonlySet<string> = new Set(["marketing", "sites"]);

/**
 * Wren's own workspace: the team's, unless a link names a client (`?client=acme`). The shell and
 * the router both ask this one question.
 */
export const atWrenOf = (operator: boolean, named: string | null): boolean => operator && !named;

/** The client a link names (`?client=acme`), if it does. */
export const namedIn = (href: string): string | null =>
  new URL(href, "https://portal.invalid").searchParams.get("client");

/** The app an address opens, or "". */
const appOf = (href: string) => /^\/([^/?#]+)/.exec(href)?.[1] ?? "";

/** Whether a client's workspace also serves this address's app, so where it moves depends on who asks. */
export const heldByClient = (href: string): boolean => CLIENT_HELD.has(appOf(href));

/**
 * Where an address moved to, or null: `/marketing/dms/5?x=1` → `/engage/dms/5?x=1`. A page's own
 * entry first, else its app's new id. An app a client also holds moves only at Wren.
 */
export function movedTo(href: string, at: { atWren: boolean }): string | null {
  const app = appOf(href);
  if (!at.atWren && CLIENT_HELD.has(app)) return null;
  const page = /^(\/[^/?#]+\/[^/?#]+)(.*)$/.exec(href);
  const to = page?.[1] ? MOVED[page[1]] : undefined;
  if (to) return `${to}${page?.[2] ?? ""}`;
  const renamed = Object.hasOwn(MOVED_APPS, app) ? MOVED_APPS[app] : undefined;
  return renamed ? `/${renamed}${href.slice(app.length + 1)}` : null;
}
