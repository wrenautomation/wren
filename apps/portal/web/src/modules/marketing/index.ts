/**
 * Marketing (designs/2026-10-05-marketing-app.md): content, ads, search, texts and site visits
 * as one funnel, in Wren's workspace. Records and templates only; the console serves them.
 */
import type { Action } from "@wren/ui";
import type { Module } from "../../module.js";
import { WeeklyBookings } from "./chart.js";
import { copyExtras, copyPreview, dmExtras, dmPreview } from "./dms.js";
import { draftPreview, postExtras } from "./posts.js";

const said = (line: string) => () => line;

const POST_ACTIONS: Action[] = [
  {
    id: "marketing.draftAgain",
    label: "Draft again",
    handler: "marketing/draftAgain",
    confirm: "Draft this idea again for this platform?",
    done: said("Drafting. It shows in the content desk."),
  },
];

const WAITING = { state: ["draft", "failed"] };
const OPEN = { state: ["draft", "failed", "approved"] };
const DRAFT_ACTIONS: Action[] = [
  {
    id: "marketing.approveDraft",
    label: "Approve",
    handler: "marketing/approveDraft",
    confirm: "Post this at its platform's next slot?",
    key: "a",
    bulk: true,
    when: WAITING,
    done: said("Scheduled at its next slot"),
  },
  {
    id: "marketing.editDraft",
    label: "Edit",
    handler: "marketing/editDraft",
    ask: { field: "text", label: "Your words", from: "text", preview: draftPreview },
    key: "e",
    when: OPEN,
    done: said("Saved. It waits for your yes again."),
  },
  {
    id: "marketing.redraft",
    label: "Redraft",
    handler: "marketing/redraft",
    ask: { field: "note", label: "What to change" },
    when: OPEN,
    done: said("Redrafting. The new one shows here."),
  },
  {
    id: "marketing.rejectDraft",
    label: "Reject",
    handler: "marketing/rejectDraft",
    confirm: "Turn this draft down?",
    key: "r",
    bulk: true,
    when: OPEN,
    done: said("Rejected"),
  },
];

const AD_ACTIONS: Action[] = [
  {
    id: "marketing.pause",
    label: "Pause",
    handler: "marketing/pause",
    ask: { field: "reason", label: "Why?" },
    when: { state: ["active"] },
    done: said("Paused"),
  },
  {
    // It spends again: asked every time, never an undo.
    id: "marketing.resume",
    label: "Resume",
    handler: "marketing/resume",
    confirm: "Start spending on it again at its budget?",
    when: { state: ["paused", "stopped"] },
    done: said("Running again"),
  },
];

