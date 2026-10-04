/** Reactivation: past clients checked for a reason to call, with a brief and an email for each. */
import type { Action } from "@wren/ui";
import type { Module } from "../../module.js";
import { ENGAGEMENT_PAGES, Feedback } from "../work/index.js";
import { EMAIL_ACTIONS, EMAIL_EMPTY, emailExtras, emailLegacy } from "./email.js";
import { Glance } from "./Glance.js";
import { REACTIVATION } from "./nav.js";
import { personExtras, personLegacy } from "./person.js";
import { Run } from "./Run.js";
import { REPLY_ACTIONS, REPLY_EMPTY, replyExtras } from "./reply.js";

const PERSON = "reactivation.person";
const EMAIL = "reactivation.email";
const REPLY = "reactivation.reply";
const people = (q: string) => `/${REACTIVATION}/people?${q}`;

const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

/** Only the wording; the sending rules are Wren's to change (the server's `EDITABLE`). */
const SETTING_ACTIONS: Action[] = [
  {
    id: "reactivation.change",
    label: "Change",
    handler: "reactivation/change",
    requires: { audience: "client" },
    key: "e",
    ask: { field: "value", label: "New wording", from: "value" },
    when: { id: ["emails.sells", "emails.voice", "emails.signature"] },
    done: () => "Changed",
  },
];

export const reactivation: Module = {
  id: REACTIVATION,
  name: "Reactivation",
  icon: "cycle",
  blurb:
    "Checks your past clients for a reason to call now. Each gets a brief and an email that waits for your OK.",
  Glance,
  action: { page: "run", label: "Watch it run", icon: "play" },
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        { label: "Call first", record: PERSON, href: people("view=call") },
        {
          label: "Drafts to approve",
          record: EMAIL,
          href: `/${REACTIVATION}/emails?view=approve`,
          needs: true,
        },
        { label: "Moved jobs", record: PERSON, href: people("view=all&now=moved") },
        { label: "Hiring", record: PERSON, href: people("view=all&now=hiring") },
        {
          label: "Emails sent",
          record: EMAIL,
          href: `/${REACTIVATION}/emails?view=sent`,
          period: 30,
          at: "lastSent",
        },
        { label: "Replies", record: REPLY, href: `/${REACTIVATION}/replies?view=all`, period: 30 },
        {
          label: "Meetings booked",
          record: REPLY,
          href: `/${REACTIVATION}/replies?view=booked`,
          period: 30,
        },
        { label: "Keep warm", record: PERSON, href: people("view=warm") },
        { label: "Emails that bounce", record: PERSON, href: people("view=all&email=invalid") },
        { label: "No email", record: PERSON, href: people("view=all&email=-") },
        { label: "No title", record: PERSON, href: people("view=all&title=-") },
        {
          label: "Quiet over a year",
          record: PERSON,
          href: people(`view=all&lastContact=..${yearAgo}`),
        },
      ],
      top: [
        {
          label: "Call first",
          record: PERSON,
          href: people("view=call"),
          fields: ["company", "score"],
          empty: "People who moved or whose firm is hiring show here once research finds them.",
        },
        {
          label: "Drafts to approve",
          record: EMAIL,
          href: `/${REACTIVATION}/emails?view=approve`,
          fields: ["company"],
          empty: EMAIL_EMPTY.approve,
        },
      ],
      // The review and the weekly pulse; the Friday mail's links land here.
      below: Feedback,
    },
    { id: "run", label: "Run", Page: Run },
    {
      id: "people",
      label: "People",
      template: "list",
      record: PERSON,
      empty: "Everyone on your list shows here once it loads, ranked by why to call now.",
      columns: ["title", "company", "now", "score", "lastContact", "email"],
      extras: personExtras,
      legacy: personLegacy,
    },
    {
      id: "emails",
      label: "Emails",
      template: "queue",
      record: EMAIL,
      empty: EMAIL_EMPTY,
      actions: EMAIL_ACTIONS,
      extras: emailExtras,
      legacy: emailLegacy,
    },
    {
      id: "replies",
      label: "Replies",
      template: "queue",
      record: REPLY,
      empty: REPLY_EMPTY,
      actions: REPLY_ACTIONS,
      extras: replyExtras,
    },
    {
      id: "setup",
      label: "Setup",
      template: "form",
      record: "reactivation.setting",
      empty: "Your setup shows here once Wren sets it up with you.",
      columns: ["value"],
      actions: SETTING_ACTIONS,
    },
    // The client's plan and paperwork, here and not in an app of their own.
    ...ENGAGEMENT_PAGES,
  ],
};
