/**
 * Wren's own apps, in Wren's workspace only (team view): each an Overview of its numbers, then
 * its records on the templates. The console serves every record here.
 */

import { IN_HOUSE, totalOf } from "@wren/core/in-house";
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { Module } from "../../module.js";
import { inboxPages, managePages } from "../access/index.js";
import { PersonAccess } from "../access/PersonAccess.js";
import { ClientLook } from "../account/Look.js";
import { ClientAccounts, VendorUsage } from "../account/summary.js";
import { callsPage } from "../calls/index.js";
import { INBOX_PAGE } from "../marketing/index.js";
import { ClientComponents, ClientTemplates } from "../marketplace/Installed.js";
import { Ask } from "./ask.js";
import { FirmDossier } from "./dossier.js";
import { executionExtras } from "./executions.js";
import {
  CANDIDATE_ACTIONS,
  candidateExtras,
  EXPERIMENT_ACTIONS,
  experimentExtras,
  variantExtras,
} from "./experiments.js";
import { FLAG_ACTIONS } from "./flags.js";
import { handlers } from "./handlers.js";
import { AI_SPEND, AiSpend, idOf } from "./heads.js";
import { CLIENT_FLAG_ACTIONS, ClientHealth, HEALTH_ACTIONS, healthExtras } from "./health.js";
import { Infra } from "./infra.js";
import { MENTION_ACTIONS, mentionExtras } from "./mentions.js";
import { REPLY_ACTIONS } from "./replies.js";
import { Workflows } from "./workflows.js";

const TEAM = { audience: "team" } as const;
const overview = { id: "overview", label: "Overview", template: "overview" } as const;
const said = (line: string) => () => line;

const CAMPAIGN_ACTIONS: Action[] = [
  {
    id: "email.stopOpeners",
    label: "Stop openers",
    handler: "email/stopOpeners",
    undo: "email/resumeOpeners",
    bulk: true,
    when: { state: ["opening"] },
    done: said("Openers stopped"),
  },
  {
    id: "email.resumeOpeners",
    label: "Resume openers",
    handler: "email/resumeOpeners",
    undo: "email/stopOpeners",
    bulk: true,
    when: { state: ["follow_ups"] },
    done: said("Openers resumed"),
  },
  {
    id: "email.killSwitchOff",
    label: "Turn off kill switch",
    handler: "email/killSwitchOff",
    undo: "email/killSwitchOn",
    bulk: true,
    when: { killSwitch: ["on"] },
    done: said("Kill switch off"),
  },
  {
    id: "email.killSwitchOn",
    label: "Turn on kill switch",
    handler: "email/killSwitchOn",
    undo: "email/killSwitchOff",
    bulk: true,
    when: { killSwitch: ["off"] },
    done: said("Kill switch on"),
  },
];

const INBOX_ACTIONS: Action[] = [
  {
    id: "email.pause",
    label: "Pause",
    handler: "email/pause",
    ask: { field: "reason", label: "Why?" },
    undo: "email/resume",
    bulk: true,
    when: { state: ["sending"] },
    done: said("Paused"),
  },
  {
    id: "email.resume",
    label: "Resume",
    handler: "email/resume",
    confirm: "Start sending from it again?",
    bulk: true,
    when: { state: ["paused"] },
    done: said("Sending again"),
  },
];

const CLIENT_ACTIONS: Action[] = [
  {
    id: "console.addClient",
    label: "Add client",
    handler: "console/addClient",
    form: [
      { field: "name", label: "Name" },
      {
        field: "id",
        label: "Short name",
        hint: "Lowercase letters, numbers and underscores. It can't change later.",
        pattern: "[a-z][a-z0-9_]{0,39}",
        from: ({ name = "" }) => idOf(name),
      },
    ],
    done: (made) => `Added ${(made as { name?: string }).name ?? "the client"}`,
  },
  {
    // An owner, so they can invite the rest of their team from Account.
    id: "delivery.invite",
    label: "Invite",
    handler: "delivery/invite",
    each: true,
    form: [
      {
        field: "email",
        label: "Their work email",
        hint: "They sign in with it, as an owner: they invite the rest of their team.",
      },
    ],
    when: { kind: ["client"] },
    done: () => "Invited",
  },
];

