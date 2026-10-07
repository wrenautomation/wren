/**
 * Setups for the accounts core already knows how to connect (designs/2026-10-07-setup-and-vendors.md):
 * Google's Search Console and Calendar, and Meta's partner link. The phone's and email's live
 * beside their channels.
 */
import { defineSetup } from "./setup.js";

export const SEARCH_CONSOLE_SETUP = defineSetup({
  id: "setup.search_console",
  name: "Search Console access",
  blurb: "Wren's service account reads your Search Console property.",
  site: "search_console",
  repeat: "7 days",
  steps: [
    {
      id: "service_account",
      fact: "search_console.service_account_added",
      label: "Wren's service account added",
      who: "client",
      how: "In Search Console, open Settings, then Users and permissions. Add Wren's service account as a user with Full access.",
      forYou: "Wren's team signs in to your Google account and adds the service account.",
      goal: "add Wren's service account as a Full user on this Search Console property",
      check: "search_console.access",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const GOOGLE_CALENDAR_SETUP = defineSetup({
  id: "setup.google_calendar",
  name: "Calendar access",
  blurb: "Wren's service account reads and books on your Google Calendar.",
  site: "google_calendar",
  repeat: "7 days",
  steps: [
    {
      id: "delegated",
      fact: "google_calendar.delegated",
      label: "Calendar scope allowed",
      who: "client",
      how: "Your Google Workspace admin opens Security, then API controls, then Domain-wide delegation, and adds Wren's service account with the calendar scope.",
      forYou: "Wren's team signs in as your Workspace admin and adds the delegation.",
      goal: "allow Wren's service account the calendar scope in domain-wide delegation",
      check: "google_calendar.access",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const META_SETUP = defineSetup({
  id: "setup.meta",
  name: "Meta partner link",
  blurb: "Wren's business works on your ad account as a partner.",
  site: "meta",
  repeat: "7 days",
  steps: [
    {
      id: "partner",
      fact: "meta.partner_added",
      label: "Wren added as a partner",
      who: "client",
      how: "In Meta Business Settings, open Partners, add Wren's business ID and share your ad account with it.",
      forYou: "Wren's team signs in to your Meta business and adds the partner.",
      goal: "add Wren's business as a partner on this ad account",
      check: "meta.ad_account",
      every: "1 hour",
      within: "14 days",
    },
    {
      id: "page",
      fact: "meta.page_shared",
      label: "Page shared with Wren",
      who: "client",
      how: "In Meta Business Settings, open Partners and share your Facebook Page with Wren's business too.",
      forYou: "Wren's team shares your Facebook Page with Wren's business.",
      goal: "share this business's Facebook Page with Wren's business as a partner",
      check: "meta.page",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const CORE_SETUPS = [SEARCH_CONSOLE_SETUP, GOOGLE_CALENDAR_SETUP, META_SETUP];
