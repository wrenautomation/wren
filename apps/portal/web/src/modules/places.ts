/**
 * The places (designs/2026-11-04-portal-places.md, Lean places). Wren: Map, Today, Campaigns,
 * Research, Variants, People, Back office. A client: Today, Project, Campaigns, People, Back office. A page
 * keeps its own component and access, so a client sees only what it holds. Old addresses:
 * `../moved.ts`.
 */
import { findAll } from "../find.js";
import type { Found, ListPage, Module, ModulePage } from "../module.js";
import { account } from "./account/index.js";
import { calendar, clientCalendar } from "./calendar/index.js";
import { recorderHead } from "./calendar/recorder.js";
import { calls } from "./calls/index.js";
import { documents } from "./documents/index.js";
import { clientMarketing, content as oldContent } from "./marketing/index.js";
import { CONVERSATION_TOP } from "./marketing/pages.js";
import { engage } from "./outreach/index.js";
import { payments } from "./payments/index.js";
import { clientPeople as oldClientPeople, people as oldPeople } from "./people/index.js";
import { reactivation } from "./reactivation/index.js";
import { settings } from "./settings/index.js";
import { work } from "./work/index.js";
import { inbox } from "./wren/inbox.js";
import { clients, money, outbound, system, team } from "./wren/index.js";

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
/** A copy keeps its page's old address. */
const keep = (from: ModulePage, to: ModulePage): ModulePage => {
  const was = WAS.get(from);
  if (was) WAS.set(to, was);
  return to;
};
/** Off the tabs, reached by link. */
const hide = (p: ModulePage): ModulePage => keep(p, { ...p, hidden: true } as ModulePage);
/** Tabs of a fixed place: no sidebar groups. */
const flat = (ps: ModulePage[]): ModulePage[] =>
  ps.map((p) => {
    const { group: _g, ...rest } = p;
    return keep(p, rest as ModulePage);
  });
const one = (m: Module, take: string | Take): ModulePage => {
  const [p] = from(m, [take]);
  if (!p) throw new Error(`places: ${m.id} has no page`);
  return p;
};

// Wren's team.

const mapPlace: Module = {
  id: "map",
  name: "Map",
  icon: "workflow",
  blurb: "What we sell and how each offer runs, on the metro map.",
  requires: TEAM,
  // the metro map is its home (`/`); no pages under it
  pages: [],
};

const todayPlace: Module = {
  id: "today",
  name: "Today",
  icon: "inbox",
  blurb: "What waits on you now: approvals, messages, mail and calls.",
  requires: TEAM,
  pages: [
    ...flat(from(engage, ["approve", { id: "inbox", as: "messages", label: "Messages" }])),
    ...flat(from(inbox, ["mail"])),
    ...flat(from(calendar, [{ id: "schedule", as: "calendar", label: "Calendar" }])),
    ...from(engage, ["dms", "comments"]).map(hide),
    ...from(inbox, ["replies", "mentions", "issues", "asks", "rules"]).map(hide),
    ...from(calendar, ["calls", "recordings"]).map(hide),
  ],
};

/** Every campaign's channels in one place: content made and posted, outreach off it, cold email. */
const campaignsPlace: Module = {
  id: "campaigns",
  name: "Campaigns",
  icon: "megaphone",
  blurb: "Content, outreach and cold email: what each campaign makes, sends and gets.",
  requires: TEAM,
  find: finds(oldContent, outbound),
  pages: [
    {
      id: "overview",
      label: "Overview",
      about: "What the campaigns got, on one board.",
      template: "overview",
      tiles: [
        {
          label: "Content views",
          record: "marketing.post",
          href: "/campaigns/content?view=all",
          period: "month",
          sum: "views",
        },
        {
          label: "Followers",
          record: "marketing.audience",
          href: "/campaigns/followers",
          sum: "count",
        },
        {
          label: "Calls booked",
          record: "calendar.booking",
          href: "/today/calls?view=booked",
          period: 30,
        },
      ],
      top: [CONVERSATION_TOP],
    },
    ...from(oldContent, ["studio", "content"], "Content"),
    ...from(oldContent, [
      { id: "drafts", lights: "studio" },
      { id: "videos", lights: "studio" },
      { id: "write", lights: "studio" },
    ]).map(hide),
    ...from(engage, [{ id: "followers", lights: "content" }]).map(hide),
    ...from(engage, ["engage", "conversation"], "Outreach"),
    ...from(
      outbound,
      [{ id: "overview", as: "email", label: "Cold email" }, "inboxes"],
      "Outreach",
    ),
    ...from(engage, [{ id: "invites", lights: "engage" }]).map(hide),
    ...from(outbound, [{ id: "campaigns", as: "email-campaigns", lights: "email" }]).map(hide),
    // Calls within a day: Today's Prepare call.
    hide({
      ...(one(calls, { id: "calls", lights: "email" }) as ListPage),
      head: recorderHead,
      count: { soon: ["yes"] },
    }),
  ],
};