const LOOP_ACTIONS: Action[] = [
  {
    id: "console.stopLoop",
    label: "Stop",
    handler: "console/stopLoop",
    undo: "console/startLoop",
    bulk: true,
    when: { state: ["running"] },
    done: said("Stopped"),
  },
  {
    id: "console.startLoop",
    label: "Start",
    handler: "console/startLoop",
    undo: "console/stopLoop",
    bulk: true,
    when: { state: ["stopped"] },
    done: said("Started"),
  },
];

export const outbound: Module = {
  id: "outbound",
  name: "Outbound",
  component: "email.sequences",
  icon: "mail",
  blurb: "Campaigns, the inboxes that send them, and the copy experiments.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Replies", record: "email.reply", href: "/inbox/replies?view=all", period: 30 },
        { label: "Booked", record: "email.call", href: "/inbox/calls?view=booked", period: 30 },
        {
          label: "Inboxes sending",
          record: "email.inbox",
          href: "/outbound/inboxes?view=sending",
        },
        {
          label: "Inboxes paused",
          record: "email.inbox",
          href: "/outbound/inboxes?view=paused",
          needs: true,
        },
        {
          label: "Campaigns opening",
          record: "email.campaign",
          href: "/outbound/campaigns?view=opening",
        },
        {
          label: "Copy waiting on you",
          record: "email.candidate",
          href: "/outbound/candidates?view=waiting",
          needs: true,
        },
        {
          label: "Experiments running",
          record: "email.experiment",
          href: "/outbound/experiments?view=running",
        },
      ],
      top: [
        {
          label: "Campaigns",
          record: "email.campaign",
          href: "/outbound/campaigns?view=all",
          fields: ["sent", "replyRate", "killSwitch"],
          empty: "No campaigns yet.",
        },
        {
          label: "Paused inboxes",
          record: "email.inbox",
          href: "/outbound/inboxes?view=paused",
          fields: ["reason", "pausedAt"],
          empty: "Every inbox is sending.",
        },
        {
          label: "Variants",
          record: "email.variant",
          href: "/outbound/variants",
          fields: ["replyRate"],
          empty: "No variant has sent yet.",
        },
      ],
    },
    {
      id: "campaigns",
      label: "Campaigns",
      template: "list",
      record: "email.campaign",
      empty: "Campaigns show here once they start.",
      actions: CAMPAIGN_ACTIONS,
    },
    {
      id: "inboxes",
      label: "Inboxes",
      template: "list",
      record: "email.inbox",
      empty: { paused: "Every inbox is sending.", sending: "No inbox is sending." },
      actions: INBOX_ACTIONS,
    },
    {
      id: "signals",
      label: "Signals",
      template: "list",
      record: "research.signal",
      empty: { fresh: "No signal in the last 30 days.", all: "No signals yet." },
    },
    {
      id: "variants",
      label: "Variants",
      template: "list",
      record: "email.variant",
      empty: "Variants show here once they send.",
      extras: variantExtras,
    },
    {
      id: "experiments",
      label: "Experiments",
      template: "list",
      record: "email.experiment",
      empty: {
        running: "No experiment is running. Start one on a template.",
        all: "Experiments show here once one starts.",
      },
      actions: EXPERIMENT_ACTIONS,
      extras: experimentExtras,
    },
    {
      id: "candidates",
      label: "Copy candidates",
      template: "queue",
      record: "email.candidate",
      empty: {
        waiting: "Nothing to review. The model writes new copy every few ticks.",
        approved: "Copy you approve shows here.",
        rejected: "Copy you turn down shows here.",
        all: "Model copy shows here once an experiment writes some.",
      },
      actions: CANDIDATE_ACTIONS,
      extras: candidateExtras,
    },
  ],
};

