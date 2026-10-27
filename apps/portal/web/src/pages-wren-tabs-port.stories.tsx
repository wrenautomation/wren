/**
 * Engage and Outbound, one story per tab, as Wren's admin sees them, on the fake server. The Studio
 * and Marketing artifact draws both ("Marketing · inbound", "Marketing · outbound"); the pages
 * don't follow it yet. Same story ids as before the split (`pages-wren-apps--<app>-<tab>`).
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ANSWERS } from "./mocks/data/index.js";
import { LONG_INVITES } from "./mocks/data/long.js";
import { ADMIN } from "./mocks/data/me.js";
import { ownRows } from "./mocks/data/records.js";
import { pageAt, rowsFit } from "./mocks/page.js";

const meta: Meta = { title: "Ready to build/Engage and Outbound", id: "pages-wren-apps" };
export default meta;

// Engage: one story per tab.
export const EngageEngage = pageAt("/engage/engage", { me: ADMIN });
export const EngageDms = pageAt("/engage/dms", { me: ADMIN });
export const EngageInvites = pageAt("/engage/invites", { me: ADMIN });
/** Long names, roles and firms beside short figures: every word shows whole, no sideways scroll. */
const LONG = ownRows("marketing.invite", LONG_INVITES, ANSWERS);
export const EngageInvitesLong = pageAt("/engage/invites?view=all", {
  me: ADMIN,
  answers: LONG,
  check: rowsFit,
});
/** A row opened: the record beside the list, never over it. */
export const EngageInvitesLongOpen = pageAt("/engage/invites?view=all&invite=1", {
  me: ADMIN,
  answers: LONG,
  check: rowsFit,
});
export const EngagePeople = pageAt("/engage/people", { me: ADMIN });
export const EngageInbox = pageAt("/engage/inbox", { me: ADMIN });
/**
 * Engage's Inbox as a queue table (rows-everywhere F1, F2): its wait column reads late past 24h,
 * and "By type" folds the rows by kind, each fold with its count and oldest
 * wait. A fold shuts on a press.
 */
export const EngageInboxByType = pageAt("/engage/inbox?view=all", {
  me: ADMIN,
  check: async (page) => {
    const view = within(page);
    // A row that waited past its promise says so in its wait, as text.
    await waitFor(() => expect(page.querySelectorAll("[data-late]").length).toBeGreaterThan(0));
    // Only open threads read late: a thread already answered shows its age.
    const rows = page.querySelectorAll("tbody tr[data-index], li[data-index]").length;
    await expect(page.querySelectorAll("[data-late]").length).toBeLessThan(rows);
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
/** A comment opened: the whole comment docks beside the list (`peek: false`), never over it. */
export const EngageCommentsOpen = pageAt("/engage/comments?comment=1", {
  me: ADMIN,
  check: async (page) => {
    await rowsFit(page);
    // Docked, not a sheet over the rows: the record's panel starts right of the list.
    // A phone opens it in a sheet.
    if (window.innerWidth < 900) return;
    const list = page.querySelector("table[aria-label]")?.getBoundingClientRect();
    const open = await within(page).findByRole("complementary", { name: "Comment" });
    expect(open.getBoundingClientRect().left).toBeGreaterThanOrEqual(list?.right ?? 0);
  },
});
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
