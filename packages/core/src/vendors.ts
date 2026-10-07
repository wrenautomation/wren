/**
 * Metered vendors (designs/2026-10-07-setup-and-vendors.md): what each one charges, its quota per
 * key, and per owner whether it runs on the owner's key or Wren's. A bucket is (vendor, key): an
 * own key has its quota to itself; Wren's managed key is split by per-client shares under a
 * reserve Wren keeps. Every metered call writes a usage row; `gate` says yes, or why not.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, asc, eq, gte, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Bucket, bucketRoom } from "./buckets.js";
import { clients, wrenSettings } from "./clients/schema.js";
import type { KeyStore } from "./keys.js";
import { type VendorMode, type VendorModeRow, vendorModes, vendorUsage } from "./vendor-schema.js";

export interface Vendor {
  id: string;
  name: string;
  /** One unit, said to a person: "search", "post read". */
  unit: string;
  /** Micro-dollars a unit at the public price; 0 free; null no public price (estimates $0). */
  micros: number | null;
  /** The vendor's pricing page and the day it was read. */
  url: string | null;
  asOf: string;
  /** A key's read limit; null: none, only money stops it. */
  quota: Bucket | null;
  /** What "own key" means: a key in the key store, the client's login on that site, or not offered. */
  own: "key" | "login" | null;
  /** The key's name in the key store, as Wren's env names it. */
  keyName: string | null;
  /** "Managed by Wren" isn't built for it yet: clients bring their own, and it says so. */
  managedDev?: true;
}

const AS_OF = "2026-10-07";

export const VENDORS: readonly Vendor[] = [
  {
    id: "exa",
    name: "Exa search",
    unit: "search",
    micros: 7_000,
    url: "https://exa.ai/pricing",
    asOf: AS_OF,
    quota: null,
    own: "key",
    keyName: "EXA_API_KEY",
  },
  {
    id: "youtube",
    name: "YouTube Data API",
    unit: "quota unit",
    micros: 0,
    url: "https://developers.google.com/youtube/v3/getting-started#quota",
    asOf: AS_OF,
    quota: { perDay: 10_000, burst: 2_000 },
    own: "key",
    keyName: "YOUTUBE_API_KEY",
  },
  {
    id: "google_search",
    name: "Google search reads",
    unit: "search",
    micros: 0,
    url: null,
    asOf: AS_OF,
    quota: { perDay: 200, burst: 20 },
    own: null,
    keyName: null,
  },
  {
    id: "x",
    name: "X API",
    unit: "post read",
    micros: 5_000,
    url: "https://docs.x.com/x-api/getting-started/pricing",
    asOf: AS_OF,
    quota: null,
    own: "key",
    keyName: "X_BEARER_TOKEN",
  },
  {
    // The account itself: the fallback when search came back thin, 20 a day across every kind
    // (designs/2026-10-07-linkedin-search-first.md).
    id: "linkedin",
    name: "LinkedIn account reads",
    unit: "account read",
    micros: 0,
    url: null,
    asOf: AS_OF,
    quota: { perDay: 20, burst: 4 },
    own: "login",
    keyName: null,
  },
  {
    // A LinkedIn read that Exa or Google served: the account never saw it. Exa's credit is on
    // autobrowse's key ring, capped there.
    id: "linkedin_search",
    name: "LinkedIn reads by search",
    unit: "search read",
    micros: 0,
    url: null,
    asOf: AS_OF,
    quota: null,
    own: null,
    keyName: null,
  },
  {
    id: "models",
    name: "Models through the gateway",
    unit: "call",
    micros: null,
    url: null,
    asOf: AS_OF,
    quota: null,
    own: "key",
    keyName: "MODEL_API_KEY",
  },
  {
    id: "reddit",
    name: "Reddit reads",
    unit: "search",
    micros: 0,
    url: null,
    asOf: AS_OF,
    quota: { perDay: 400, burst: 40 },
    own: null,
    keyName: null,
  },
  {
    id: "telnyx",
    name: "Texts",
    unit: "message part",
    micros: 4_000,
    url: "https://telnyx.com/pricing/messaging",
    asOf: AS_OF,
    quota: null,
    own: "key",
    keyName: "TELNYX_API_KEY",
  },
  {
    // Pay links (designs/2026-10-07-forms-and-pay.md). Stripe takes its fee from each payment, on
    // the client's own account; Wren pays nothing per link.
    id: "stripe",
    name: "Stripe payments",
    unit: "pay link",
    micros: 0,
    url: "https://stripe.com/pricing",
    asOf: AS_OF,
    quota: null,
    own: "key",
    keyName: "STRIPE_SECRET_KEY",
    managedDev: true,
  },
];

