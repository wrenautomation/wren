/**
 * The tools we built in place of a SaaS (designs/2026-10-06-in-house-tools.md): what each is,
 * the Shop parts and apps it lives in, what it replaces at that vendor's public price, what it
 * costs us, and how far along it is. Books → In-house lists them; the launcher, the Shop and a
 * client's Billing say it quietly. Prices come only from the vendor's own pricing page, with the
 * URL and the day it was read; no public number is "custom pricing" and adds nothing.
 */

export type InHouseState = "live" | "building" | "in development";

/** One vendor's plan we'd otherwise buy. */
export interface Instead {
  vendor: string;
  plan: string;
  /** USD at the plan's unit; null when the vendor shows no public number. */
  price: number | null;
  /** What the price buys: "a month", "a seat a month", "a minute", or "custom pricing". */
  unit: string;
  /** What it would cost us a month at our size, USD; null when usage based or custom. */
  monthly: number | null;
  /** The vendor's own pricing page. */
  url: string;
  /** The day the page was read, YYYY-MM-DD. */
  asOf: string;
}

export interface InHouse {
  id: string;
  name: string;
  /** The Shop parts (`console.component` ids) it lives in; empty when it's Wren's own tooling. */
  parts: readonly string[];
  /** The apps it lives in. */
  apps: readonly string[];
  /** One or two vendors, the closest first. */
  instead: readonly Instead[];
  /** What it costs us a month, USD, past what we already run; null when it isn't split out. */
  costsUs: number | null;
  why: string;
  state: InHouseState;
}

const AS_OF = "2026-10-06";

