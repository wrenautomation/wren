/**
 * A page story for each client page no other story opens (designs/2026-11-05-story-parity.md): the
 * real page on the shared table, signed in as the client's owner, checked for its heading and main
 * actions.
 */
import type { Meta } from "@storybook/react-vite";
import { ACCOUNT_ANSWERS } from "./mocks/data/account.js";
import { OWNER } from "./mocks/data/me.js";
import { pageAt, shows } from "./mocks/page.js";

const meta: Meta = { title: "Client/Every page", id: "pages-client-places" };
export default meta;

// the account's reads (people, mail) sit in their own table
const answers = ACCOUNT_ANSWERS;

export const TodayNeedsYou = pageAt("/today/needs-you", {
  answers,
  check: shows("Needs you", "Answer"),
});
export const TodayApprove = pageAt("/today/approve", {
  answers,
  check: shows("To approve", "Approve"),
});
export const TodayMessages = pageAt("/today/messages", {
  answers,
  check: shows("Messages", "Reply"),
});
export const TodayCalls = pageAt("/today/calls", { answers, check: shows("Calls") });
export const ProjectPlan = pageAt("/project/plan", { answers, check: shows("Plan") });
export const ProjectUpdates = pageAt("/project/updates", { answers, check: shows("Updates") });
export const ProjectDeliverables = pageAt("/project/deliverables", {
  answers,
  check: shows("Deliverables", "Approve"),
});
export const ProjectResults = pageAt("/project/results", { answers, check: shows("Results") });
export const ProjectWelcome = pageAt("/project/welcome", {
  answers,
  check: shows("Welcome to Wren"),
});
export const CampaignsEmails = pageAt("/campaigns/emails", {
  answers,
  check: shows("Emails", "Approve"),
});
export const CampaignsReplies = pageAt("/campaigns/replies", {
  answers,
  check: shows("Replies", "Mark booked"),
});
export const CampaignsSetup = pageAt("/campaigns/setup", { answers, check: shows("Setup") });
export const CampaignsRun = pageAt("/campaigns/run", { answers, check: shows("Run") });
export const CampaignsPeople = pageAt("/campaigns/people", {
  answers,
  check: shows("People", "Mark called"),
});
export const CampaignsKeep = pageAt("/campaigns/keep", { answers, check: shows("Keep") });
/** The sample company's own page, from the top bar's chip. */
export const CampaignsReal = pageAt("/campaigns/real", {
  me: { ...OWNER, demo: true },
  answers,
  check: shows("What's real"),
});
export const CampaignsCalls = pageAt("/campaigns/calls", { answers, check: shows("Booked calls") });
export const CampaignsDrafts = pageAt("/campaigns/drafts", {
  answers,
  check: shows("Drafts", "Redraft"),
});
export const CampaignsContent = pageAt("/campaigns/content", { answers, check: shows("Posts") });
export const PeopleSent = pageAt("/people/sent", { answers, check: shows("Sent") });
export const PeopleTimeline = pageAt("/people/timeline", { answers, check: shows("Timeline") });
export const PeopleGroups = pageAt("/people/groups", {
  answers,
  check: shows("Groups", "New group"),
});
export const PeopleMembers = pageAt("/people/members", { answers, check: shows("Members") });
export const PeopleBroadcasts = pageAt("/people/broadcasts", {
  answers,
  check: shows("Broadcasts", "New broadcast"),
});
export const PeopleRecipients = pageAt("/people/recipients", {
  answers,
  check: shows("Recipients"),
});
export const PeopleImport = pageAt("/people/import", {
  answers,
  check: shows("Import", "Import a CSV"),
});
export const PeopleJourneys = pageAt("/people/journeys", { answers, check: shows("Journeys") });
export const OfficeContract = pageAt("/office/contract", {
  answers,
  check: shows("Contract", "Sign the contract"),
});
export const OfficePaperwork = pageAt("/office/paperwork", { answers, check: shows("Paperwork") });
export const OfficeDocuments = pageAt("/office/documents", {
  answers,
  check: shows("Documents", "New document"),
});
export const OfficeBilling = pageAt("/office/billing", { answers, check: shows("Billing") });
export const OfficePayLinks = pageAt("/office/pay-links", {
  answers,
  check: shows("Pay links", "New pay link"),
});
export const OfficeAccounts = pageAt("/office/accounts", { answers, check: shows("Accounts") });
export const OfficeYou = pageAt("/office/you", { answers, check: shows("Your settings") });
export const OfficeGrants = pageAt("/office/grants", {
  answers,
  check: shows("Grants", "Add grant"),
});
export const OfficeLook = pageAt("/office/look", { answers, check: shows("Look") });
/** A list page while its read is out, and once it is refused. */
export const ProjectPlanPending = pageAt("/project/plan", { answers, mode: "pending" });
export const ProjectPlanFails = pageAt("/project/plan", { answers, mode: "fails", lands: false });