// The Monitor's hands (WatchConsole); William's own mail, so admins only.
const MAIL_ACTIONS: Action[] = [
  {
    id: "watch.done",
    label: "Done",
    handler: "watch/done",
    undo: "watch/undone",
    bulk: true,
    key: "e",
    when: { queue: ["needs_you"] },
    done: said("Done"),
  },
  {
    id: "watch.hide",
    label: "Hide like this",
    handler: "watch/hide",
    each: true,
    bulk: true,
    form: [
      {
        field: "subject",
        label: "Subject has",
        optional: true,
        hint: "Blank hides everything from this sender.",
      },
    ],
    when: { queue: ["needs_you", "done"] },
    done: said("Hidden. A rule holds mail like it from now on."),
  },
  {
    id: "watch.show",
    label: "Show like this",
    handler: "watch/show",
    each: true,
    bulk: true,
    form: [
      {
        field: "subject",
        label: "Subject has",
        optional: true,
        hint: "Blank shows everything from this sender.",
      },
    ],
    when: { queue: ["held", "dropped"] },
    done: said("Shown. A rule shows mail like it from now on."),
  },
  {
    id: "watch.sort",
    label: "Sort again",
    handler: "watch/sort",
    bulk: true,
    when: { queue: ["needs_you"] },
    done: said("Sorted again under today's rules."),
  },
];

const RULE_ACTIONS: Action[] = [
  {
    id: "watch.addRule",
    label: "Add rule",
    handler: "watch/addRule",
    form: [
      {
        field: "words",
        label: "Rule",
        hint: 'In plain words: "Inbox Insiders: hold invoices and receipts. Show order status changes."',
      },
      {
        field: "sender",
        label: "Sender",
        optional: true,
        hint: "An address or a domain. With a verdict, code settles it for $0.",
      },
      { field: "subject", label: "Subject has", optional: true },
      {
        field: "verdict",
        label: "Verdict",
        optional: true,
        hint: "show, hold or drop. Blank leaves it to the model.",
      },
    ],
    done: said("Rule added"),
  },
  {
    id: "watch.removeRule",
    label: "Remove",
    handler: "watch/removeRule",
    bulk: true,
    confirm: "Remove this rule? Mail it settled keeps its verdict.",
    done: said("Removed"),
  },
];

export const inbox: Module = {
  id: "inbox",
  name: "Inbox",
  component: "email.replies",
  icon: "reply",
  blurb: "Every lead's answer, by email, text or DM, and the mail that needs you.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Waiting on you",
          record: "marketing.inbox",
          href: "/inbox/waiting?view=waiting",
          needs: true,
        },
        {
          label: "To approve",
          record: "marketing.approval",
          href: "/marketing/approve?view=waiting",
          needs: true,
        },
        { label: "Replies", record: "email.reply", href: "/inbox/replies?view=all", period: 30 },
        { label: "Booked", record: "email.call", href: "/inbox/calls?view=booked", period: 30 },
        {
          label: "Mail that needs you",
          record: "watch.mail",
          href: "/inbox/mail?view=needs_you",
          needs: true,
        },
        // Yours only: the console reads the signed-in person's mentions (`mine`).
        {
          label: "Mentions",
          record: "notes.mention",
          href: "/inbox/mentions?view=unread",
          needs: true,
        },
        {
          label: "Issues for you",
          record: "access.issue",
          href: "/inbox/issues?view=waiting",
          needs: true,
        },
        {
          label: "Asks for access",
          record: "access.ask",
          href: "/inbox/asks?view=waiting",
          needs: true,
        },
      ],
      top: [
        {
          label: "Waiting on you",
          record: "marketing.inbox",
          href: "/inbox/waiting?view=waiting",
          fields: ["type", "at"],
          empty: "Nothing is waiting on you.",
        },
        {
          label: "Mail that needs you",
          record: "watch.mail",
          href: "/inbox/mail?view=needs_you",
          fields: ["sender", "at"],
          empty: "Nothing in your inboxes needs you.",
        },
      ],
    },
    // What came in, Marketing → Inbox's page; "waiting" keeps old links landing. What we'd send
    // waits in Marketing → To approve.
    { ...INBOX_PAGE, id: "waiting", label: "Waiting on you" },
    ...inboxPages(),
    {
      id: "mentions",
      label: "Mentions",
      template: "list",
      record: "notes.mention",
      empty: {
        unread: "Nothing new. When someone tags you with @ in a note, it shows here.",
        all: "When someone tags you with @ in a note or a comment, it shows here.",
      },
      columns: ["note", "words", "place", "by", "at"],
      actions: MENTION_ACTIONS,
      extras: mentionExtras,
      count: { state: ["unread"] },
    },
    {
      id: "replies",
      label: "Email replies",
      template: "queue",
      record: "email.reply",
      empty: {
        waiting: "Warm replies wait here, each with a draft answer.",
        booked: "Calls booked from a reply show here.",
        all: "Warm replies show here.",
      },
      actions: REPLY_ACTIONS,
    },
    callsPage("Calls booked on cal.com or our calendar show here."),
    {
      id: "mail",
      label: "Your mail",
      template: "list",
      record: "watch.mail",
      empty: {
        needs_you: "Nothing in your inboxes needs you.",
        held: "Mail the Monitor holds shows here, searchable.",
        done: "Mail you mark done shows here.",
        all: "Mail the Monitor reads shows here.",
      },
      actions: MAIL_ACTIONS,
    },
    {
      id: "rules",
      label: "Mail rules",
      template: "list",
      record: "watch.rule",
      empty: { all: "No rules yet. Hide like this on any email writes one." },
      actions: RULE_ACTIONS,
    },
  ],
};