export const IN_HOUSE: readonly InHouse[] = [
  {
    id: "site-analytics",
    name: "Site analytics: events, funnels, session replay",
    parts: ["marketing.stats"],
    apps: ["marketing"],
    instead: [
      {
        vendor: "PostHog",
        plan: "Pay as you go, 1M events free",
        price: 0.00005,
        unit: "an event past the free 1M",
        monthly: null,
        url: "https://posthog.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "FullStory",
        plan: "Business",
        price: null,
        unit: "custom pricing",
        monthly: null,
        url: "https://www.fullstory.com/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Counts in our Postgres, replays in our S3 bucket.",
    state: "live",
  },
  {
    id: "heatmaps",
    name: "Heatmaps",
    parts: ["marketing.stats"],
    apps: [],
    instead: [
      {
        vendor: "Hotjar",
        plan: "Growth",
        price: 49,
        unit: "a month and up",
        monthly: 49,
        url: "https://contentsquare.com/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Built on the site events we already store.",
    state: "building",
  },
  {
    id: "flags",
    name: "Feature flags",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "LaunchDarkly",
        plan: "Foundation, first 5 service connections included",
        price: 10,
        unit: "a service connection a month",
        monthly: null,
        url: "https://launchdarkly.com/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "A table and a check in our own code.",
    state: "building",
  },
  {
    id: "experiments",
    name: "Site experiments",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Optimizely",
        plan: "Web Experimentation",
        price: null,
        unit: "custom pricing",
        monthly: null,
        url: "https://www.optimizely.com/pricing/",
        asOf: AS_OF,
      },
      {
        vendor: "VWO",
        plan: "Testing",
        price: null,
        unit: "custom pricing",
        monthly: null,
        url: "https://vwo.com/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Rides on flags and the site events we already store.",
    state: "building",
  },
  {
    id: "surveys",
    name: "Surveys",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Typeform",
        plan: "Basic",
        price: 39,
        unit: "a month",
        monthly: 39,
        url: "https://www.typeform.com/pricing/",
        asOf: AS_OF,
      },
      {
        vendor: "Hotjar Surveys",
        plan: "Voice of Customer Growth",
        price: 99,
        unit: "a month and up",
        monthly: 99,
        url: "https://contentsquare.com/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Answers land in our Postgres.",
    state: "building",
  },
  {
    id: "calendar",
    name: "Calendar and booking",
    parts: ["calendar.booking"],
    apps: ["calendar"],
    instead: [
      {
        vendor: "Calendly",
        plan: "Standard",
        price: 10,
        unit: "a seat a month",
        monthly: 10,
        url: "https://calendly.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Cal.com",
        plan: "Teams",
        price: 12,
        unit: "a user a month, billed yearly",
        monthly: 12,
        url: "https://cal.com/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Slots and bookings in our Postgres, events on Google Calendar.",
    state: "building",
  },
  {
    id: "workflows",
    name: "Workflows: the spine and webhooks",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Zapier",
        plan: "Professional, 750 tasks",
        price: 29.99,
        unit: "a month",
        monthly: 29.99,
        url: "https://zapier.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Make",
        plan: "Core, 10k credits",
        price: 9,
        unit: "a month",
        monthly: 9,
        url: "https://www.make.com/en/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Runs on the Restate and Lambda we already run.",
    state: "live",
  },
  {
    id: "workflow-editor",
    name: "Workflow editor",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "n8n",
        plan: "Starter Cloud, 2.5k executions",
        price: null,
        unit: "€24 a month, priced in euros",
        monthly: null,
        url: "https://n8n.io/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Draws and edits the spine's workflows in the portal.",
    state: "building",
  },
  {
    id: "voice",
    name: "Voice agent",
    parts: ["voice.agent"],
    apps: ["voice"],
    instead: [
      {
        vendor: "Retell",
        plan: "Pay as you go",
        price: 0.07,
        unit: "a minute and up",
        monthly: null,
        url: "https://www.retellai.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Vapi",
        plan: "Pay as you go, models at cost",
        price: 0.05,
        unit: "a minute for hosting",
        monthly: null,
        url: "https://vapi.ai/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Our own infra; speech and model minutes are paid as used.",
    state: "in development",
  },
  {
    id: "verification",
    name: "Email verification",
    parts: ["research.verify"],
    apps: [],
    instead: [
      {
        vendor: "ZeroBounce",
        plan: "Pay as you go",
        price: 39,
        unit: "for 2,000 checks",
        monthly: null,
        url: "https://www.zerobounce.net/email-validation-pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Our own SMTP probers on a small VPS.",
    state: "live",
  },
  {
    id: "cold-email",
    name: "Cold email: inboxes, sequences, A/B",
    parts: ["email.sequences"],
    apps: ["outbound"],
    instead: [
      {
        vendor: "Instantly",
        plan: "Outreach Growth",
        price: 47,
        unit: "a month",
        monthly: 47,
        url: "https://instantly.ai/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Smartlead",
        plan: "Base",
        price: 39,
        unit: "a month",
        monthly: 39,
        url: "https://www.smartlead.ai/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Sends through the inboxes we already pay for.",
    state: "live",
  },
  {
    id: "reach",
    name: "LinkedIn and Reddit outreach",
    parts: ["reach.outreach"],
    apps: [],
    instead: [
      {
        vendor: "HeyReach",
        plan: "Growth",
        price: 79,
        unit: "a sender a month",
        monthly: 79,
        url: "https://www.heyreach.io/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Expandi",
        plan: "Business",
        price: 99,
        unit: "a seat a month",
        monthly: 99,
        url: "https://expandi.io/pricing/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Drives our own browser on the desk Mac.",
    state: "live",
  },
  {
    id: "lead-research",
    name: "Lead research, lead sheet and dossier",
    parts: ["research.lead_sheet", "research.people", "research.dossier"],
    apps: ["leads"],
    instead: [
      {
        vendor: "Clay",
        plan: "Launch",
        price: 167,
        unit: "a month",
        monthly: 167,
        url: "https://www.clay.com/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Search and model calls are paid as used.",
    state: "live",
  },
  {
    id: "content",
    name: "Content planning and posting",
    parts: ["content.posting", "content.planner"],
    apps: [],
    instead: [
      {
        vendor: "Buffer",
        plan: "Essentials",
        price: 5,
        unit: "a channel a month, billed yearly",
        monthly: 5,
        url: "https://buffer.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Hootsuite",
        plan: "Standard",
        price: 99,
        unit: "a user a month, billed yearly",
        monthly: 99,
        url: "https://www.hootsuite.com/plans",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Posts through each platform's own API.",
    state: "live",
  },
  {
    id: "video-editor",
    name: "Video editor: cuts, Shorts, thumbnails",
    parts: ["studio"],
    apps: [],
    instead: [
      {
        vendor: "Descript",
        plan: "Hobbyist",
        price: 24,
        unit: "a person a month",
        monthly: 24,
        url: "https://www.descript.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "Opus Clip",
        plan: "Starter",
        price: 15,
        unit: "a month",
        monthly: 15,
        url: "https://www.opus.pro/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Renders on the Mac; video understanding is paid as used.",
    state: "live",
  },
  {
    id: "watch",
    name: "The Watch: mail triage",
    parts: ["watch.triage"],
    apps: [],
    instead: [
      {
        vendor: "SaneBox",
        plan: "Snack",
        price: 9.49,
        unit: "a month",
        monthly: 9.49,
        url: "https://www.sanebox.com/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Model calls are paid as used.",
    state: "live",
  },
  {
    id: "books",
    name: "Books: spend, subscriptions, unit economics",
    parts: ["books"],
    apps: ["money"],
    instead: [
      {
        vendor: "QuickBooks",
        plan: "Simple Start",
        price: 38,
        unit: "a month",
        monthly: 38,
        url: "https://quickbooks.intuit.com/pricing/",
        asOf: AS_OF,
      },
      {
        vendor: "Xero",
        plan: "Early",
        price: 27,
        unit: "a month",
        monthly: 27,
        url: "https://www.xero.com/us/pricing-plans/",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Imports bank, card and cloud bills into our Postgres.",
    state: "live",
  },
  {
    id: "portal",
    name: "Client portal on the client's own domain",
    parts: ["delivery.portal"],
    apps: ["work"],
    instead: [
      {
        vendor: "GoHighLevel",
        plan: "Starter, plus the Branded Client Portal app",
        price: 146,
        unit: "a month for one client ($97 plus $49 a sub-account)",
        monthly: 146,
        url: "https://www.gohighlevel.com/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Served from our own Lambda; domains through Cloudflare.",
    state: "live",
  },
  {
    id: "llm-gateway",
    name: "LLM gateway: key rotation and routing",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Portkey",
        plan: "Production",
        price: 49,
        unit: "a month",
        monthly: 49,
        url: "https://portkey.ai/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "OpenRouter",
        plan: "Pay as you go",
        price: null,
        unit: "a 5.5% fee on credits",
        monthly: null,
        url: "https://openrouter.ai/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "A Cloudflare Worker over our own keys. Prod isn't on it yet.",
    state: "building",
  },
  {
    id: "credvault",
    name: "credvault: shared credentials, audited",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Doppler",
        plan: "Team",
        price: 21,
        unit: "a user a month",
        monthly: 21,
        url: "https://www.doppler.com/pricing",
        asOf: AS_OF,
      },
      {
        vendor: "1Password",
        plan: "Business",
        price: 10.99,
        unit: "a user a month",
        monthly: 10.99,
        url: "https://1password.com/business-pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: null,
    why: "Stored in AWS SSM; KMS calls are paid as used.",
    state: "live",
  },
  {
    id: "autobrowse",
    name: "Browser automation (autobrowse)",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Browserbase",
        plan: "Developer, 100 browser hours",
        price: 20,
        unit: "a month",
        monthly: 20,
        url: "https://www.browserbase.com/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "Runs Chrome on the desk Mac.",
    state: "live",
  },
  {
    id: "links",
    name: "Link tracking (/go/)",
    parts: [],
    apps: [],
    instead: [
      {
        vendor: "Bitly",
        plan: "Core",
        price: 10,
        unit: "a month, billed yearly",
        monthly: 10,
        url: "https://bitly.com/pages/pricing",
        asOf: AS_OF,
      },
    ],
    costsUs: 0,
    why: "A Cloudflare Pages function on our own site.",
    state: "live",
  },
];

/** What it would cost a month bought: the first vendor with a number, else null. */
export const monthlyOf = (t: InHouse): number | null =>
  t.instead.find((i) => i.monthly !== null)?.monthly ?? null;

/** The quiet line: "In place of Calendly". */
export const insteadLine = (t: InHouse): string => `In place of ${t.instead[0]?.vendor ?? ""}`;

/** The tool a Shop part is, live first. */
export const inHouseOfPart = (part: string): InHouse | null =>
  pick(IN_HOUSE.filter((t) => t.parts.includes(part)));

/** The tool an app is, live only: a card never promises what isn't running. */
export const inHouseOfApp = (app: string): InHouse | null =>
  IN_HOUSE.find((t) => t.state === "live" && t.apps.includes(app)) ?? null;

const pick = (ts: readonly InHouse[]) => ts.find((t) => t.state === "live") ?? ts[0] ?? null;

/** Live tools and what they'd cost a month bought separately. */
export function totalOf(ts: readonly InHouse[]): { tools: InHouse[]; monthly: number } {
  const tools = ts.filter((t) => t.state === "live");
  return { tools, monthly: tools.reduce((n, t) => n + (monthlyOf(t) ?? 0), 0) };
}

/** A client's: live tools with a part it has installed. */
export const includedIn = (installed: ReadonlySet<string>) =>
  totalOf(IN_HOUSE.filter((t) => t.parts.some((p) => installed.has(p))));