const TEXT_ACTIONS: Action[] = [
  {
    id: "marketing.markRead",
    label: "Mark read",
    handler: "marketing/markRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];

const DM_ACTIONS: Action[] = [
  {
    id: "marketing.dmReply",
    label: "Reply",
    handler: "marketing/dmReply",
    ask: { field: "body", label: "Your reply", preview: dmPreview },
    key: "r",
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.dmRead",
    label: "Mark read",
    handler: "marketing/dmRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];

const DM_COPY_ACTIONS: Action[] = [
  {
    id: "marketing.dmCopy",
    label: "Edit",
    handler: "marketing/dmCopy",
    ask: { field: "body", label: "Your words", from: "body", preview: copyPreview },
    key: "e",
    done: said("Saved"),
  },
];

export const marketing: Module = {
  id: "marketing",
  name: "Marketing",
  component: "marketing.stats",
  icon: "board",
  blurb: "What content, ads, search and texts bring to the site, and what they cost.",
  requires: { audience: "team" },
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        {
          label: "Content views",
          record: "marketing.post",
          href: "/marketing/content?view=all",
          period: "month",
          sum: "views",
        },
        {
          label: "Ad impressions",
          record: "marketing.ad_day",
          href: "/marketing/ads?view=campaign",
          period: "month",
          sum: "impressions",
        },
        {
          label: "Search impressions",
          record: "marketing.search_day",
          href: "/marketing/search-days?view=all",
          period: "month",
          sum: "impressions",
        },
        {
          label: "Site visits",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "visits",
        },
        {
          label: "Forms",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "forms",
        },
        {
          label: "Booking clicks",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "bookings",
        },
        {
          label: "Ad spend",
          record: "marketing.ad_day",
          href: "/marketing/ads?view=campaign",
          period: "month",
          sum: "spend",
        },
        {
          label: "Drafts waiting",
          record: "marketing.draft",
          href: "/marketing/drafts?view=waiting",
          needs: true,
        },
        {
          label: "Texts waiting",
          record: "marketing.text_contact",
          href: "/marketing/texts?view=waiting",
          needs: true,
        },
        {
          label: "DMs waiting",
          record: "marketing.dm",
          href: "/marketing/dms?view=waiting",
          needs: true,
        },
      ],
      top: [
        {
          label: "Top posts",
          record: "marketing.post",
          href: "/marketing/content?view=top",
          fields: ["views", "engagement"],
          empty: "No post has numbers yet.",
        },
        {
          label: "Top keywords",
          record: "marketing.keyword",
          href: "/marketing/keywords?view=active",
          fields: ["clicks", "impressions"],
          empty: "No keyword has impressions yet.",
        },
      ],
      below: WeeklyBookings,
    },
    {
      id: "content",
      label: "Content",
      template: "list",
      record: "marketing.post",
      empty: "Posts show here once one is published.",
      actions: POST_ACTIONS,
      extras: postExtras,
    },
    {
      id: "drafts",
      label: "Drafts",
      template: "list",
      record: "marketing.draft",
      empty: {
        waiting: "No draft waits on you.",
        scheduled: "Nothing is scheduled.",
        rejected: "Nothing was turned down.",
      },
      actions: DRAFT_ACTIONS,
      extras: postExtras,
    },
    {
      id: "ads",
      label: "Ads",
      template: "list",
      record: "marketing.ad_day",
      empty: "Ad days show here once an ad runs.",
      actions: AD_ACTIONS,
      extras: postExtras,
    },
    {
      id: "search",
      label: "Search",
      template: "list",
      record: "marketing.search_page",
      empty: { not_indexed: "Every checked page is indexed.", all: "No page checked yet." },
    },
    {
      id: "keywords",
      label: "Keywords",
      template: "list",
      record: "marketing.keyword",
      empty: "Keywords show here once search runs.",
    },
    {
      id: "answers",
      label: "AI answers",
      template: "list",
      record: "marketing.answer",
      empty: "AI answers show here once one is asked.",
    },
    {
      id: "texts",
      label: "Texts",
      template: "list",
      record: "marketing.text_contact",
      empty: { waiting: "No reply waits on you.", texted: "No one texted yet." },
      actions: TEXT_ACTIONS,
    },
    {
      id: "dms",
      label: "DMs",
      template: "list",
      record: "marketing.dm",
      empty: {
        waiting: "No DM waits on you.",
        replied: "No one replied yet.",
        all: "Threads show here once reach messages someone.",
      },
      actions: DM_ACTIONS,
      extras: dmExtras,
    },
    {
      id: "dm-copy",
      label: "DM copy",
      template: "list",
      record: "marketing.dm_copy",
      empty: { empty: "Every slot has words.", all: "No reach sequence has slots." },
      actions: DM_COPY_ACTIONS,
      extras: copyExtras,
    },
    {
      id: "site",
      label: "Site",
      template: "list",
      record: "marketing.site_day",
      empty: "Site days show here once the lander export is read.",
    },
    {
      id: "search-days",
      label: "Search days",
      hidden: true,
      template: "list",
      record: "marketing.search_day",
      empty: "Search days show here once Search Console is read.",
    },
  ],
};