export const loops: Module = {
  id: "loops",
  name: "Loops",
  icon: "clock",
  blurb: "Every scheduled job, which ones fail, and Wren's own settings.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Failing", record: "console.loop", href: "/loops/all?view=failing", needs: true },
        { label: "Stopped", record: "console.loop", href: "/loops/all?view=stopped" },
        { label: "Running", record: "console.loop", href: "/loops/all?view=all&state=running" },
      ],
      top: [
        {
          label: "Failing",
          record: "console.loop",
          href: "/loops/all?view=failing",
          fields: ["failures", "lastAt"],
          empty: "Nothing is failing.",
        },
      ],
    },
    {
      id: "all",
      label: "Loops",
      template: "list",
      record: "console.loop",
      empty: { failing: "Nothing is failing.", stopped: "Every loop is running." },
      actions: LOOP_ACTIONS,
    },
    {
      // Each edits in place with History and Undo (`console.setting`); saving needs `manage`.
      id: "settings",
      label: "Settings",
      template: "list",
      record: "console.setting",
      empty: { all: "No part that runs for Wren has settings." },
    },
    {
      // Rules, fallback and the kill switch edit in place, with History and Undo.
      id: "flags",
      label: "Flags",
      template: "list",
      record: "loops.flag",
      empty: { all: "No flags yet. New flag adds one; code reads it with useFlag." },
      actions: FLAG_ACTIONS,
    },
    { id: "infra", label: "Infra", Page: Infra },
  ],
};

// The options are BUCKETS and CHANNELS (books, core clients); BooksConsole refuses anything else.
const ACCOUNT_ACTIONS: Action[] = [
  {
    id: "books.setBucket",
    label: "Set bucket",
    handler: "books/setAccount",
    each: true,
    bulk: true,
    form: [
      {
        field: "bucket",
        label: "Bucket",
        optional: true,
        hint: "acquisition, delivery or overhead. Blank counts as overhead.",
      },
    ],
    when: { type: ["expense"] },
    done: said("Bucket set"),
  },
  {
    id: "books.setChannel",
    label: "Set channel",
    handler: "books/setAccount",
    each: true,
    bulk: true,
    form: [
      {
        field: "channel",
        label: "Channel",
        optional: true,
        hint: "email, sms, ads, content, search or reach. Blank splits it across channels by new clients.",
      },
    ],
    when: { type: ["expense"] },
    done: said("Channel set"),
  },
];

const MONTHS = "/money/months?view=all";
const NO_CLIENTS = "No paying clients yet";
/** A month's figure, the month before and a bar a month; `none` while it has no value. */
const figure = (label: string, pick: string, none = NO_CLIENTS) => ({
  label,
  record: "books.month",
  href: MONTHS,
  pick,
  none,
});