const peoplePlace: Module = {
  ...oldPeople,
  blurb: "Everyone we know, once each.",
  find: finds(oldPeople, clients),
  pages: [
    ...from(oldPeople, ["people"]),
    ...from(clients, [{ id: "all", as: "clients" }]),
    ...from(oldPeople, ["timeline"]),
  ],
};

const officePlace: Module = {
  id: "office",
  name: "Back office",
  icon: "building",
  blurb: "Runs the company: contracts, money, accounts and team.",
  requires: TEAM,
  pages: [
    ...from(documents, [{ id: "all", as: "documents", label: "Contracts" }], "Contracts"),
    ...from(
      money,
      [{ id: "overview", as: "money", label: "Money" }, "spend", "models", "payments-in"],
      "Money",
    ),
    ...from(money, [{ id: "subscriptions", lights: "money" }]).map(hide),
    ...from(engage, [{ id: "accounts", as: "accounts" }], "Accounts"),
    ...from(team, [{ id: "all", as: "team" }, "grants"], "Team"),
    ...from(settings, ["look", "experiments"], "Workspace"),
    ...from(system, ["speed"], "System"),
  ],
};

/** Wren's places, in sidebar order. Research is Weaver's own place (`./index.ts`). */
export const TEAM_PLACES: Module[] = [
  mapPlace,
  todayPlace,
  campaignsPlace,
  peoplePlace,
  officePlace,
];

// A client's workspace.

const clientTodayPlace: Module = {
  id: "today",
  name: "Today",
  icon: "inbox",
  blurb: "What waits on you: our asks, drafts to approve, messages and calls.",
  pages: [
    ...flat(from(work, ["needs-you"])),
    ...flat(
      from(clientMarketing, [
        "approve",
        { id: "inbox", as: "messages", label: "Messages", hidden: false },
      ]),
    ),
    ...flat(from(clientCalendar, [{ id: "schedule", as: "calendar", label: "Calendar" }])),
    ...from(clientCalendar, ["calls"]).map(hide),
  ],
};

/** A client's project: the plan of what it bought, our updates and what we hand over. */
const projectPlace: Module = {
  id: "project",
  name: "Project",
  icon: "workflow",
  blurb: "What we do for you and where it stands.",
  fallback: true,
  // William 11-12: out of the sidebar; links, ⌘K and Today's offer cards still open it
  parked: true,
  ...(work.Glance ? { Glance: work.Glance } : {}),
  pages: [
    ...from(work, ["overview", "plan", "updates", "deliverables", "results"]),
    ...from(work, ["welcome"]).map(hide),
  ],
};

/** A client's campaigns: its reactivation run and its content. */
const clientCampaignsPlace: Module = {
  id: "campaigns",
  name: "Campaigns",
  icon: "megaphone",
  blurb: "Your reactivation run and your posts.",
  ...(reactivation.Glance ? { Glance: reactivation.Glance } : {}),
  find: finds(reactivation),
  pages: [
    ...from(reactivation, ["overview", "emails", "replies", "setup"], "Reactivation"),
    ...from(reactivation, ["run", "people", "keep", "real"]).map(hide),
    ...from(calls, [{ id: "calls", lights: "overview" }]).map(hide),
    ...from(
      clientMarketing,
      [
        { id: "drafts", lights: null },
        { id: "content", hidden: false },
      ],
      "Content",
    ),
  ],
};

const clientPeoplePlace: Module = {
  ...oldClientPeople,
  find: finds(oldClientPeople),
  pages: [
    // Channels is cut, as at Wren: funnels are Results. Sent has no tab; a broadcast opens its log.
    ...from(oldClientPeople, ["sent"]).map(hide),
    ...from(oldClientPeople, [
      "people",
      "timeline",
      "groups",
      "members",
      "broadcasts",
      "recipients",
      "import",
    ]),
  ],
};

const clientOfficePlace: Module = {
  id: "office",
  name: "Back office",
  icon: "building",
  blurb: "Your account: contract, invoices, accounts and team.",
  pages: [
    ...from(account, ["overview"], "Account"),
    ...from(work, ["contract", "paperwork"], "Contract"),
    ...from(documents, [{ id: "all", as: "documents" }], "Contract"),
    ...from(account, ["billing"], "Money"),
    ...from(payments, [{ id: "links", as: "pay-links" }], "Money"),
    ...from(account, ["accounts", "social", "mail"], "Accounts"),
    ...from(account, [{ id: "people", as: "team" }, "you", "grants", "look"], "Team"),
  ],
};

/** A client's places, in sidebar order. */
export const CLIENT_PLACES: Module[] = [
  clientTodayPlace,
  projectPlace,
  clientCampaignsPlace,
  clientPeoplePlace,
  clientOfficePlace,
];
