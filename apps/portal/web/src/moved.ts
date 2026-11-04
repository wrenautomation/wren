/**
 * Pages and apps that moved, by their old address: the router sends an old link on to the new one
 * before anything draws, the rest of its path, search and hash kept. One table for every move, so
 * a link from a mail, a saved view, a pin or a ping still lands. Each target is final: one hop.
 * Places: designs/2026-11-04-portal-places.md; `moved.test.ts` checks every place page's old address.
 */

/** Old `/app/page` → new `/place/page`, where the page's id or place differs from its app's. */
export const MOVED: Readonly<Record<string, string>> = {
  "/account/people": "/office/team",
  "/account/review": "/office/access-review",
  "/ads/sets": "/campaigns/ads",
  "/analytics/answers": "/campaigns/visits",
  "/analytics/keywords": "/campaigns/visits",
  "/analytics/links": "/campaigns/visit-links",
  "/analytics/search": "/campaigns/visits",
  "/analytics/search-days": "/campaigns/visits",
  "/calls/overview": "/people/calls",
  "/clients/all": "/people/clients",
  "/clients/overview": "/people/client-overview",
  "/content/explore": "/campaigns/explore",
  "/content/feed": "/campaigns/feed",
  "/content/reports": "/map/reports",
  "/content/today": "/inbox/today",
  "/documents/all": "/office/documents",
  "/engage/accounts": "/office/channel-accounts",
  "/engage/approve": "/inbox/approve",
  "/engage/comments": "/inbox/comments",
  "/engage/dms": "/inbox/dms",
  "/engage/followers": "/people/followers",
  "/engage/inbox": "/inbox/messages",
  "/engage/people": "/people/contacts",
  "/engage/reviews": "/inbox/reviews",
  "/engage/subscribers": "/people/subscribers",
  "/handlers/ai": "/office/ai",
  "/inbox/calls": "/people/calls",
  "/inbox/waiting": "/inbox/messages",
  "/leads/overview": "/people/companies",
  "/leads/stalls": "/people/companies",
  "/library/media": "/content/media",
  "/marketing/accounts": "/office/channel-accounts",
  "/marketing/ads": "/campaigns/ads",
  "/marketing/answers": "/campaigns/visits",
  "/marketing/approve": "/inbox/approve",
  "/marketing/auto-reply": "/campaigns/auto-reply",
  "/marketing/comments": "/inbox/comments",
  "/marketing/conversation": "/campaigns/conversation",
  "/marketing/dm-copy": "/campaigns/dm-copy",
  "/marketing/dms": "/inbox/dms",
  "/marketing/engage": "/campaigns/engage",
  "/marketing/experiments": "/campaigns/experiments",
  "/marketing/explore": "/campaigns/explore",
  "/marketing/feed": "/campaigns/feed",
  "/marketing/followers": "/people/followers",
  "/marketing/funnel": "/campaigns/funnel",
  "/marketing/heatmaps": "/campaigns/heatmaps",
  "/marketing/inbox": "/inbox/messages",
  "/marketing/invites": "/campaigns/invites",
  "/marketing/keyword-dms": "/campaigns/keyword-dms",
  "/marketing/keywords": "/campaigns/keywords",
  "/marketing/links": "/campaigns/visit-links",
  "/marketing/more": "/content/plan",
  "/marketing/people": "/people/contacts",
  "/marketing/places": "/campaigns/places",
  "/marketing/reports": "/map/reports",
  "/marketing/reviews": "/inbox/reviews",
  "/marketing/search": "/campaigns/visits",
  "/marketing/search-days": "/campaigns/visits",
  "/marketing/sessions": "/campaigns/sessions",
  "/marketing/site": "/campaigns/visits",
  "/marketing/subscribers": "/people/subscribers",
  "/marketing/survey-answers": "/campaigns/survey-answers",
  "/marketing/surveys": "/campaigns/surveys",
  "/marketing/text-copy": "/campaigns/text-copy",
  "/marketing/texts": "/inbox/texts",
  "/marketing/threads": "/campaigns/threads",
  "/marketing/today": "/inbox/today",
  "/money/channels": "/map/channels",
  "/money/cohorts": "/map/cohorts",
  "/money/economics": "/map/economics",
  "/money/months": "/map/months",
  "/money/overview": "/office/money",
  "/numbers/funnels": "/map/shape",
  "/numbers/offers": "/map/offer-numbers",
  "/offers/all": "/map/offers",
  "/outbound/campaigns": "/campaigns/email-campaigns",
  "/outbound/companies": "/people/companies",
  "/outbound/inboxes": "/office/inboxes",
  "/outbound/overview": "/campaigns/email",
  "/outbound/sheet": "/people/companies",
  "/outbound/texts": "/inbox/texts",
  "/outreach/accounts": "/office/channel-accounts",
  "/outreach/approve": "/inbox/approve",
  "/outreach/comments": "/inbox/comments",
  "/outreach/dms": "/inbox/dms",
  "/outreach/followers": "/people/followers",
  "/outreach/inbox": "/inbox/messages",
  "/outreach/people": "/people/contacts",
  "/outreach/reviews": "/inbox/reviews",
  "/outreach/subscribers": "/people/subscribers",
  "/payments/links": "/office/pay-links",
  "/pipeline/campaigns": "/campaigns/email-campaigns",
  "/pipeline/companies": "/people/companies",
  "/pipeline/inboxes": "/office/inboxes",
  "/pipeline/overview": "/people/companies",
  "/pipeline/sheet": "/people/companies",
  "/pipeline/texts": "/inbox/texts",
  "/reactivation/contract": "/office/contract",
  "/reactivation/deliverables": "/inbox/deliverables",
  "/reactivation/needs-you": "/inbox/needs-you",
  "/reactivation/paperwork": "/office/paperwork",
  "/reactivation/plan": "/map/plan",
  "/reactivation/results": "/map/results",
  "/reactivation/updates": "/map/updates",
  "/reactivation/welcome": "/inbox/welcome",
  "/sites/answers": "/campaigns/visits",
  "/sites/funnel": "/campaigns/page-funnel",
  "/sites/keywords": "/campaigns/visits",
  "/sites/search": "/campaigns/visits",
  "/sites/search-days": "/campaigns/visits",
  "/sites/submissions": "/people/submissions",
  "/team/all": "/office/team",
  "/team/review": "/office/access-review",
  "/texts/calls": "/inbox/threads",
  "/texts/overview": "/inbox/threads",
  "/texts/reviews": "/inbox/threads",
  "/texts/speed": "/inbox/threads",
  "/work/contract": "/office/contract",
  "/work/deliverables": "/inbox/deliverables",
  "/work/needs-you": "/inbox/needs-you",
  "/work/paperwork": "/office/paperwork",
  "/work/welcome": "/inbox/welcome",
  "/workflows/holds": "/inbox/holds",
};

