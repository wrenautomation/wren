import type { Channel } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type AccountType, accounts, type BillCycle, type Bucket, vendors } from "./schema.js";

interface AccountSpec {
  key: string;
  name: string;
  type: AccountType;
  /** T2125 line; my reading of CRA's guide, to be checked before the first return. */
  t2125Line?: string;
  /** An expense's first bucket and channel; William's edits win after the first seed. */
  bucket?: Bucket;
  channel?: Channel;
}

/** The card every bill is paid with until statements say otherwise. */
export const CARD = "card-bmo";
/** GST/HST paid that can be claimed back (input tax credits). */
export const GST_PAID = "gst-paid";

/** The chart of accounts. Expense accounts are the categories spend is sorted into. */
const CHART: readonly AccountSpec[] = [
  { key: CARD, name: "BMO Mastercard", type: "liability" },
  { key: GST_PAID, name: "GST/HST paid (input tax credits)", type: "asset" },
  { key: "owner", name: "Owner's equity", type: "equity" },
  { key: "ai", name: "AI models", type: "expense", t2125Line: "8810", bucket: "overhead" },
  {
    key: "email",
    name: "Email and inboxes",
    type: "expense",
    t2125Line: "8810",
    bucket: "acquisition",
    channel: "email",
  },
  {
    key: "outreach",
    name: "Outreach tools",
    type: "expense",
    t2125Line: "8521",
    bucket: "acquisition",
    channel: "email",
  },
  {
    key: "ads",
    name: "Ads",
    type: "expense",
    t2125Line: "8521",
    bucket: "acquisition",
    channel: "ads",
  },
  {
    key: "hosting",
    name: "Hosting and servers",
    type: "expense",
    t2125Line: "8810",
    bucket: "overhead",
  },
  {
    key: "domains",
    name: "Domains",
    type: "expense",
    t2125Line: "8810",
    bucket: "acquisition",
    channel: "email",
  },
  { key: "code", name: "Code hosting", type: "expense", t2125Line: "8810", bucket: "overhead" },
  {
    key: "phone",
    name: "Phone and SMS",
    type: "expense",
    t2125Line: "9220",
    bucket: "acquisition",
    channel: "sms",
  },
  {
    key: "software",
    name: "Other software",
    type: "expense",
    t2125Line: "8810",
    bucket: "overhead",
  },
  {
    key: "fees",
    name: "Bank and card fees",
    type: "expense",
    t2125Line: "8710",
    bucket: "overhead",
  },
  {
    key: "other",
    name: "Other expenses",
    type: "expense",
    t2125Line: "9270",
    bucket: "overhead",
  },
];

/** Where a vendor's bills arrive: its sender addresses (or domains) and, when it shares them, subject words. */
export interface MailSpec {
  from: readonly string[];
  /** Any of these words or phrases in the subject; absent = every mail from `from`. */
  subject?: readonly string[];
}

export interface VendorSpec {
  key: string;
  name: string;
  /** The expense account its bills post to. */
  account: string;
  mail: MailSpec;
  /** The currency it bills in when a bill prints a bare "$". */
  currency?: string;
  cycle?: BillCycle;
  /** It sells plans only: every bill is on `cycle`, whatever it calls its charges (Google prints seats as "Usage"). */
  plansOnly?: boolean;
  /** One subscription per account, whatever edition a bill names: every monthly or yearly bill is on this plan (Workspace bills two editions the month it switches). */
  plan?: string;
  /** Whether its GST/HST is claimable; false for the simplified regime. Absent = unknown. */
  gstClaimable?: boolean;
  /** Words its card charges carry on the statement ("DYNADOT"), matched whole on the cleaned descriptor. */
  card?: readonly string[];
}

/**
 * Vendors known to bill Wren. Capture reads only these senders, so the
 * personal inbox is never scanned wholesale. Adding a vendor is one entry.
 */
