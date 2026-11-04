/**
 * The eight places (designs/2026-11-04-portal-places.md): Map, Campaigns, Content, People, Inbox,
 * Calendar, Research, Back office. Each is one app made of the old apps' pages; a page keeps its
 * own component and access, so a client sees only what it holds. Old addresses: `../moved.ts`.
 */
import { findAll } from "../find.js";
import type { Found, Module, ModulePage } from "../module.js";
import { account } from "./account/index.js";
import { analytics } from "./analytics/index.js";
import { calendar, clientCalendar } from "./calendar/index.js";
import { calls } from "./calls/index.js";
import { clientDeals, pipelines } from "./deals/index.js";
import { documents } from "./documents/index.js";
import { library } from "./library/index.js";
import { ads, clientMarketing, content as oldContent } from "./marketing/index.js";
import { numbers } from "./numbers/index.js";
import { offers } from "./offers/index.js";
import { engage } from "./outreach/index.js";
import { payments } from "./payments/index.js";
import { clientPeople as oldClientPeople, people as oldPeople } from "./people/index.js";
import { reactivation } from "./reactivation/index.js";
import { clientSettings, settings } from "./settings/index.js";
import { clientSites, sites } from "./sites/index.js";
import { texts } from "./texts/index.js";
import { work } from "./work/index.js";
import { handlers } from "./wren/handlers.js";
import {
  clients,
  leads,
  money,
  inbox as oldInbox,
  outbound,
  team,
  workflows,
} from "./wren/index.js";

/** A page taken from an old app: its new id, group or light; null clears one. */
interface Take {
  id: string;
  as?: string;
  label?: string;
  group?: string | null;
  hidden?: boolean;
  lights?: string | null;
}

/** Each place page's old address (`/app/page`): `moved.test.ts` checks every one still lands. */
const WAS = new WeakMap<ModulePage, string>();

/** A place's pages with their old addresses: [old, new]. */
export const wasOf = (place: Module): [string, string][] =>
  place.pages.flatMap((p) => {
    const was = WAS.get(p);
    return was ? [[was, `/${place.id}/${p.id}`] as [string, string]] : [];
  });

/** `m`'s pages by id, in the order given, under `group` unless a take says else. */
function from(m: Module, takes: readonly (string | Take)[], group?: string): ModulePage[] {
  return takes.map((t) => {
    const take: Take = typeof t === "string" ? { id: t } : t;
    const page = m.pages.find((p) => p.id === take.id);
    if (!page) throw new Error(`places: ${m.id} has no page ${take.id}`);
    const { lights, group: own, hidden, ...rest } = page;
    const g = take.group === null ? undefined : (take.group ?? group ?? own);
    const l = take.lights === null ? undefined : (take.lights ?? lights);
    const h = take.hidden ?? hidden;
    const component = page.component ?? m.component;
    const requires = page.requires ?? m.requires;
    const next = {
      ...rest,
      id: take.as ?? page.id,
      ...(take.label ? { label: take.label } : {}),
      ...(g ? { group: g } : {}),
      ...(l ? { lights: l } : {}),
      ...(h ? { hidden: true } : {}),
      ...(component ? { component } : {}),
      ...(requires ? { requires } : {}),
    } as ModulePage;
    WAS.set(next, `/${m.id}/${page.id}`);
    return next;
  });
}

/** ⌘K over the old apps' finds. */
const finds = (...ms: Module[]) => {
  const fs = ms.flatMap((m) => (m.find ? [m.find] : []));
  return fs.length
    ? findAll(...fs)
    : ((async () => []) as (q: string, c: string) => Promise<Found[]>);
};

const TEAM = { audience: "team" } as const;

// Wren's team.

const mapPlace: Module = {
  id: "map",
  name: "Map",
  icon: "workflow",
  blurb: "What we sell, how it flows, what it earns, and how we do it.",
  requires: TEAM,
  find: finds(offers, library),
  pages: [
    ...from(offers, [{ id: "all", as: "offers" }, "terms"], "Offers"),
    ...from(
      numbers,
      [
        { id: "funnels", as: "shape" },
        { id: "offers", as: "offer-numbers" },
        "economics",
        "months",
        "channels",
        "cohorts",
      ],
      "Numbers",
    ),
    ...from(oldContent, [{ id: "reports", hidden: false, lights: null }], "Numbers"),
    ...from(library, ["templates", "sequences", "snippets", "sections", "sops"], "Playbook"),
  ],
};

