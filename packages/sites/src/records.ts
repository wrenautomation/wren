/**
 * Sites as records (designs/2026-10-07-sites.md, "Portal"): every page we run in one list, and
 * each page's numbers by where its visits came from. Hosted forms and every submission
 * (designs/2026-10-07-forms-and-pay.md). Served by the console on Wren's database.
 */
import {
  actor,
  date,
  defineRecord,
  link,
  money,
  number,
  percent,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { pageDetail } from "./detail.js";
import { formById, formDetail } from "./form-store.js";
import { pageById, UUID } from "./store.js";

export const PAGE_RECORD = "sites.page";
export const FUNNEL_RECORD = "sites.funnel";
export const FORM_RECORD = "sites.form";
export const ENTRY_RECORD = "sites.entry";
export const LINK_RECORD = "sites.link";

const KINDS = {
  lander: { label: "Lander", tone: "neutral" },
  listicle: { label: "Listicle", tone: "neutral" },
  pitch: { label: "Pitch page", tone: "neutral" },
  demo: { label: "Demo video", tone: "neutral" },
  booking: { label: "Booking", tone: "neutral" },
  "thank-you": { label: "Thank you", tone: "neutral" },
  portal: { label: "Portal", tone: "neutral" },
} as const;

const STATUSES = {
  draft: { label: "Draft", tone: "warn" },
  live: { label: "Live", tone: "good" },
  retired: { label: "Retired", tone: "neutral" },
} as const;

const CHANNELS = {
  ads: { label: "Ads", tone: "neutral" },
  organic: { label: "Organic", tone: "neutral" },
  outreach: { label: "Outreach", tone: "neutral" },
  referral: { label: "Referral", tone: "neutral" },
  direct: { label: "Direct", tone: "neutral" },
  other: { label: "Other", tone: "neutral" },
} as const;

/** A page's detail past its row; derived pages (videos, hosts) have none. */
async function loadPage(db: Queryable, id: string) {
  if (!UUID.test(id)) return null;
  return pageDetail(db, id);
}

/** A page row's fields: Wren's list and a client's alike. */
const PAGE_FIELDS = {
  title: text("Page"),
  address: text("Address"),
  url: link("URL", { listed: false }),
  // Before Kind: a phone's list shows the first state that tells rows apart.
  status: status(STATUSES, "Status"),
  kind: status(KINDS, "Kind"),
  source: status(
    {
      data: { label: "Data", tone: "neutral" },
      code: { label: "Code", tone: "neutral" },
      derived: { label: "Found", tone: "neutral" },
    },
    "Built as",
  ),
  ownerName: text("Owner"),
  owner: text("Owner id", { listed: false, group: "System" }),
  waiting: number("Waiting version", { listed: false }),
  asked: status(
    {
      publish: { label: "To publish", tone: "warn" },
      retire: { label: "To retire", tone: "warn" },
    },
    "Waiting on a yes",
  ),
  offer: text("Offer"),
  angle: text("Angle"),
  audience: text("Audience", { listed: false }),
  stage: status(
    {
      reach: { label: "Reach", tone: "neutral" },
      trust: { label: "Trust", tone: "neutral" },
      convert: { label: "Convert", tone: "neutral" },
    },
    "Funnel stage",
  ),
  views: number("Visits"),
  ctas: number("Clicks", { listed: false }),
  forms: number("Forms"),
  books: number("Bookings"),
  formRate: percent("Form rate"),
  ads: number("Ads in"),
  spend: money("Spend"),
  costPerForm: money("Cost per form"),
  template: text("Template", { listed: false, group: "Source" }),
  repoPath: text("Repo path", { listed: false, group: "Source" }),
  variantOf: text("Variant of", { listed: false, group: "Source" }),
  changed: date("Last change"),
  changedBy: actor("Changed by"),
  split: status(
    {
      running: { label: "Running", tone: "neutral" },
      shipping: { label: "Winner waiting", tone: "warn" },
    },
    "A/B split",
  ),
};

const PAGE_VIEWS = [
  {
    id: "pages",
    label: "Pages",
    where: { source: ["data", "code"], status: ["draft", "live"] },
    sort: "-changed",
    at: "changed",
  },
  {
    id: "live",
    label: "Live",
    where: { status: "live", source: ["data", "code"] },
    sort: "-views",
    at: "changed",
  },
  {
    id: "waiting",
    label: "Waiting",
    where: { asked: ["publish", "retire"] },
    sort: "-changed",
    at: "changed",
  },
  { id: "ads", label: "From ads", where: { ads: { gte: 1 } }, sort: "-spend", at: "changed" },
  { id: "everything", label: "Everything", sort: "-changed", at: "changed" },
  {
    id: "retired",
    label: "Retired",
    where: { status: "retired" },
    sort: "-changed",
    at: "changed",
  },
  {
    id: "splits",
    label: "Splits",
    where: { split: ["running", "shipping"] },
    sort: "-views",
    at: "changed",
  },
];

export const pageRecord: RecordType = defineRecord({
  id: PAGE_RECORD,
  app: "sites",
  channel: null,
  name: { one: "page", many: "pages" },
  view: "site_page_records",
  key: "id",
  title: "title",
  subtitle: "url",
  fields: PAGE_FIELDS,
  views: PAGE_VIEWS,
  actions: [
    "sites.create",
    "sites.add",
    "sites.duplicate",
    "sites.retire",
    "sites.retireAsk",
    // From the page's own detail: its copy form, Claude's draft, the ask, its notes.
    "sites.save",
    "sites.draft",
    "sites.ask",
    "sites.notes",
    "sites.splitStart",
    "sites.splitWeights",
    "sites.splitStop",
    "sites.splitShip",
  ],
  load: loadPage,
});

/**
 * A client's own pages, on its own host: the same list, its rows that client's only. Built per
 * request, as Payments' links are. Its yes and no check the client's approver.
 */
export function pageRecordFor(client: string): RecordType {
  return defineRecord({
    id: PAGE_RECORD,
    app: "sites",
    channel: null,
    name: { one: "page", many: "pages" },
    rows: async (db) => [
      ...(await db.execute(sql`select * from site_page_records where owner = ${client}`)),
    ],
    key: "id",
    title: "title",
    subtitle: "url",
    fields: PAGE_FIELDS,
    views: PAGE_VIEWS,
    actions: [
      "sites.approve",
      "sites.decline",
      // From the page's detail: the copy editor's save and ask, a stopped split's retire ask.
      "sites.save",
      "sites.ask",
      "sites.retireAsk",
      "sites.splitStart",
      "sites.splitWeights",
      "sites.splitStop",
      "sites.splitShip",
    ],
    load: async (db, id) => {
      const p = UUID.test(id) ? await pageById(db, id) : null;
      return p && p.client === client ? pageDetail(db, id) : null;
    },
  });
}

export const funnelRecord: RecordType = defineRecord({
  id: FUNNEL_RECORD,
  app: "sites",
  channel: null,
  name: { one: "source", many: "sources" },
  view: "site_funnel_records",
  key: "id",
  title: "title",
  subtitle: "channel",
  fields: {
    title: text("Page"),
    channel: status(CHANNELS, "Source"),
    offer: text("Offer"),
    status: status(STATUSES, "Status"),
    views: number("Visits"),
    ctas: number("Clicks"),
    forms: number("Forms"),
    books: number("Bookings"),
    formRate: percent("Form rate"),
    spend: money("Spend"),
    costPerForm: money("Cost per form"),
    last: date("Last visit"),
    page: text("Page id", { listed: false, group: "System" }),
  },
  views: [
    { id: "all", label: "By source", sort: "-views", at: "last" },
    { id: "ads", label: "Ads", where: { channel: "ads" }, sort: "-spend", at: "last" },
    { id: "organic", label: "Organic", where: { channel: "organic" }, sort: "-views", at: "last" },
    {
      id: "outreach",
      label: "Outreach",
      where: { channel: "outreach" },
      sort: "-views",
      at: "last",
    },
  ],
});

const FORM_BASE = {
  id: FORM_RECORD,
  app: "sites",
  channel: null,
  name: { one: "form", many: "forms" },
  key: "id",
  title: "name",
  subtitle: "address",
  fields: {
    name: text("Form"),
    address: text("Address"),
    url: link("URL", { listed: false }),
    slug: text("Slug", { listed: false }),
    ownerName: text("Owner"),
    owner: text("Owner id", { listed: false, group: "System" }),
    status: status(STATUSES, "Status"),
    fields: number("Fields", { listed: false }),
    views: number("Views"),
    starts: number("Starts"),
    submits: number("Submits"),
    conversion: percent("Conversion"),
    last: date("Last submit"),
    changed: date("Last change", { listed: false }),
    changedBy: actor("Changed by"),
  },
  views: [
    {
      id: "forms",
      label: "Forms",
      where: { status: ["draft", "live"] },
      sort: "-changed",
      at: "changed",
    },
    { id: "live", label: "Live", where: { status: "live" }, sort: "-submits", at: "last" },
    {
      id: "retired",
      label: "Retired",
      where: { status: "retired" },
      sort: "-changed",
      at: "changed",
    },
  ],
  actions: [
    "sites.formCreate",
    "sites.formPublish",
    "sites.formUnpublish",
    "sites.formRetire",
    // From the form's own detail: the builder's save and its A/B test.
    "sites.formSave",
    "sites.formSplitStart",
    "sites.formSplitSave",
    "sites.formSplitStop",
    "sites.formSplitShip",
  ],
} as const;

export const formRecord: RecordType = defineRecord({
  ...FORM_BASE,
  view: "site_form_records",
  load: async (db, id) => (UUID.test(id) ? formDetail(db, id) : null),
});

/** A client's own forms, on its host: its rows only, and only its form opens. */
export function formRecordFor(client: string): RecordType {
  return defineRecord({
    ...FORM_BASE,
    rows: async (db) => [
      ...(await db.execute(sql`select * from site_form_records where owner = ${client}`)),
    ],
    load: async (db, id) => {
      const f = UUID.test(id) ? await formById(db, id) : null;
      return f && f.client === client ? formDetail(db, id) : null;
    },
  });
}

const ENTRY_BASE = {
  id: ENTRY_RECORD,
  app: "sites",
  channel: null,
  name: { one: "submission", many: "submissions" },
  key: "id",
  title: "who",
  subtitle: "formName",
  fields: {
    who: text("Name"),
    email: text("Email"),
    phone: text("Phone"),
    formName: text("Form"),
    pageTitle: text("Page"),
    ownerName: text("Owner"),
    owner: text("Owner id", { listed: false, group: "System" }),
    at: date("Sent"),
    channel: status(CHANNELS, "Source"),
    source: text("UTM source"),
    campaign: text("UTM campaign", { listed: false }),
    consented: status(
      {
        yes: { label: "Opted in", tone: "good" },
        no: { label: "No", tone: "neutral" },
      },
      "Text consent",
    ),
    consentVersion: text("Consent version", { listed: false, group: "Consent" }),
    consentText: text("Consent words", { listed: false, group: "Consent" }),
    entered: status(
      {
        in: { label: "In", tone: "good" },
        out: { label: "Not in", tone: "warn" },
      },
      "Door",
    ),
    why: text("Why not", { listed: false }),
    answers: text("Answers", { listed: false }),
    visitor: text("Visitor", { listed: false, group: "System" }),
    human: text("Turnstile", { listed: false, group: "System" }),
    form: text("Form id", { listed: false, group: "System" }),
    page: text("Page id", { listed: false, group: "System" }),
  },
  views: [
    { id: "all", label: "All", sort: "-at", at: "at" },
    {
      id: "forms",
      label: "Hosted forms",
      where: { form: { empty: false } },
      sort: "-at",
      at: "at",
    },
    { id: "consent", label: "Opted in", where: { consented: "yes" }, sort: "-at", at: "at" },
    { id: "out", label: "Not in the door", where: { entered: "out" }, sort: "-at", at: "at" },
  ],
} as const;

export const entryRecord: RecordType = defineRecord({
  ...ENTRY_BASE,
  view: "site_entry_records",
});

/** A client's own submissions, on its host. */
export function entryRecordFor(client: string): RecordType {
  return defineRecord({
    ...ENTRY_BASE,
    rows: async (db) => [
      ...(await db.execute(sql`select * from site_entry_records where owner = ${client}`)),
    ],
  });
}

const LINK_FIELDS = {
  name: text("Link"),
  pageTitle: text("Page"),
  url: link("URL", { listed: false }),
  ownerName: text("Owner"),
  channel: status(CHANNELS, "Source"),
  source: text("UTM source"),
  medium: text("UTM medium", { listed: false }),
  campaign: text("UTM campaign"),
  content: text("Post or ad id", { listed: false }),
  clicks: number("Clicks"),
  visits: number("Visits"),
  forms: number("Forms"),
  books: number("Bookings"),
  last: date("Last hit"),
  created: date("Made"),
  createdBy: actor("Made by"),
  owner: text("Owner id", { listed: false, group: "System" }),
  link: text("Short name", { listed: false, group: "System" }),
  slug: text("Slug", { listed: false, group: "System" }),
  page: text("Page id", { listed: false, group: "System" }),
};
const LINK_VIEWS = [
  { id: "all", label: "Links", sort: "-created", at: "created" },
  { id: "used", label: "With visits", where: { visits: { gte: 1 } }, sort: "-visits", at: "last" },
  { id: "ads", label: "Ads", where: { channel: "ads" }, sort: "-visits", at: "last" },
];
const LINK_BASE = {
  id: LINK_RECORD,
  app: "sites",
  channel: null,
  name: { one: "link", many: "links" },
  key: "id",
  title: "name",
  subtitle: "url",
  fields: LINK_FIELDS,
  views: LINK_VIEWS,
  actions: [],
} as const;

/** Tracked `/go/` links, Wren's and each client's, with what each brought. */
export const linkRecord: RecordType = defineRecord({
  ...LINK_BASE,
  view: "site_link_records",
});

/** A client's own links, on its host. */
export function linkRecordFor(client: string): RecordType {
  return defineRecord({
    ...LINK_BASE,
    rows: async (db) => [
      ...(await db.execute(sql`select * from site_link_records where owner = ${client}`)),
    ],
  });
}

export const SITES_RECORDS: readonly RecordType[] = [
  pageRecord,
  linkRecord,
  funnelRecord,
  formRecord,
  entryRecord,
];