export const money: Module = {
  id: "money",
  name: "Money",
  component: "books",
  icon: "money",
  blurb: "What Wren spends, what renews soon, and what a client costs and earns.",
  requires: { ...TEAM, needs: "money" },
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Spend",
          record: "books.spend",
          href: "/money/spend?view=all",
          period: "month",
          sum: "amount",
        },
        {
          label: "AI spend",
          record: "books.spend",
          href: `/money/spend?view=all&${AI_SPEND}`,
          period: "month",
          sum: "amount",
        },
        {
          label: "Model calls",
          record: "email.model",
          href: "/money/models?view=all",
          period: "month",
          sum: "calls",
        },
        { label: "Subscriptions", record: "books.subscription", href: "/money/subscriptions" },
        {
          label: "Renewing soon",
          record: "books.subscription",
          href: "/money/subscriptions?view=soon",
          needs: true,
        },
      ],
      top: [
        {
          label: "Biggest spend this month",
          record: "books.spend",
          href: "/money/spend?view=this_month&sort=-amount",
          fields: ["account", "amount"],
          empty: "No spend this month yet.",
        },
        {
          label: "Renewing soon",
          record: "books.subscription",
          href: "/money/subscriptions?view=soon",
          fields: ["renewsOn", "cost"],
          empty: "Nothing renews soon.",
        },
      ],
    },
    {
      id: "spend",
      label: "Spend",
      template: "list",
      record: "books.spend",
      empty: "Spend shows here once the books import it.",
    },
    {
      id: "models",
      label: "Model usage",
      template: "list",
      record: "email.model",
      empty: "Model calls show here once a run makes them.",
      head: () => createElement(AiSpend),
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      template: "list",
      record: "books.subscription",
      empty: "Subscriptions show here once the books find them.",
    },
    {
      id: "in-house",
      label: "In-house",
      template: "list",
      record: "books.in_house",
      empty: {
        live: "No tool we built is live yet.",
        all: "Tools we built in place of a SaaS show here.",
      },
      // Money we didn't spend, not revenue: it never enters the ledger.
      head: () => {
        const { tools, monthly } = totalOf(IN_HOUSE);
        return createElement(
          "p",
          { className: "text-[13px] text-(--ui-ink-2)" },
          `${tools.length} live tools would cost about $${Math.round(monthly).toLocaleString("en-US")} a month bought. Not revenue; never in the ledger.`,
        );
      },
    },
    {
      id: "economics",
      label: "Economics",
      template: "overview",
      tiles: [
        figure("CAC", "cac6"),
        figure("Predicted LTV", "ltv", "No churn yet"),
        figure("LTV:CAC", "ltvCac", "No churn yet"),
        figure("Payback (months)", "payback"),
        figure("Logo churn", "logoChurn"),
        figure("Revenue churn", "revenueChurn"),
        figure("MRR", "mrr"),
        figure("ARPA", "arpa"),
        figure("Gross margin", "grossMargin"),
      ],
      top: [
        {
          label: "Cost per reply and per booked call this month",
          record: "books.channel",
          href: "/money/channels?view=this_month",
          fields: ["perReply", "perBooked"],
          empty: "No channel spent anything this month yet.",
        },
      ],
      below: () =>
        createElement(
          "p",
          { className: "mt-6 text-[13px] text-(--ui-ink-2)" },
          "Your own time isn't a cost here.",
        ),
    },
    {
      id: "months",
      label: "Months",
      template: "list",
      record: "books.month",
      empty: "Months show here once the books have spend.",
    },
    {
      id: "channels",
      label: "Channels",
      template: "list",
      record: "books.channel",
      empty: {
        this_month: "No channel spent anything this month yet.",
        all: "Channels show here once the books have spend.",
      },
    },
    {
      id: "cohorts",
      label: "Cohorts",
      template: "list",
      record: "books.cohort",
      empty: "Cohorts show here once a client pays.",
    },
    {
      id: "accounts",
      label: "Accounts",
      template: "list",
      record: "books.account",
      empty: { expenses: "No expense accounts yet.", all: "No accounts yet." },
      columns: ["type", "bucket", "channel"],
      actions: ACCOUNT_ACTIONS,
    },
  ],
};