const campaignsPlace: Module = {
  id: "campaigns",
  name: "Campaigns",
  icon: "billboard",
  blurb: "Each push of an offer to an audience: its channels, landers, rules and results.",
  requires: TEAM,
  find: finds(sites),
  pages: [
    ...from(
      outbound,
      [
        { id: "overview", as: "email", label: "Cold email" },
        { id: "campaigns", as: "email-campaigns" },
        "signals",
        "stalls",
        "text-copy",
      ],
      "Cold email",
    ),
    ...from(engage, ["engage", "invites", "threads", "places", "dm-copy"], "Engage"),
    ...from(oldContent, ["explore"], "Engage"),
    ...from(engage, ["auto-reply", "keywords", "keyword-dms"], "Rules"),
    ...from(ads, [{ id: "sets", as: "ads" }, "formats"], "Ads"),
    ...from(
      sites,
      ["pages", { id: "funnel", as: "page-funnel" }, "funnel-map", "links", "forms"],
      "Landers",
    ),
    ...from(
      analytics,
      [
        "visits",
        "sessions",
        "heatmaps",
        "experiments",
        "surveys",
        "survey-answers",
        "funnel",
        { id: "links", as: "visit-links" },
      ],
      "Results",
    ),
    ...from(engage, ["conversation"], "Results"),
  ],
};

const contentPlace: Module = {
  id: "content",
  name: "Content",
  icon: "megaphone",
  blurb: "Every piece we make: plan, make, post, and how each did.",
  requires: TEAM,
  find: finds(oldContent, library),
  pages: [
    ...from(oldContent, [
      "plan",
      "studio",
      "pieces",
      "content",
      "overview",
      "topics",
      "facts",
      "drafts",
      "write",
      "videos",
      "digest",
      "metrics",
      "cadence",
    ]),
    ...from(library, ["media"], "Setup"),
  ],
};

const peoplePlace: Module = {
  ...oldPeople,
  blurb: "Everyone we know: leads, clients, companies, their journeys and calls.",
  find: finds(oldPeople, pipelines, clients, outbound, engage),
  pages: [
    ...from(
      oldPeople,
      oldPeople.pages.map((p) => p.id),
    ),
    ...from(pipelines, ["board", "journeys", "deals", "calls", "entries"], "Pipeline"),
    ...from(
      clients,
      [
        { id: "all", as: "clients" },
        { id: "overview", as: "client-overview" },
        "health",
        "flags",
        "days",
        "inputs",
        "usage",
      ],
      "Clients",
    ),
    ...from(outbound, ["companies"], "Clients"),
    ...from(
      engage,
      [{ id: "people", as: "contacts", label: "Contacts" }, "followers", "subscribers"],
      "Audience",
    ),
    ...from(sites, ["submissions"], "Audience"),
  ],
};

const inboxPlace: Module = {
  ...oldInbox,
  blurb: "What waits on you now: replies, approvals, holds and mail.",
  pages: [
    ...from(oldInbox, ["overview"]),
    ...from(oldContent, [{ id: "today", hidden: false, lights: null }]),
    ...from(engage, [
      { id: "inbox", as: "messages", label: "Messages" },
      "approve",
      "dms",
      "comments",
      "reviews",
    ]),
    ...from(outbound, ["texts"]),
    ...from(oldInbox, ["mail", "replies"]),
    ...from(workflows, ["holds"]),
    ...from(oldInbox, ["done", "rules", "issues", "asks", "mentions"]),
  ],
};

const officePlace: Module = {
  id: "office",
  name: "Back office",
  icon: "building",
  blurb: "Runs the company: money, team and access, channel setup and settings.",
  requires: TEAM,
  pages: [
    ...from(
      money,
      [
        { id: "overview", as: "money", label: "Money" },
        "spend",
        "models",
        "payments-in",
        "subscriptions",
        "card",
        "in-house",
        "accounts",
      ],
      "Money",
    ),
    ...from(
      team,
      [
        { id: "all", as: "team" },
        "roles",
        "grants",
        { id: "review", as: "access-review" },
        "changes",
      ],
      "Team",
    ),
    ...from(outbound, ["inboxes"], "Channels"),
    ...from(engage, [{ id: "accounts", as: "channel-accounts" }], "Channels"),
    ...from(settings, ["systems", "guide", "layout", "themes", "look"], "Settings"),
    ...from(handlers, ["ai"], "Settings"),
  ],
};

