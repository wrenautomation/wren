/**
 * Pages and apps that moved, by their old address: the router sends an old link on to the new one
 * before anything draws, the rest of its path, search and hash kept. One table for every move, so
 * a link from a mail, a saved view, a pin or a ping still lands. Each target is final: one hop.
 * Places: designs/2026-11-04-portal-places.md; `moved.test.ts` checks every place page's old address.
 */

/** Old `/app/page` → new `/place/page`, where the page's id or place differs from its app's. */
export const MOVED: Readonly<Record<string, string>> = {
  "/account/people": "/office/team",
  "/calendar/calls": "/today/calls",
  "/calls/calls": "/campaigns/calls",
  "/campaigns/variants": "/variants/batches",
  "/calendar/recordings": "/today/recordings",
  "/calendar/schedule": "/today/calendar",
  "/clients/all": "/people/clients",
  "/documents/all": "/office/documents",
  "/engage/accounts": "/office/accounts",
  "/engage/approve": "/today/approve",
  "/engage/comments": "/today/comments",
  "/engage/dms": "/today/dms",
  "/engage/followers": "/campaigns/followers",
  "/engage/inbox": "/today/messages",
  "/inbox/approve": "/today/approve",
  "/inbox/comments": "/today/comments",
  "/inbox/dms": "/today/dms",
  "/inbox/messages": "/today/messages",
  "/inbox/waiting": "/today/messages",
  "/marketing/accounts": "/office/accounts",
  "/marketing/approve": "/today/approve",
  "/marketing/comments": "/today/comments",
  "/marketing/conversation": "/campaigns/conversation",
  "/marketing/dms": "/today/dms",
  "/marketing/engage": "/campaigns/engage",
  "/marketing/followers": "/campaigns/followers",
  "/marketing/inbox": "/today/messages",
  "/marketing/invites": "/campaigns/invites",
  "/marketing/more": "/campaigns/plan",
  "/money/overview": "/office/money",
  "/offers/all": "/map/offers",
  "/outbound/campaigns": "/campaigns/email-campaigns",
  "/outbound/overview": "/campaigns/email",
  "/offers/terms": "/map/terms",
  "/office/channel-accounts": "/office/accounts",
  "/office/inboxes": "/campaigns/inboxes",
  "/outreach/accounts": "/office/accounts",
  "/outreach/approve": "/today/approve",
  "/outreach/comments": "/today/comments",
  "/outreach/dms": "/today/dms",
  "/outreach/followers": "/campaigns/followers",
  "/outreach/inbox": "/today/messages",
  "/people/calls": "/campaigns/calls",
  "/people/followers": "/campaigns/followers",
  // The journey list is People's "In a journey" view (WA-1115).
  "/people/journeys": "/people/people",
  "/pipelines/journeys": "/people/people",
  "/results/board": "/campaigns/overview",
  "/pipeline/campaigns": "/campaigns/email-campaigns",
  "/pipelines/calls": "/campaigns/calls",
  "/pipeline/inboxes": "/campaigns/inboxes",
  "/team/all": "/office/team",
};

/** A gone place → where its pages went: every page not above keeps its id there. */
export const MOVED_APPS: Readonly<Record<string, string>> = {
  account: "office",
  calendar: "today",
  clients: "people",
  content: "campaigns",
  engage: "campaigns",
  inbox: "today",
  marketing: "campaigns",
  money: "office",
  outbound: "campaigns",
  outreach: "campaigns",
  pipelines: "people",
  reactivation: "campaigns",
  results: "campaigns",
  settings: "office",
  team: "office",
};

/** Where a client's own old page went, when it differs from Wren's. */
export const CLIENT_MOVED: Readonly<Record<string, string>> = {
  "/calls/calls": "/campaigns/calls",
  "/calls/overview": "/campaigns/calls",
  "/inbox/deliverables": "/project/deliverables",
  "/inbox/needs-you": "/today/needs-you",
  "/inbox/welcome": "/project/welcome",
  "/map/overview": "/project/overview",
  "/map/plan": "/project/plan",
  "/map/results": "/project/results",
  "/map/updates": "/project/updates",
  "/people/calls": "/campaigns/calls",
  "/payments/links": "/office/pay-links",
  "/results/board": "/project/results",
  "/reactivation/contract": "/office/contract",
  "/reactivation/deliverables": "/project/deliverables",
  "/reactivation/needs-you": "/today/needs-you",
  "/reactivation/paperwork": "/office/paperwork",
  "/reactivation/plan": "/project/plan",
  "/reactivation/results": "/project/results",
  "/reactivation/updates": "/project/updates",
  "/reactivation/welcome": "/project/welcome",
  "/variants/catalog": "/variants/batches",
  "/variants/pick": "/variants/batches",
  "/work/contract": "/office/contract",
  "/work/deliverables": "/project/deliverables",
  "/work/needs-you": "/today/needs-you",
  "/work/overview": "/project/overview",
  "/work/plan": "/project/plan",
  "/work/results": "/project/results",
  "/work/updates": "/project/updates",
  "/work/paperwork": "/office/paperwork",
  "/work/welcome": "/project/welcome",
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
 * Where an address moved to, or null: `/engage/dms/5?x=1` → `/today/dms/5?x=1`. A page's own
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
