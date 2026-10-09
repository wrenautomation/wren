/** Cold outreach on social sites: a person's warmed account, paced. Comments on our posts. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { defineWorkflow } from "@wren/core/workflows";
import { discoverySettingsSchema } from "./discovery/places.js";
import { invitesSettingsSchema } from "./invites.js";
import { COMMENTS_SETTINGS } from "./reach-posts.js";

/** A client's loop units: `ReachWatch/<client>/daily`, `ReachSender/<client>/fleet`, `RedditReads/<client>/daily`. */
export const WATCH_UNIT = "daily";
export const SENDER_UNIT = "fleet";
export const READS_UNIT = "daily";

export const OUTREACH_COMPONENTS = [
  defineComponent({
    id: "reach.outreach",
    stage: "reach",
    channels: ["dm"],
    name: "Social outreach",
    blurb: "Writes to people on social sites from a warmed account, paced.",
    icon: "people",
    for: "client",
    ready: true,
    requires: { anyAccount: ["linkedin", "reddit"] },
    soon: ["x"],
    provides: {
      services: ["ReachSender", "ReachWatch", "ReachDesk"],
      loops: ["ReachSender", "ReachWatch"],
      records: ["marketing.person"],
    },
    clientLoops: (client) => [
      { service: "ReachSender", key: clientKey(client, SENDER_UNIT) },
      { service: "ReachWatch", key: clientKey(client, WATCH_UNIT) },
    ],
    // DMs are planned and held in its own database; none leaves until an admin turns sends on.
    liveSwitch: true,
    effects: ["sends"],
    in: [{ id: "people", label: "people", kind: "person" }],
    out: [{ id: "replied", label: "DM replies", kind: "reply" }],
    hypothesis: {
      from: "Wren's DM tests, 2026-10",
      guesses: [
        { is: "change", says: "Which sites: LinkedIn, Reddit, X.", built: null },
        { is: "change", says: "Caps and ramp per account.", built: "the caps ledger" },
        { is: "change", says: "Who to write to.", built: null },
        { is: "needs", says: "Warmed accounts the client owns.", built: null },
        { is: "fixed", says: "Each account is paced by its own caps." },
      ],
    },
  }),
  defineComponent({
    id: "reach.touch",
    stage: "follow",
    channels: ["dm"],
    name: "DM step",
    blurb: "One DM of a follow-up, queued when its wait is over, unless they answered.",
    icon: "people",
    for: "client",
    ready: true,
    requires: { components: ["reach.outreach"] },
    // Its DMs leave through Social outreach's sender, on that part's live flag.
    effects: ["sends"],
    in: [{ id: "lead", label: "lead", kind: "lead" }],
    out: [
      { id: "sent", label: "sent", kind: "lead" },
      { id: "replied", label: "answered", kind: "reply" },
    ],
    hypothesis: {
      from: "Wren's DM sequences, moved onto the spine 2026-10-05",
      guesses: [
        {
          is: "change",
          says: "Which step of the sequence's copy it sends: the node's step.",
          built: null,
        },
        {
          is: "needs",
          says: "One person across channels, so a cadence can mix DMs with texts and email.",
          built: null,
        },
        { is: "fixed", says: "The sender still paces every DM and waits on LinkedIn's accept." },
      ],
    },
  }),
  defineComponent({
    id: "comments.read",
    stage: "follow",
    channels: ["dm"],
    name: "Comment reader",
    blurb:
      "Reads each account's inbox every 2 minutes after a touch, easing to 30: comments on our posts and under our comments.",
    icon: "people",
    for: "client",
    ready: true,
    wrenSettings: true,
    // ReachWatch is Social outreach's loop; this part is its inbox read, on the client's logins.
    requires: { accounts: ["reddit"] },
    provides: { records: ["marketing.comment"] },
    clientLoops: (client) => [{ service: "ReachWatch", key: clientKey(client, WATCH_UNIT) }],
    out: [{ id: "comment", label: "new comments", kind: "comment" }],
    hypothesis: {
      from: "Wren's Reddit posts, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Which accounts: every reach account's inbox.",
          built: "the reach_accounts rows",
        },
        { is: "change", says: "LinkedIn, X and IG comments, as another reader.", built: null },
        {
          is: "change",
          says: "How fast it checks: 2 min for 15 min after a touch, then 5, 15, 30.",
          built: "WARM_TIERS in @wren/core/warm",
        },
        {
          is: "fixed",
          says: "One inbox read per account serves DMs and comments; nothing is marked read.",
        },
      ],
    },
  }),
  defineComponent({
    id: "comments.sort",
    stage: "follow",
    channels: ["dm"],
    name: "Comment sort",
    blurb:
      "Reads each comment as asked, question, chat or hostile, and drafts an answer to the first two.",
    icon: "people",
    for: "client",
    ready: true,
    wrenSettings: true,
    requires: { components: ["comments.read"] },
    effects: ["spends"],
    in: [{ id: "comment", label: "comment", kind: "comment" }],
    out: [
      { id: "asked", label: "asked", kind: "comment" },
      { id: "question", label: "question", kind: "comment" },
      { id: "chat", label: "chat", kind: "comment" },
      { id: "hostile", label: "hostile", kind: "comment" },
    ],
    hypothesis: {
      from: "Wren's Reddit posts, 2026-10",
      guesses: [
        {
          is: "needs",
          says: "A model for what words can't settle; Cohere by default.",
          built: "env WREN_WATCH_LLM",
        },
        { is: "change", says: "The words that mean they asked.", built: null },
        { is: "fixed", says: "Every answer and DM waits on William's click." },
        { is: "fixed", says: "Our two accounts never write in one thread." },
      ],
    },
  }),
  defineComponent({
    id: "reddit.discovery",
    stage: "reach",
    channels: ["social"],
    name: "Reddit discovery",
    blurb:
      "Finds subreddits where buyers ask questions, picks the day's best new threads, and drafts a comment in your voice for each.",
    icon: "search",
    for: "client",
    ready: true,
    settings: discoverySettingsSchema,
    // Wren's own run reads its block from `wren_settings` until a client's runs.
    wrenSettings: true,
    requires: { accounts: ["reddit"] },
    provides: {
      services: ["RedditReads"],
      loops: ["RedditReads"],
      records: ["marketing.place", "marketing.thread"],
    },
    clientLoops: (client) => [{ service: "RedditReads", key: clientKey(client, READS_UNIT) }],
    effects: ["sends", "spends"],
    liveSwitch: true,
    out: [
      {
        id: "queued",
        label: "threads to answer",
        kind: "post",
        count: { record: "marketing.thread", view: "queued" },
      },
    ],
    hypothesis: {
      from: "Wren's Reddit, 2026-10",
      guesses: [
        { is: "change", says: "Who the buyers are, in words.", built: "settings.about" },
        { is: "change", says: "The search words and named subreddits.", built: "settings.topics" },
        {
          is: "change",
          says: "How many comments a day: the account's rung.",
          built: "warmupOf in @wren/channel-reddit",
        },
        {
          is: "needs",
          says: "A few karma-building accounts, one per place.",
          built: "the reach_accounts rows",
        },
        { is: "fixed", says: "Every read is signed out; our accounts only comment." },
        { is: "fixed", says: "Every comment waits on William's click; two of ours never meet." },
      ],
    },
  }),
  defineComponent({
    id: "linkedin.invites",
    stage: "reach",
    channels: ["dm"],
    name: "LinkedIn invites",
    blurb:
      "Proposes the day's best people on LinkedIn, up to 20 a weekday: decision-makers at big firms, and people who engaged with you first. Each invite waits on your yes.",
    icon: "people",
    for: "client",
    ready: true,
    requires: { components: ["reach.outreach"], accounts: ["linkedin"] },
    settings: invitesSettingsSchema,
    // Wren's own run reads its block from `wren_settings`; a client's from its install.
    wrenSettings: true,
    // The watch sweeps and queues, the sender invites: both only once an admin armed it
    // (`--live linkedin.invites`) and activated the client's login (`reach accounts activate`).
    clientLoops: (client) => [
      { service: "ReachWatch", key: clientKey(client, WATCH_UNIT) },
      { service: "ReachSender", key: clientKey(client, SENDER_UNIT) },
    ],
    liveSwitch: true,
    provides: { records: ["marketing.invite"] },
    effects: ["sends"],
    in: [{ id: "people", label: "people", kind: "person" }],
    out: [
      {
        id: "accepted",
        label: "accepted",
        kind: "person",
        count: { record: "marketing.invite", view: "accepted" },
      },
    ],
    hypothesis: {
      from: "Wren's LinkedIn, 2026-10",
      guesses: [
        { is: "change", says: "Which account sends.", built: "settings.account" },
        { is: "change", says: "Who: niches and title words.", built: "settings.niches, titles" },
        {
          is: "change",
          says: "Decision-makers only, and a firm size floor.",
          built: "settings.decisionMakers, minEmployees, knownSizeOnly",
        },
        {
          is: "change",
          says: "People who engaged with you go first, past the filters.",
          built: "settings.engaged",
        },
        {
          is: "change",
          says: "How many a day, under the account's ramp.",
          built: "settings.perDay, policy.linkedin",
        },
        {
          is: "change",
          says: "When a pending invite is withdrawn.",
          built: "settings.withdrawAfterDays",
        },
        { is: "needs", says: "People with a LinkedIn page in the lists.", built: null },
        { is: "fixed", says: "No invite sends without your yes in To approve." },
        { is: "fixed", says: "No message goes after an accept without a click." },
      ],
    },
  }),
  defineComponent({
    id: "linkedin.comments",
    stage: "reach",
    channels: ["social"],
    name: "LinkedIn comments",
    blurb:
      "Finds the day's best posts by others on your topics, companies and people, and drafts a comment in your voice for each. Each waits on your yes.",
    icon: "reply",
    for: "wren",
    ready: true,
    settings: COMMENTS_SETTINGS.linkedin,
    wrenSettings: true,
    // The watch reads and drafts; ReachDesk comments; To approve shows them.
    requires: { components: ["reach.outreach", "content.social"], accounts: ["linkedin"] },
    provides: {},
    effects: ["sends"],
    hypothesis: {
      from: "Wren's LinkedIn, 2026-10",
      guesses: [
        { is: "change", says: "Which login reads.", built: "settings.account" },
        {
          is: "change",
          says: "What to read: topics, companies, people we know.",
          built: "settings.topics, pages, people, authorTitle",
        },
        {
          is: "change",
          says: "Who the buyers are; the model adds search words from it and what past searches found.",
          built: "settings.about, newTopics",
        },
        {
          is: "change",
          says: "How many a day, and how fresh.",
          built: "settings.perDay, maxAgeHours",
        },
        { is: "needs", says: "autobrowse's post reads on linkedin@wren, 12 a day.", built: null },
        { is: "fixed", says: "Never his personal login or the research alt." },
        { is: "fixed", says: "No comment posts without your yes in To approve." },
        {
          is: "change",
          says: "With the comment, like the post and follow its author.",
          built: "settings.like, follow",
        },
      ],
    },
  }),
  ...(["x", "instagram"] as const).map((p) => {
    const name = p === "x" ? "X" : "Instagram";
    return defineComponent({
      id: `${p}.comments`,
      stage: "reach",
      channels: ["social"],
      name: `${name} comments`,
      blurb: `Finds the day's best ${name} posts by others on your topics, accounts and people, and drafts a comment in your voice for each. Each waits on your yes; a like and follow can go with it.`,
      icon: "reply",
      for: "wren",
      ready: true,
      settings: COMMENTS_SETTINGS[p],
      wrenSettings: true,
      requires: { components: ["reach.outreach", "content.social"], accounts: [p] },
      provides: {},
      effects: ["sends"],
      hypothesis: {
        from: `Wren's ${name}, 2026-10`,
        guesses: [
          {
            is: "change",
            says: "Which login reads, likes and follows; empty is off.",
            built: "settings.account",
          },
          {
            is: "change",
            says: "What to read: topics, accounts, people who touched us.",
            built: "settings.topics, pages, people",
          },
          {
            is: "change",
            says: "How many a day, and how fresh.",
            built: "settings.perDay, maxAgeHours",
          },
          {
            is: "change",
            says: "With the comment, like the post and follow its author.",
            built: "settings.like, follow",
          },
          {
            is: "needs",
            says:
              p === "x"
                ? "autobrowse's X search and reply, metered per account."
                : "autobrowse's Instagram search, post reads and comments, metered per account.",
            built: null,
          },
          { is: "fixed", says: "No comment posts without your yes in To approve." },
        ],
      },
    });
  }),
];

export const OUTREACH_WORKFLOWS = [
  defineWorkflow({
    id: "reach.comments",
    stage: "follow",
    name: "Comments",
    blurb: "Every comment on our posts lands in Replies, sorted, with a draft when they asked.",
    icon: "people",
    for: "wren",
    out: [
      { id: "needs_you", label: "needs you", kind: "comment" },
      { id: "chat", label: "chat", kind: "comment" },
    ],
    nodes: [
      { id: "read", uses: "comments.read" },
      { id: "sort", uses: "comments.sort" },
    ],
    wires: [
      { from: "read.comment", to: "sort.comment", via: "events" },
      { from: "sort.asked", to: "out.needs_you", via: "events" },
      { from: "sort.question", to: "out.needs_you", via: "events" },
      { from: "sort.chat", to: "out.chat", via: "events" },
      { from: "sort.hostile", to: "out.chat", via: "events" },
    ],
  }),
];