/** A gone app → its place: every page not above keeps its id there. */
export const MOVED_APPS: Readonly<Record<string, string>> = {
  account: "office",
  ads: "campaigns",
  analytics: "campaigns",
  calls: "people",
  clients: "people",
  deals: "people",
  documents: "office",
  engage: "campaigns",
  leads: "people",
  library: "map",
  marketing: "content",
  money: "office",
  numbers: "map",
  offers: "map",
  outbound: "campaigns",
  outreach: "campaigns",
  payments: "office",
  pipeline: "campaigns",
  pipelines: "people",
  reactivation: "campaigns",
  settings: "office",
  sites: "campaigns",
  team: "office",
  texts: "inbox",
  work: "map",
};

/** Where a client's own old page went, when it differs from Wren's (its search pages). */
export const CLIENT_MOVED: Readonly<Record<string, string>> = {
  "/marketing/keywords": "/map/reports",
  "/marketing/search": "/map/reports",
};

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

/** Whether this address moves elsewhere at a client, so where it goes depends on who asks. */
export const heldByClient = (href: string): boolean =>
  Object.hasOwn(CLIENT_MOVED, /^\/[^/?#]+\/[^/?#]+/.exec(href)?.[0] ?? "");

/**
 * Where an address moved to, or null: `/engage/dms/5?x=1` → `/inbox/dms/5?x=1`. A page's own
 * entry first (a client's own, at a client), else its app's place.
 */
export function movedTo(href: string, at: { atWren: boolean }): string | null {
  const app = appOf(href);
  const page = /^(\/[^/?#]+\/[^/?#]+)(.*)$/.exec(href);
  const key = page?.[1];
  const to = key ? (!at.atWren && CLIENT_MOVED[key]) || MOVED[key] : undefined;
  if (to) return `${to}${page?.[2] ?? ""}`;
  const renamed = Object.hasOwn(MOVED_APPS, app) ? MOVED_APPS[app] : undefined;
  return renamed ? `/${renamed}${href.slice(app.length + 1)}` : null;
}
