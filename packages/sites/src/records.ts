/**
 * Sites as records (designs/2026-10-07-sites.md, "Portal"): every page we run in one list, and
 * each page's numbers by where its visits came from. Served by the console on Wren's database.
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
import { pageDetail } from "./detail.js";
import { UUID } from "./store.js";

export const PAGE_RECORD = "sites.page";
export const FUNNEL_RECORD = "sites.funnel";

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

export const pageRecord: RecordType = defineRecord({
  id: PAGE_RECORD,
  app: "sites",
  channel: null,
  name: { one: "page", many: "pages" },
  view: "site_page_records",
  key: "id",
  title: "title",
  subtitle: "url",
  fields: {
    title: text("Page"),
    address: text("Address"),
    url: link("URL", { listed: false }),
    kind: status(KINDS, "Kind"),
    source: status(
      {
        data: { label: "Data", tone: "neutral" },
        code: { label: "Code", tone: "neutral" },
        derived: { label: "Found", tone: "neutral" },
      },
      "Built as",
    ),
    owner: text("Owner"),
    status: status(STATUSES, "Status"),
    waiting: number("Waiting version", { listed: false }),
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
  },
  views: [
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
      where: { waiting: { empty: false } },
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
  ],
  actions: [
    "sites.create",
    "sites.add",
    "sites.duplicate",
    "sites.retire",
    // From the page's own detail: its copy form, Claude's draft, the ask, its notes.
    "sites.save",
    "sites.draft",
    "sites.ask",
    "sites.notes",
  ],
  load: loadPage,
});

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

export const SITES_RECORDS: readonly RecordType[] = [pageRecord, funnelRecord];