export const vendorOf = (id: string): Vendor => {
  const v = VENDORS.find((x) => x.id === id);
  if (!v) throw new Error(`no such vendor: ${id}`);
  return v;
};

/** Said for a price: "$7.00 per 1,000 searches", "free", "no public price". */
export function priceText(v: Vendor): string {
  if (v.micros === null) return "no public price";
  if (v.micros === 0) return "free";
  return `$${((v.micros * 1000) / 1_000_000).toFixed(2)} per 1,000 ${unitsOf(v)}`;
}

/** The unit, plural: "searches", "post reads". */
export const unitsOf = (v: Pick<Vendor, "unit">) =>
  /(s|sh|ch|x)$/.test(v.unit) ? `${v.unit}es` : `${v.unit}s`;

// ---- Wren's vendor settings ----

export const VENDOR_SETTINGS = "vendors";

/** Wren's calls on every vendor; `wren_settings` block `vendors`. William sets them. */
export const vendorSettingsSchema = z.object({
  /** Added to cost on a client's usage lines. */
  markupPct: z.number().min(0).max(500).default(0),
  /** The share of each managed quota clients may never take. */
  reservePct: z.number().min(0).max(100).default(50),
  /**
   * Vendors a client may use on Wren's key. LinkedIn reads would read as William's own; Stripe
   * on Wren's account (Connect) isn't built.
   */
  managedForClients: z
    .array(z.string())
    .default(VENDORS.filter((v) => v.id !== "linkedin" && !v.managedDev).map((v) => v.id)),
});
export type VendorSettings = z.infer<typeof vendorSettingsSchema>;

export async function vendorSettings(main: Queryable): Promise<VendorSettings> {
  const [row] = await main
    .select({ settings: wrenSettings.settings })
    .from(wrenSettings)
    .where(eq(wrenSettings.component, VENDOR_SETTINGS));
  const parsed = vendorSettingsSchema.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : vendorSettingsSchema.parse({});
}

// ---- modes ----

export async function modesOf(main: Queryable, client: string): Promise<VendorModeRow[]> {
  return main
    .select()
    .from(vendorModes)
    .where(eq(vendorModes.client, client))
    .orderBy(asc(vendorModes.vendor));
}

async function modeOf(main: Queryable, client: string, vendor: string) {
  const [row] = await main
    .select()
    .from(vendorModes)
    .where(and(eq(vendorModes.client, client), eq(vendorModes.vendor, vendor)));
  return row ?? null;
}