/** The lead sheet's pages, under `base`: Wren's niches in Wren's workspace, a client's own in its. */
const sheetPages = (base: string): Module["pages"] => [
  {
    ...overview,
    tiles: [
      {
        label: "Companies found",
        record: "email.firm",
        href: `${base}/companies?view=in_play`,
        period: 30,
      },
      {
        label: "With a domain",
        record: "email.firm",
        href: `${base}/companies?view=with_domain`,
        period: 30,
      },
      {
        label: "Crawled",
        record: "email.firm",
        href: `${base}/companies?view=crawled`,
        period: 30,
      },
      {
        label: "Named a person",
        record: "email.firm",
        href: `${base}/companies?view=named`,
        period: 30,
      },
      {
        label: "Verified leads",
        record: "email.firm",
        href: `${base}/companies?view=lead`,
        period: 30,
      },
      {
        label: "Crawled, no person",
        record: "email.firm",
        href: `${base}/companies?view=crawled&named=-`,
        needs: true,
      },
      {
        label: "No domain yet",
        record: "email.firm",
        href: `${base}/companies?view=in_play&domain=-`,
      },
    ],
    top: [
      {
        label: "Newest verified leads",
        record: "email.firm",
        href: `${base}/companies?view=lead&sort=-lead`,
        fields: ["campaign", "lead"],
        empty: "No verified leads yet.",
      },
      {
        label: "Where companies stall",
        record: "email.stall",
        href: `${base}/stalls`,
        fields: ["queuedFirms", "catchAllLeads", "riskyLeads"],
        empty: "Nothing is stuck.",
      },
    ],
  },
  {
    id: "companies",
    label: "Companies",
    template: "list",
    record: "email.firm",
    empty: "Companies show here once a source finds them.",
    extras: (_, { client, row }) => ({
      sections: [["Dossier", createElement(FirmDossier, { client, id: String(row.id) })]],
    }),
  },
  {
    id: "stalls",
    label: "Stalls",
    template: "list",
    record: "email.stall",
    empty: "Nothing is stuck.",
  },
];

export const pipeline: Module = {
  id: "pipeline",
  name: "Pipeline",
  component: "research.lead_sheet",
  icon: "pulse",
  blurb: "Companies from found to verified lead, and where they stall.",
  requires: TEAM,
  pages: sheetPages("/pipeline"),
};

/** The same sheet in a client's workspace, read from its own database (O1). */
export const leads: Module = {
  id: "leads",
  name: "Lead sheet",
  component: "research.lead_sheet",
  icon: "pulse",
  blurb: "Companies from found to verified lead, and where they stall.",
  pages: sheetPages("/leads"),
};