/** Wren's places, in sidebar order; Calendar and Research keep their apps. */
export const TEAM_PLACES: Module[] = [
  mapPlace,
  campaignsPlace,
  contentPlace,
  peoplePlace,
  inboxPlace,
  calendar,
  officePlace,
];

// A client's workspace: the same places, less Research.

const clientMapPlace: Module = {
  id: "map",
  name: "Map",
  icon: "workflow",
  blurb: "What we do for you, where it stands, and the numbers that show it paid off.",
  fallback: true,
  ...(work.Glance ? { Glance: work.Glance } : {}),
  pages: [
    ...from(work, ["overview", "plan", "updates", "results"]),
    ...from(clientMarketing, ["reports"]),
  ],
};

const clientCampaignsPlace: Module = {
  id: "campaigns",
  name: "Campaigns",
  icon: "billboard",
  blurb: "Each push to win customers: who it reaches, its pages and how it did.",
  ...(reactivation.Glance ? { Glance: reactivation.Glance } : {}),
  find: finds(reactivation, clientSites),
  pages: [
    ...from(
      reactivation,
      ["overview", "run", "people", "emails", "replies", "keep", "setup", "real"],
      "Reactivation",
    ),
    ...from(clientMarketing, ["ads"], "Ads"),
    ...from(clientSites, ["pages", "links", "forms"], "Landers"),
    ...from(clientMarketing, ["auto-reply"], "Rules"),
  ],
};

const clientContentPlace: Module = {
  id: "content",
  name: "Content",
  icon: "megaphone",
  blurb: "Your posts and the drafts that wait on your OK.",
  pages: from(clientMarketing, [
    { id: "drafts", lights: null },
    { id: "content", hidden: false },
  ]),
};

const clientPeoplePlace: Module = {
  ...oldClientPeople,
  find: finds(oldClientPeople, clientDeals, leads),
  pages: [
    ...from(
      oldClientPeople,
      oldClientPeople.pages.map((p) => p.id),
    ),
    ...from(clientDeals, ["board", "journeys"], "Pipeline"),
    ...from(calls, ["calls"], "Pipeline"),
    ...from(leads, ["companies"], "Audience"),
    ...from(clientSites, ["submissions"], "Audience"),
  ],
};

const clientInboxPlace: Module = {
  id: "inbox",
  name: "Inbox",
  icon: "inbox",
  blurb: "What waits on you: replies, reviews and what we need from you.",
  pages: [
    ...from(work, ["needs-you", "deliverables", "welcome"]),
    ...from(clientMarketing, [
      { id: "inbox", as: "messages", label: "Messages", hidden: false },
      "approve",
      "reviews",
    ]),
    ...from(texts, ["threads"]),
  ],
};

const clientOfficePlace: Module = {
  id: "office",
  name: "Back office",
  icon: "building",
  blurb: "Your account: payments, documents, people and settings.",
  pages: [
    ...from(account, ["overview"], "Account"),
    ...from(payments, [{ id: "links", as: "pay-links" }], "Money"),
    ...from(account, ["billing"], "Money"),
    ...from(documents, [{ id: "all", as: "documents" }, "templates"], "Documents"),
    ...from(work, ["paperwork", "contract"], "Documents"),
    ...from(
      account,
      [
        "you",
        { id: "people", as: "team" },
        "roles",
        "grants",
        { id: "review", as: "access-review" },
        "asks",
      ],
      "Team",
    ),
    ...from(
      account,
      ["accounts", "mail", "social", "connectors", "vendors", "webhooks", "ai", "domain"],
      "Channels",
    ),
    ...from(account, ["look", "fields", "facts", "messaging", "issues", "changes"], "Settings"),
    ...from(clientSettings, ["systems"], "Settings"),
  ],
};

/** A client's places, in sidebar order. */
export const CLIENT_PLACES: Module[] = [
  clientMapPlace,
  clientCampaignsPlace,
  clientContentPlace,
  clientPeoplePlace,
  clientInboxPlace,
  clientCalendar,
  clientOfficePlace,
];