async function upsertMode(
  db: Queryable,
  client: string,
  vendor: string,
  set: {
    mode: VendorMode;
    keyName?: string | null;
    perDay?: number;
    capCents?: number;
    by: string;
  },
) {
  const values = {
    client,
    vendor,
    mode: set.mode,
    keyName: set.keyName ?? null,
    perDay: set.perDay ?? 0,
    capCents: set.capCents ?? 0,
    updatedBy: set.by,
  };
  await db
    .insert(vendorModes)
    .values(values)
    .onConflictDoUpdate({
      target: [vendorModes.client, vendorModes.vendor],
      set: {
        mode: set.mode,
        ...(set.keyName !== undefined ? { keyName: set.keyName } : {}),
        ...(set.perDay !== undefined ? { perDay: set.perDay } : {}),
        ...(set.capCents !== undefined ? { capCents: set.capCents } : {}),
        updatedBy: set.by,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Put a client on Wren's key for a vendor, with its daily share and monthly cap. Only vendors
 * Wren's settings offer to clients.
 */
export async function setManaged(
  main: Db,
  o: { client: string; vendor: string; perDay: number; capCents: number; by: string },
): Promise<void> {
  const v = vendorOf(o.vendor);
  const s = await vendorSettings(main);
  if (v.managedDev || !s.managedForClients.includes(v.id))
    throw new Error(`${v.name} isn't offered managed`);
  if (!Number.isInteger(o.perDay) || o.perDay < 0)
    throw new Error("share: a whole number, 0 or more");
  if (!Number.isInteger(o.capCents) || o.capCents < 0)
    throw new Error("cap: whole cents, 0 or more");
  await upsertMode(main, o.client, v.id, {
    mode: "managed",
    perDay: o.perDay,
    capCents: o.capCents,
    by: o.by,
  });
}

/**
 * Use a client's own key: the key staged at the edge (`keyRef`) becomes its live key, and the
 * row keeps its ref. The key is never read back to a page, only its last 4. A login vendor
 * (LinkedIn) takes the client's account instead.
 */
export async function setOwnKey(
  main: Db,
  store: KeyStore | null,
  o: { client: string; vendor: string; keyRef: string; by: string },
): Promise<{ keyName: string; last4: string }> {
  const v = vendorOf(o.vendor);
  if (v.own !== "key" || !v.keyName) throw new Error(`${v.name} takes no key of the client's`);
  if (!store) throw new Error("Key store not set up here");
  const [c] = await main.select({ id: clients.id }).from(clients).where(eq(clients.id, o.client));
  if (!c) throw new Error("no such client");
  const key = await store.bind({ ref: o.keyRef, client: o.client, name: v.keyName, by: o.by });
  await upsertMode(main, o.client, v.id, { mode: "own", keyName: key.ref, by: o.by });
  return { keyName: key.ref, last4: key.last4 };
}

/** A login vendor on the client's own account: its key is the account it signs in with. */
export async function setOwnLogin(
  main: Db,
  o: { client: string; vendor: string; by: string },
): Promise<void> {
  const v = vendorOf(o.vendor);
  if (v.own !== "login") throw new Error(`${v.name} takes a key, not a login`);
  await upsertMode(main, o.client, v.id, { mode: "own", keyName: null, by: o.by });
}

/** Back to no mode: parts that need it wait with "Needs setup". The key stays in the store. */
export async function clearMode(main: Db, client: string, vendor: string): Promise<void> {
  await main
    .delete(vendorModes)
    .where(and(eq(vendorModes.client, client), eq(vendorModes.vendor, vendor)));
}

// ---- buckets and the gate ----

export const ownBucket = (vendor: string, client: string) => `${vendor}:own:${client}`;
export const managedBucket = (vendor: string) => `${vendor}:managed`;

const DAY = 86_400_000;

/** Each unit's time over the last day, oldest first, as `bucketRoom` counts them. */
async function spends(main: Queryable, where: SQL | undefined, now: Date): Promise<number[]> {
  const rows = await main
    .select({ at: vendorUsage.at, units: vendorUsage.units })
    .from(vendorUsage)
    .where(and(where, gte(vendorUsage.at, new Date(now.getTime() - DAY))))
    .orderBy(asc(vendorUsage.at));
  return rows.flatMap((r) => Array<number>(Math.max(0, r.units)).fill(r.at.getTime()));
}

const scale = (b: Bucket, perDay: number): Bucket => ({
  perDay,
  burst: Math.max(1, Math.min(perDay, Math.round((b.burst * perDay) / b.perDay))),
});

/** The start of `now`'s month, UTC: caps and usage lines count from here. */
export const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Micro-dollars a client spent on a vendor's managed key this month. */
export async function monthSpend(
  main: Queryable,
  client: string,
  vendor: string,
  now: Date,
): Promise<number> {
  const [r] = await main
    .select({ micros: sql<string>`coalesce(sum(${vendorUsage.micros}), 0)` })
    .from(vendorUsage)
    .where(
      and(
        eq(vendorUsage.client, client),
        eq(vendorUsage.vendor, vendor),
        eq(vendorUsage.mode, "managed"),
        gte(vendorUsage.at, monthStart(now)),
      ),
    );
  return Number(r?.micros ?? 0);
}

export type Gate =
  | { ok: true; mode: VendorMode; bucket: string; room: number | null }
  | { ok: false; why: string; mode: VendorMode | null };

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
const noRoom = (nextInMs: number) =>
  `No reads left today, next in ${minutes(nextInMs)} minute${minutes(nextInMs) === 1 ? "" : "s"}`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Room in a bucket for `units` now; null when there is no quota. */
function roomOf(spent: number[], now: Date, b: Bucket | null) {
  return b ? bucketRoom(spent, now.getTime(), b) : null;
}

/**
 * May `client` (null: Wren) spend `units` of `vendor` now? Yes with its mode and bucket, or why
 * not: "Needs setup", a cap, a share of 0, or no reads left with when the next one comes. A free
 * vendor has no money to cap: its daily share and the quota bound it.
 */
export function gate(
  main: Queryable,
  client: string | null,
  vendor: string,
  units: number,
  now: Date = new Date(),
): Promise<Gate> {
  return admit(main, client, vendor, units, now, true);
}

/**
 * Today's room alone: the gate for one unit without the monthly cap, as the Vendors page says
 * "Today". The cap is money, said on its own line.
 */
export function roomToday(
  main: Queryable,
  client: string | null,
  vendor: string,
  now: Date = new Date(),
): Promise<Gate> {
  return admit(main, client, vendor, 1, now, false);
}

/** A vendor that costs nothing: a $ cap means nothing on it. No public price isn't free. */
export const isFree = (v: Vendor) => v.micros === 0;

async function admit(
  main: Queryable,
  client: string | null,
  vendor: string,
  units: number,
  now: Date,
  cap: boolean,
): Promise<Gate> {
  const v = vendorOf(vendor);
  const managed = managedBucket(v.id);
  // Wren is client zero: managed, no cap, its room the whole quota less what anyone spent.
  if (client === null) {
    const r = roomOf(await spends(main, eq(vendorUsage.bucket, managed), now), now, v.quota);
    if (r && r.room < units) return { ok: false, why: noRoom(r.nextInMs), mode: "managed" };
    return { ok: true, mode: "managed", bucket: managed, room: r?.room ?? null };
  }
  // Free, no quota and nothing of the client's to hold (LinkedIn reads by search): nothing to set up.
  if (!v.own && !v.quota && isFree(v))
    return { ok: true, mode: "managed", bucket: managed, room: null };
  const m = await modeOf(main, client, v.id);
  if (!m) return { ok: false, why: "Needs setup", mode: null };
  if (m.mode === "own") {
    if (v.own === "key" && !m.keyName) return { ok: false, why: "Needs setup", mode: "own" };
    const bucket = ownBucket(v.id, client);
    const r = roomOf(await spends(main, eq(vendorUsage.bucket, bucket), now), now, v.quota);
    if (r && r.room < units) return { ok: false, why: noRoom(r.nextInMs), mode: "own" };
    return { ok: true, mode: "own", bucket, room: r?.room ?? null };
  }

  const s = await vendorSettings(main);
  if (v.managedDev || !s.managedForClients.includes(v.id))
    return { ok: false, why: `${v.name} isn't offered managed`, mode: "managed" };
  if (cap && !isFree(v)) {
    const cost = units * (v.micros ?? 0);
    const spent = await monthSpend(main, client, v.id, now);
    if (m.capCents === 0) return { ok: false, why: "No monthly cap set", mode: "managed" };
    if (spent + cost > m.capCents * 10_000)
      return { ok: false, why: `Monthly cap of ${dollars(m.capCents)} reached`, mode: "managed" };
  }
  if (!v.quota) return { ok: true, mode: "managed", bucket: managed, room: null };
  if (m.perDay === 0) return { ok: false, why: "No daily share set", mode: "managed" };

  // The smallest of three: its share, the clients' pool under Wren's reserve, the whole quota.
  const all = await spends(main, eq(vendorUsage.bucket, managed), now);
  const clientsSpent = await spends(
    main,
    and(eq(vendorUsage.bucket, managed), sql`${vendorUsage.client} is not null`),
    now,
  );
  const mine = await spends(
    main,
    and(eq(vendorUsage.bucket, managed), eq(vendorUsage.client, client)),
    now,
  );
  const pool = Math.floor((v.quota.perDay * (100 - s.reservePct)) / 100);
  if (pool === 0) return { ok: false, why: "Wren keeps all of this quota", mode: "managed" };
  const rooms = [
    bucketRoom(mine, now.getTime(), scale(v.quota, Math.min(m.perDay, pool))),
    bucketRoom(clientsSpent, now.getTime(), scale(v.quota, pool)),
    bucketRoom(all, now.getTime(), v.quota),
  ];
  const room = Math.min(...rooms.map((r) => r.room));
  if (room < units)
    return {
      ok: false,
      why: noRoom(Math.max(...rooms.filter((r) => r.room < units).map((r) => r.nextInMs))),
      mode: "managed",
    };
  return { ok: true, mode: "managed", bucket: managed, room };
}

/**
 * Record a metered call: its mode and bucket as `gate` decides them, units, and est.
 * micro-dollars from the public price (or `micros` when the caller knows better, as the model
 * gateway does).
 */
export async function meter(
  main: Db,
  o: {
    client: string | null;
    vendor: string;
    units: number;
    micros?: number;
    part?: string | null;
    runId?: string | null;
    at?: Date;
  },
): Promise<{ mode: VendorMode; bucket: string; micros: number }> {
  const v = vendorOf(o.vendor);
  if (!Number.isInteger(o.units) || o.units < 0) throw new Error("units: a whole number");
  return atomic(main, async (tx) => {
    const m = o.client === null ? null : await modeOf(tx, o.client, v.id);
    const mode: VendorMode = o.client === null ? "managed" : (m?.mode ?? "managed");
    const bucket =
      mode === "own" && o.client !== null ? ownBucket(v.id, o.client) : managedBucket(v.id);
    const micros = o.micros ?? o.units * (v.micros ?? 0);
    await tx.insert(vendorUsage).values({
      client: o.client,
      vendor: v.id,
      mode,
      bucket,
      units: o.units,
      micros,
      part: o.part ?? null,
      runId: o.runId ?? null,
      ...(o.at ? { at: o.at } : {}),
    });
    return { mode, bucket, micros };
  });
}

export interface UsageSum {
  vendor: string;
  mode: VendorMode;
  units: number;
  micros: number;
}

/** An owner's usage per vendor and mode since `from`: the Vendors page and Billing. */
export async function usageSince(
  main: Queryable,
  client: string | null,
  from: Date,
): Promise<UsageSum[]> {
  const rows = await main
    .select({
      vendor: vendorUsage.vendor,
      mode: vendorUsage.mode,
      units: sql<string>`sum(${vendorUsage.units})`,
      micros: sql<string>`sum(${vendorUsage.micros})`,
    })
    .from(vendorUsage)
    .where(
      and(
        client === null ? isNull(vendorUsage.client) : eq(vendorUsage.client, client),
        gte(vendorUsage.at, from),
      ),
    )
    .groupBy(vendorUsage.vendor, vendorUsage.mode)
    .orderBy(asc(vendorUsage.vendor));
  return rows.map((r) => ({ ...r, units: Number(r.units), micros: Number(r.micros) }));
}