export const clients: Module = {
  id: "clients",
  name: "Clients",
  icon: "people",
  blurb: "Every client, how each is doing, and what needs a look.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Clients", record: "console.client", href: "/clients/all?view=clients" },
        // Demos are accounts, not clients: both tiles count clients only.
        { label: "Added", record: "console.client", href: "/clients/all?view=clients", period: 30 },
        { label: "At risk", record: "console.health", href: "/clients/health?view=risk" },
        { label: "Watch", record: "console.health", href: "/clients/health?view=watch" },
        { label: "Open risks", record: "console.flag", href: "/clients/flags?view=risks" },
        // Yours only: open flags you own (`mine` on the view).
        {
          label: "Flags I own",
          record: "console.flag",
          href: "/clients/flags?view=mine",
          needs: true,
        },
        {
          label: "Opportunities",
          record: "console.flag",
          href: "/clients/flags?view=opportunities",
        },
        { label: "Stale scores", record: "console.health", href: "/clients/health?view=stale" },
      ],
      top: [
        {
          label: "Lowest health",
          record: "console.health",
          href: "/clients/health?view=all&sort=score",
          fields: ["score", "risks"],
          line: "weakest",
          empty: "Scores show here after the first nightly pass.",
        },
        {
          label: "Newest flags",
          record: "console.flag",
          href: "/clients/flags?view=open&sort=-raised",
          fields: ["side", "owner"],
          line: "name",
          empty: "Nothing flagged.",
        },
        {
          label: "Last seen",
          record: "console.client",
          href: "/clients/all?view=all&sort=-lastSeen",
          fields: ["members", "lastSeen"],
          empty: "Clients show here once you add one.",
        },
      ],
    },
    {
      id: "all",
      label: "Clients",
      template: "list",
      record: "console.client",
      empty: "Clients show here once you add one.",
      actions: CLIENT_ACTIONS,
      // Its portal look: the demo's too, so the demo can show one.
      extras: (_, { row }) => ({
        sections: [
          ["Health", createElement(ClientHealth, { client: String(row.id) })],
          ["Templates", createElement(ClientTemplates, { client: String(row.id) })],
          ["Components", createElement(ClientComponents, { client: String(row.id) })],
          ["Accounts", createElement(ClientAccounts, { client: String(row.id) })],
          ["Look", createElement(ClientLook, { client: String(row.id) })],
        ],
      }),
    },
    {
      id: "health",
      label: "Health",
      template: "list",
      record: "console.health",
      empty: {
        all: "Scores show here after the first nightly pass.",
        risk: "No client is at risk.",
        watch: "No client to watch.",
        stale: "Every score is fresh.",
        hand: "No score is set by hand.",
      },
      actions: HEALTH_ACTIONS,
      columns: ["name", "score", "band", "results", "engagement", "sentiment", "money", "risks"],
      extras: healthExtras,
    },
    {
      id: "flags",
      label: "Flags",
      template: "list",
      record: "console.flag",
      empty: {
        open: "Nothing flagged.",
        mine: "No open flag is yours. Take one to own it.",
        risks: "No open risks.",
        opportunities: "No open opportunities.",
        cleared: "Cleared flags show here.",
        all: "Flags show here once one is raised.",
      },
      actions: CLIENT_FLAG_ACTIONS,
      columns: ["what", "name", "side", "state", "owner", "raised"],
      count: { state: ["open"], side: ["risk"] },
    },
    {
      id: "days",
      label: "Health by day",
      template: "list",
      record: "console.health_day",
      hidden: true,
    },
    {
      id: "inputs",
      label: "Health inputs",
      template: "list",
      record: "console.health_input",
      hidden: true,
    },
    { id: "usage", label: "Vendor usage", Page: VendorUsage },
  ],
};

const ROLES = ["operator", "viewer", "admin"] as const;
const CLIENTS_HINT =
  'Client ids split by commas, and "wren" for Wren\'s own apps. Blank is every client.';
const TEAM_ACTS: Action[] = [
  {
    id: "console.teamInvite",
    label: "Invite",
    handler: "console/teamSet",
    form: [
      { field: "email", label: "Their work email", hint: "They sign in with it." },
      { field: "role", label: "Role", options: ROLES },
      { field: "clients", label: "Clients", optional: true, hint: CLIENTS_HINT },
    ],
    done: () => "Invited",
  },
  {
    id: "console.teamRole",
    label: "Change role",
    handler: "console/teamRole",
    each: true,
    form: [{ field: "role", label: "Role", options: ROLES }],
    done: said("Role changed"),
  },
  {
    id: "console.teamClients",
    label: "Set clients",
    handler: "console/teamClients",
    each: true,
    form: [{ field: "clients", label: "Clients", optional: true, hint: CLIENTS_HINT }],
    done: said("Clients set"),
  },
  {
    id: "console.teamRemove",
    label: "Remove",
    handler: "console/teamRemove",
    confirm: "Remove them from the team? They're signed out at once.",
    done: said("Removed"),
  },
];
const TEAM_ACTIONS = TEAM_ACTS.map((a): Action => ({ ...a, requires: { needs: "team" } }));

