/**
 * A page story for each Wren page no other story opens (designs/2026-11-05-story-parity.md): the
 * real page on the shared table, checked for its heading and main actions.
 */
import type { Meta } from "@storybook/react-vite";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt, shows } from "./mocks/page.js";

const meta: Meta = { title: "Wren/Every page", id: "pages-team-places" };
export default meta;

export const TodayReplies = pageAt("/today/replies", {
  me: ADMIN,
  check: shows("Email replies", "Send"),
});
export const TodayMentions = pageAt("/today/mentions", {
  me: ADMIN,
  check: shows("Mentions", "Mark read"),
});
export const TodayIssues = pageAt("/today/issues", {
  me: ADMIN,
  check: shows("Issues", "Resolve"),
});
export const TodayAsks = pageAt("/today/asks", {
  me: ADMIN,
  check: shows("Access asks", "Approve"),
});
export const TodayRules = pageAt("/today/rules", {
  me: ADMIN,
  check: shows("Mail rules", "Add rule"),
});
export const TodayCalls = pageAt("/today/calls", { me: ADMIN, check: shows("Calls") });
export const TodayRecordings = pageAt("/today/recordings", {
  me: ADMIN,
  check: shows("Recordings"),
});
export const CampaignsDrafts = pageAt("/campaigns/drafts", {
  me: ADMIN,
  check: shows("Drafts", "Redraft"),
});
export const CampaignsVideos = pageAt("/campaigns/videos", {
  me: ADMIN,
  check: shows("Recordings", "Approve"),
});
export const CampaignsCalls = pageAt("/campaigns/calls", {
  me: ADMIN,
  check: shows("Booked calls"),
});
export const PeopleTimeline = pageAt("/people/timeline", { me: ADMIN, check: shows("Timeline") });
export const OfficeSpend = pageAt("/office/spend", { me: ADMIN, check: shows("Spend") });
export const OfficeModels = pageAt("/office/models", { me: ADMIN, check: shows("Model usage") });
export const OfficePaymentsIn = pageAt("/office/payments-in", {
  me: ADMIN,
  check: shows("Payments in"),
});
export const OfficeSubscriptions = pageAt("/office/subscriptions", {
  me: ADMIN,
  check: shows("Subscriptions"),
});
export const OfficeGrants = pageAt("/office/grants", {
  me: ADMIN,
  check: shows("Grants", "Add grant"),
});
export const OfficeLook = pageAt("/office/look", { me: ADMIN, check: shows("Look", "Save") });
/** Write folded into Studio: its old links land on Studio's New. */
export const CampaignsWrite = pageAt("/campaigns/write", {
  me: ADMIN,
  lands: "/campaigns/studio",
  // "New" is the wide studio's; a phone has the New post link
  check: shows("Still due this week"),
});
/** A list page while its read is out, and once it is refused. */
export const OfficeSpendPending = pageAt("/office/spend", { me: ADMIN, mode: "pending" });
export const OfficeSpendFails = pageAt("/office/spend", { me: ADMIN, mode: "fails", lands: false });
