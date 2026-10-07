/**
 * Client health and flags as console records in the Clients app (designs/2026-10-07-health.md),
 * each over a view in `./views.ts`. Wren's own read of its clients: the team's alone.
 */
import {
  actor,
  date,
  defineRecord,
  link,
  name,
  number,
  type RecordType,
  score,
  status,
  text,
} from "@wren/core/records";

const BAND = status(
  {
    risk: { label: "At risk", tone: "bad" },
    watch: { label: "Watch", tone: "warn" },
    healthy: { label: "Healthy", tone: "good" },
    none: { label: "No data", tone: "neutral" },
  },
  "Health",
);
const PART = status(
  {
    results: { label: "Results", tone: "neutral" },
    engagement: { label: "Engagement", tone: "neutral" },
    sentiment: { label: "Sentiment", tone: "neutral" },
    money: { label: "Money", tone: "neutral" },
  },
  "Part",
);
const OF_100 = { max: 100 } as const;

export const healthRecord = defineRecord({
  id: "console.health",
  app: "clients",
  channel: null,
  name: { one: "client's health", many: "client health" },
  view: "delivery.console_health",
  key: "id",
  title: "name",
  subtitle: "weights",
  fields: {
    name: name("Client"),
    score: score("Score", OF_100),
    band: BAND,
    model: number("Model's score"),
    override: number("Set by hand"),
    reason: text("Why set by hand", { listed: false }),
    overrideBy: actor("Set by", { listed: false }),
    results: score("Results", OF_100),
    engagement: score("Engagement", OF_100),
    sentiment: score("Sentiment", OF_100),
    money: score("Money", OF_100),
    resultsWhy: text("Results", { listed: false, group: "Why" }),
    engagementWhy: text("Engagement", { listed: false, group: "Why" }),
    sentimentWhy: text("Sentiment", { listed: false, group: "Why" }),
    moneyWhy: text("Money", { listed: false, group: "Why" }),
    weights: text("Weights"),
    stale: number("Stale parts"),
    staleParts: text("Stale", { listed: false }),
    risks: number("Open risks"),
    opportunities: number("Opportunities"),
    rating: number("Wren's rating"),
    rated: date("Rated", { listed: false }),
    updated: date("Scored"),
  },
  views: [
    { id: "all", label: "All", sort: "score", at: "updated" },
    { id: "risk", label: "At risk", where: { band: ["risk"] }, sort: "score", at: "updated" },
    { id: "watch", label: "Watch", where: { band: ["watch"] }, sort: "score", at: "updated" },
    { id: "stale", label: "Stale", where: { stale: { gte: 1 } }, sort: "score", at: "updated" },
    { id: "hand", label: "Set by hand", where: { override: { empty: false } }, sort: "score" },
  ],
  related: [
    { record: "console.health_input", by: "client" },
    { record: "console.flag", by: "client" },
    { record: "console.health_day", by: "client" },
  ],
  actions: ["health.rate", "health.override", "health.clearOverride", "health.flagRaise"],
});

export const healthDayRecord = defineRecord({
  id: "console.health_day",
  app: "clients",
  channel: null,
  name: { one: "day", many: "days" },
  view: "delivery.console_health_days",
  key: "id",
  title: "name",
  subtitle: "day",
  fields: {
    name: name("Client"),
    client: text("Client id", { listed: false }),
    day: date("Day"),
    score: score("Score", OF_100),
    band: BAND,
    model: number("Model's score"),
    override: number("Set by hand"),
    results: score("Results", OF_100),
    engagement: score("Engagement", OF_100),
    sentiment: score("Sentiment", OF_100),
    money: score("Money", OF_100),
    visited: status(
      { yes: { label: "Visited", tone: "good" }, no: { label: "No visit", tone: "neutral" } },
      "Visit",
    ),
    staleParts: text("Stale"),
  },
  views: [{ id: "all", label: "Every day", sort: "-day", at: "day" }],
});

export const healthInputRecord = defineRecord({
  id: "console.health_input",
  app: "clients",
  channel: null,
  name: { one: "input", many: "inputs" },
  view: "delivery.console_health_inputs",
  key: "id",
  title: "what",
  subtitle: "value",
  fields: {
    name: name("Client"),
    client: text("Client id", { listed: false }),
    part: PART,
    what: text("Input"),
    value: text("Value"),
    at: date("As of"),
    age: status(
      {
        stale: { label: "Stale", tone: "warn" },
        fresh: { label: "Fresh", tone: "good" },
        live: { label: "Live", tone: "neutral" },
      },
      "Age",
    ),
    rows: link("Rows"),
  },
  views: [
    { id: "all", label: "All", sort: "part" },
    { id: "stale", label: "Stale", where: { age: ["stale"] }, sort: "part" },
  ],
});

const SIDE = status(
  {
    risk: { label: "Risk", tone: "bad" },
    opportunity: { label: "Opportunity", tone: "good" },
  },
  "Side",
);
const STATE = status(
  {
    open: { label: "Open", tone: "warn" },
    addressed: { label: "Addressed", tone: "neutral" },
    cleared: { label: "Cleared", tone: "good" },
  },
  "State",
);

export const flagRecord = defineRecord({
  id: "console.flag",
  app: "clients",
  channel: null,
  name: { one: "flag", many: "flags" },
  view: "delivery.console_flags",
  key: "id",
  title: "what",
  subtitle: "name",
  fields: {
    what: text("Flag"),
    name: name("Client"),
    client: text("Client id", { listed: false }),
    side: SIDE,
    state: STATE,
    owner: text("Owner"),
    source: status(
      {
        delivery: { label: "Delivery", tone: "neutral" },
        health: { label: "Health", tone: "neutral" },
        person: { label: "A person", tone: "neutral" },
      },
      "From",
    ),
    urgent: status(
      { yes: { label: "Urgent", tone: "bad" }, no: { label: "Digest", tone: "neutral" } },
      "Told",
    ),
    raised: date("Raised"),
    raisedBy: actor("Raised by", { listed: false }),
    addressed: date("Addressed"),
    addressedBy: actor("Addressed by", { listed: false }),
    note: text("Note"),
    cleared: date("Cleared"),
    clearedBy: actor("Cleared by", { listed: false }),
  },
  views: [
    {
      id: "open",
      label: "Open",
      where: { state: ["open", "addressed"] },
      sort: "-raised",
      at: "raised",
    },
    {
      id: "risks",
      label: "Risks",
      where: { state: ["open", "addressed"], side: ["risk"] },
      sort: "-raised",
      at: "raised",
    },
    {
      id: "opportunities",
      label: "Opportunities",
      where: { state: ["open", "addressed"], side: ["opportunity"] },
      sort: "-raised",
      at: "raised",
    },
    {
      id: "cleared",
      label: "Cleared",
      where: { state: ["cleared"] },
      sort: "-cleared",
      at: "cleared",
    },
    { id: "all", label: "All", sort: "-raised", at: "raised" },
  ],
  actions: [
    "health.flagRaise",
    "health.flagTake",
    "health.flagOwn",
    "health.flagAddress",
    "health.flagClear",
  ],
});

export const HEALTH_RECORDS: readonly RecordType[] = [
  healthRecord,
  healthDayRecord,
  healthInputRecord,
  flagRecord,
];
