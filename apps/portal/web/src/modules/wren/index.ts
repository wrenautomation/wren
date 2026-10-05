/**
 * Wren's own apps, in Wren's workspace only (team view): each an Overview of its numbers, then
 * its records on the templates. The console serves every record here.
 */
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { Module } from "../../module.js";
import { ClientLook } from "../account/Look.js";
import { ClientComponents } from "../marketplace/Installed.js";
import {
  CANDIDATE_ACTIONS,
  candidateExtras,
  EXPERIMENT_ACTIONS,
  experimentExtras,
} from "./experiments.js";
import { handlers } from "./handlers.js";
import { AI_SPEND, AiSpend, idOf } from "./heads.js";

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

const WAITING = { state: ["needs_you", "proposed"] };
const REPLY_ACTIONS: Action[] = [
  {
    id: "email.approve",
    label: "Send",
    handler: "email/approve",
    ask: { field: "body", label: "Your reply", from: "draft" },
    key: "a",
    when: WAITING,
    done: said("Sent"),
  },
  {
    id: "email.drop",
    label: "Don't answer",
    handler: "email/drop",
    confirm: "Leave this reply unanswered?",
    key: "s",
    when: WAITING,
    done: said("Left unanswered"),
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
          fields: ["step", "replyRate"],
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
      id: "variants",
      label: "Variants",
      template: "list",
      record: "email.variant",
      empty: "Variants show here once they send.",
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

export const inbox: Module = {
  id: "inbox",
  name: "Inbox",
  component: "email.replies",
  icon: "reply",
  blurb: "Warm replies, each with a draft answer waiting for you.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Waiting on you",
          record: "email.reply",
          href: "/inbox/replies?view=waiting",
          needs: true,
        },
        { label: "Replies", record: "email.reply", href: "/inbox/replies?view=all", period: 30 },
        { label: "Booked", record: "email.call", href: "/inbox/calls?view=booked", period: 30 },
      ],
      top: [
        {
          label: "Waiting on you",
          record: "email.reply",
          href: "/inbox/replies?view=waiting",
          fields: ["company", "received"],
          empty: "Nothing is waiting on you.",
        },
      ],
    },
    {
      id: "replies",
      label: "Replies",
      template: "queue",
      record: "email.reply",
      empty: {
        waiting: "Warm replies wait here, each with a draft answer.",
        booked: "Calls booked from a reply show here.",
        all: "Warm replies show here.",
      },
      actions: REPLY_ACTIONS,
    },
    {
      id: "calls",
      label: "Calls",
      template: "list",
      record: "email.call",
      empty: {
        booked: "Calls booked on cal.com show here.",
        cancelled: "No call was cancelled.",
        all: "Calls booked on cal.com show here.",
      },
    },
  ],
};

export const loops: Module = {
  id: "loops",
  name: "Loops",
  icon: "clock",
  blurb: "Every scheduled job and which ones fail.",
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
          "William's own time isn't a cost here.",
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
        label: "Firms found",
        record: "email.firm",
        href: `${base}/firms?view=in_play`,
        period: 30,
      },
      {
        label: "With a domain",
        record: "email.firm",
        href: `${base}/firms?view=with_domain`,
        period: 30,
      },
      {
        label: "Crawled",
        record: "email.firm",
        href: `${base}/firms?view=crawled`,
        period: 30,
      },
      {
        label: "Named a person",
        record: "email.firm",
        href: `${base}/firms?view=named`,
        period: 30,
      },
      {
        label: "Verified leads",
        record: "email.firm",
        href: `${base}/firms?view=lead`,
        period: 30,
      },
      {
        label: "Crawled, no person",
        record: "email.firm",
        href: `${base}/firms?view=crawled&named=-`,
        needs: true,
      },
      {
        label: "No domain yet",
        record: "email.firm",
        href: `${base}/firms?view=in_play&domain=-`,
      },
    ],
    top: [
      {
        label: "Newest verified leads",
        record: "email.firm",
        href: `${base}/firms?view=lead&sort=-lead`,
        fields: ["campaign", "lead"],
        empty: "No verified leads yet.",
      },
      {
        label: "Where firms stall",
        record: "email.stall",
        href: `${base}/stalls`,
        fields: ["queuedFirms", "catchAllLeads", "riskyLeads"],
        empty: "Nothing is stuck.",
      },
    ],
  },
  {
    id: "firms",
    label: "Firms",
    template: "list",
    record: "email.firm",
    empty: "Firms show here once a source finds them.",
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
  blurb: "Firms from found to verified lead, and where they stall.",
  requires: TEAM,
  pages: sheetPages("/pipeline"),
};

/** The same sheet in a client's workspace, read from its own database (O1). */
export const leads: Module = {
  id: "leads",
  name: "Lead sheet",
  component: "research.lead_sheet",
  icon: "pulse",
  blurb: "Firms from found to verified lead, and where they stall.",
  pages: sheetPages("/leads"),
};

export const clients: Module = {
  id: "clients",
  name: "Clients",
  icon: "people",
  blurb: "Every client and when its team last looked.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Clients", record: "console.client", href: "/clients/all?view=clients" },
        { label: "Added", record: "console.client", href: "/clients/all?view=all", period: 30 },
      ],
      top: [
        {
          label: "Last seen",
          record: "console.client",
          href: "/clients/all?view=all&sort=-lastSeen",
          fields: ["members", "lastSeen"],
          empty: "No clients yet.",
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
          ["Components", createElement(ClientComponents, { client: String(row.id) })],
          ["Look", createElement(ClientLook, { client: String(row.id) })],
        ],
      }),
    },
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
  icon: "people",
  blurb: "Who on Wren's team signs in, their role, which clients they see, and who changed what.",
  requires: { ...TEAM, needs: "team" },
  pages: [
    {
      id: "all",
      label: "Team",
      template: "list",
      record: "console.team",
      empty: "Nobody yet.",
      actions: TEAM_ACTIONS,
    },
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

export const WREN_APPS = [outbound, inbox, loops, money, pipeline, clients, team, handlers];