/** Wren's team: who signs in, as what, over which clients. An admin's alone. */
export const team: Module = {
  id: "team",
  name: "Team",
  // Roles and access; Clients has the people.
  icon: "shield",
  blurb: "Who on Wren's team signs in, their role, which clients they see, and who changed what.",
  requires: { ...TEAM, needs: "team" },
  pages: [
    {
      id: "all",
      label: "Team",
      template: "list",
      record: "console.team",
      empty: "Your team shows here once someone is invited.",
      actions: TEAM_ACTIONS,
      // Their role and extra grants, as sentences, with Add and End now.
      extras: (_detail, { client, row }) => ({
        sections: [
          [
            "Access",
            createElement(PersonAccess, {
              client,
              email: String(row.id),
              role: String(row.role),
            }),
          ],
        ],
      }),
    },
    ...managePages(true),
    {
      id: "changes",
      label: "Changes",
      template: "list",
      record: "console.change",
      empty: { today: "No changes today.", people: "Nobody changed anything by hand this week." },
      columns: ["at", "who", "op", "table", "row", "change"],
    },
  ],
};

/** The Friday review: each parked idea and whether what unparks it happened. */
export const review: Module = {
  id: "review",
  name: "Review",
  icon: "check",
  blurb: "Every parked idea, what unparks it, and a live check. Read it on Fridays.",
  requires: { ...TEAM, needs: "money" },
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Needs a look",
          record: "wren.parked",
          href: "/review/parked?view=look",
          needs: true,
        },
        { label: "You judge", record: "wren.parked", href: "/review/parked?view=manual" },
      ],
      top: [
        {
          label: "Needs a look",
          record: "wren.parked",
          href: "/review/parked?view=look",
          fields: ["state", "now"],
          empty: "No trigger fired.",
        },
      ],
    },
    {
      id: "parked",
      label: "Parked",
      template: "list",
      record: "wren.parked",
      empty: { look: "No trigger fired.", manual: "Nothing to judge by hand." },
    },
  ],
};

/** A failed step, again: the answer is the spine's tally for that one event. */
const EVENT_ACTIONS: Action[] = [
  {
    id: "console.retryEvent",
    label: "Retry",
    handler: "console/retryEvent",
    when: { state: ["failed"] },
    done: (a) => ((a as { failed?: number }).failed ? "Failed again" : "Ran again"),
  },
];

/** A hold let go: the unit runs again on the stage's next pass, or the source resumes. */
const HOLD_ACTIONS: Action[] = [
  {
    id: "console.releaseHold",
    label: "Release",
    handler: "console/releaseHold",
    when: { state: ["held", "due", "stuck", "paused"] },
    done: () => "Released. It runs on the next pass",
  },
];

/** Wren's business as its workflows, read only, with live numbers. */
export const workflows: Module = {
  id: "workflows",
  name: "Workflows",
  icon: "link",
  blurb: "How Wren wins clients and runs, drawn with live numbers.",
  requires: TEAM,
  pages: [
    { id: "canvas", label: "Canvas", Page: Workflows },
    {
      id: "runs",
      label: "Executions",
      template: "list",
      record: "console.execution",
      requires: { ...TEAM, needs: "read" },
      empty: {
        all: "Nothing has run through a workflow on the spine yet.",
        waiting: "Nothing is waiting.",
        failed: "Nothing has failed.",
        done: "Nothing has finished yet.",
      },
      extras: executionExtras,
    },
    {
      id: "events",
      label: "Events",
      template: "list",
      record: "console.event",
      empty: {
        failed: "No step has failed.",
        waiting: "Nothing is waiting on a wire.",
        all: "Nothing has entered a workflow yet.",
      },
      actions: EVENT_ACTIONS,
    },
    {
      id: "holds",
      label: "Holds",
      template: "list",
      record: "console.hold",
      empty: { open: "Nothing is held.", all: "Nothing was ever held." },
      actions: HOLD_ACTIONS,
    },
    {
      id: "checks",
      label: "Checks",
      template: "list",
      record: "console.check",
      empty: { all: "No check has run in 30 days." },
    },
  ],
};

export const ask: Module = {
  id: "ask",
  name: "Ask",
  icon: "search",
  blurb: "Ask Claude Code about the system. It reads the code and prod; it changes nothing.",
  requires: { ...TEAM, needs: "run" },
  pages: [{ id: "questions", label: "Questions", Page: Ask }],
};

export const WREN_APPS = [
  workflows,
  outbound,
  inbox,
  loops,
  money,
  pipeline,
  clients,
  team,
  handlers,
  review,
  ask,
];