export const VENDORS: readonly VendorSpec[] = [
  {
    key: "anthropic",
    name: "Anthropic",
    account: "ai",
    mail: { from: ["invoice+statements@mail.anthropic.com"] },
    cycle: "monthly",
    // An upgrade (5x to 20x) bills the new edition and credits the old: still one subscription.
    plan: "Max plan",
    gstClaimable: false,
    card: ["ANTHROPIC", "CLAUDE AI"],
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    account: "domains",
    mail: { from: ["notify.cloudflare.com"], subject: ["invoice"] },
    currency: "USD",
    cycle: "yearly",
    card: ["CLOUDFLARE"],
  },
  {
    key: "github",
    name: "GitHub",
    account: "code",
    mail: { from: ["noreply@github.com"], subject: ["payment receipt"] },
    currency: "USD",
    cycle: "monthly",
    card: ["GITHUB"],
  },
  {
    key: "google-workspace",
    name: "Google Workspace",
    account: "email",
    // The same sender bills Google Cloud; the subject tells them apart.
    mail: { from: ["payments-noreply@google.com"], subject: ["Google Workspace"] },
    currency: "CAD",
    cycle: "monthly",
    plansOnly: true,
    plan: "Workspace",
    gstClaimable: false,
    card: ["GOOGLE WORKSPACE", "GOOGLE GSUITE", "GSUITE"],
  },
  {
    key: "instantly",
    name: "Instantly",
    account: "outreach",
    mail: { from: ["stripe.com"], subject: ["instantly"] },
    currency: "USD",
    cycle: "monthly",
    card: ["INSTANTLY"],
  },
  {
    key: "racknerd",
    name: "RackNerd",
    account: "hosting",
    mail: { from: ["support@racknerd.com"], subject: ["invoice", "payment", "order"] },
    currency: "USD",
    card: ["RACKNERD"],
  },
  {
    key: "telnyx",
    name: "Telnyx",
    account: "phone",
    mail: { from: ["portal@telnyx.com"], subject: ["payment success"] },
    currency: "USD",
    cycle: "usage",
    card: ["TELNYX"],
  },
  {
    key: "aws",
    name: "Amazon Web Services",
    account: "hosting",
    mail: {
      from: ["aws-billing@amazon.com", "no-reply-aws@amazon.com"],
      subject: ["billing statement", "invoice"],
    },
    currency: "USD",
    cycle: "usage",
    card: ["AWS", "AMAZON WEB SERVICES"],
  },
  {
    key: "google-cloud",
    name: "Google Cloud",
    account: "hosting",
    mail: { from: ["payments-noreply@google.com"], subject: ["Google Cloud"] },
    currency: "CAD",
    cycle: "usage",
    card: ["GOOGLE CLOUD"],
  },
  {
    key: "inbox-insiders",
    name: "Inbox Insiders",
    account: "email",
    // Lead Gen Jay's shop; its mail confirms orders, the card has the charge.
    mail: { from: ["updates.leadgenjay.com"], subject: ["order", "receipt", "invoice", "payment"] },
    currency: "USD",
    cycle: "monthly",
    card: ["LEADGENJAY", "LEAD GEN JAY", "INBOX INSIDERS", "INBOXINSIDERS"],
  },
  {
    key: "dynadot",
    name: "Dynadot",
    account: "domains",
    mail: { from: ["orders@dynadot.com"], subject: ["order finished"] },
    currency: "USD",
    cycle: "yearly",
    card: ["DYNADOT"],
  },
  {
    key: "godaddy",
    name: "GoDaddy",
    account: "domains",
    mail: { from: ["godaddy.com"], subject: ["receipt", "order confirmation"] },
    cycle: "yearly",
    card: ["GODADDY", "GO DADDY"],
  },
  {
    key: "x",
    name: "X",
    account: "software",
    mail: { from: ["invoice+statements+acct_1Ika5JA3KZ32dPo1@stripe.com"] },
    currency: "USD",
    cycle: "monthly",
    card: ["X CORP", "TWITTER", "X PREMIUM"],
  },
];

export function vendorSpec(key: string): VendorSpec | undefined {
  return VENDORS.find((v) => v.key === key);
}

/** Upsert the chart and the vendor registry. Idempotent; run before every import. */
export async function seedBooks(db: Queryable): Promise<void> {
  await db
    .insert(accounts)
    .values(
      CHART.map((a) => ({
        key: a.key,
        name: a.name,
        type: a.type,
        t2125Line: a.t2125Line,
        bucket: a.bucket,
        channel: a.channel,
      })),
    )
    // Bucket and channel are set on the first seed only, so William's edits stay.
    .onConflictDoUpdate({
      target: accounts.key,
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        t2125Line: sql`excluded.t2125_line`,
      },
    });
  const ids = new Map(
    (await db.select({ id: accounts.id, key: accounts.key }).from(accounts)).map((a) => [
      a.key,
      a.id,
    ]),
  );
  await db
    .insert(vendors)
    .values(
      VENDORS.map((v) => {
        const accountId = ids.get(v.account);
        if (accountId === undefined) throw new Error(`vendor ${v.key}: no account ${v.account}`);
        return {
          key: v.key,
          name: v.name,
          accountId,
          cycle: v.cycle ?? null,
          gstClaimable: v.gstClaimable ?? null,
        };
      }),
    )
    .onConflictDoUpdate({
      target: vendors.key,
      set: {
        name: sql`excluded.name`,
        accountId: sql`excluded.account_id`,
        cycle: sql`excluded.cycle`,
        gstClaimable: sql`excluded.gst_claimable`,
      },
    });
}
