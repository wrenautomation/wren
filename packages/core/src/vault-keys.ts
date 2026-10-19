/**
 * API keys as accounts (designs/2026-10-19-api-keys-as-accounts.md, wren part). Two kinds of key
 * sit on the Accounts page: the operator's, kept in autobrowse's vault and mirrored here into
 * `vault_keys`, and each client's own, kept sealed in `client_secrets`. This module holds:
 *
 * - `syncVaultKeys`: autobrowse's `sites/keys` into `vault_keys` (no secret ever; a row that
 *   carries one is dropped and logged);
 * - `VaultKeys/box`: the hourly sync, and the three actions (rotate, revoke, mark spent);
 * - `keyAccounts`: both kinds as one list, for the Accounts record and the CLI.
 *
 * The shapes copied from autobrowse (`src/sites/keys.ts`) are by hand: wren imports nothing from it.
 */
import * as restate from "@restatedev/restate-sdk";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DESK, SITES, type SitesHost } from "./content/restate.js";
import { clientSecretEvents, clientSecrets, type VaultKeyState, vaultKeys } from "./keys-schema.js";
import type { Notifier } from "./notify.js";
import { exclusiveHandler } from "./restate/form.js";
import { LIMITS, makeLoopObject, type PassOutcome, runPass, within } from "./restate/index.js";
import { vendorModes, vendorUsage } from "./vendor-schema.js";
import { DEFAULT_PURPOSE, monthStart, usageByKey, VENDORS, type Vendor } from "./vendors.js";

export const VAULT_KEYS_KEY = "box";
export const VAULT_KEYS_COMMAND = "vault keys sync";
const HOUR_MS = 3_600_000;

// ---- autobrowse's shapes (copied by hand) ----

/** A key as `sites/keys` answers: the vault's `KeyInfo` plus the audit's use count. No secret. */
export interface KeyRow {
  /** `site@account`. */
  address: string;
  /** The key id: 12 hex of the SHA-256 of the value. */
  id: string;
  site: string;
  account: string;
  owner: string;
  via?: string;
  vendorId?: string;
  purposes: string[];
  status: "live" | "spent" | "revoked";
  spentUntil?: string;
  madeAt: string;
  revokedAt?: string;
  uses: number;
  lastUsedAt: string | null;
}
export interface KeysRequest {
  vendor?: string;
  all?: boolean;
}
export interface KeysAnswer {
  keys: KeyRow[];
}
export interface KeyRevokeAnswer {
  key: KeyRow;
  /** The env names the re-projection put and removed; never values. */
  projected: { put: string[]; removed: string[] };
}
export interface KeyRotateAnswer {
  /** `<workflow>/<key>`: `autobrowse status <workflow> <key>` shows it. */
  run: string;
  workflow: string;
}

/** What `syncVaultKeys` reads: `sites/keys`, or a fake. */
export interface KeysSource {
  keys(req: KeysRequest): Promise<{ keys: unknown[] }>;
}

// ---- the mirror ----

const iso = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "not a date");
/** Loose on purpose: a field autobrowse adds later arrives and is ignored. */
const keyRowSchema = z.looseObject({
  address: z.string().min(1).max(160),
  id: z.string().regex(/^[0-9a-f]{12}$/),
  site: z.string().min(1).max(64),
  account: z.string().min(1).max(64),
  owner: z.string().min(1).max(80),
  via: z.string().max(160).optional(),
  vendorId: z.string().max(160).optional(),
  purposes: z.array(z.string().max(64)).default([]),
  status: z.enum(["live", "spent", "revoked"]),
  spentUntil: iso.optional(),
  madeAt: iso,
  revokedAt: iso.optional(),
  uses: z.number().int().min(0).default(0),
  lastUsedAt: iso.nullable().default(null),
});

export interface SyncStats {
  /** Rows now in the mirror. */
  keys: number;
  /** Addresses dropped from the mirror because the vault no longer lists them. */
  removed: number;
  /** Rows refused: one with a `secret`, or one that didn't fit the shape. */
  refused: number;
}

const date = (s: string | null | undefined) => (s ? new Date(s) : null);

/**
 * Mirror the vault's key list: upsert every row, delete the addresses no longer listed, stamp
 * `read_at`. A row that carries a `secret` field is dropped and logged by address (never the
 * value): the source has none, so one that does is a bug on the other side.
 */
export async function syncVaultKeys(
  db: Db,
  sites: KeysSource,
  o: { now?: Date; warn?: (line: string) => void } = {},
): Promise<SyncStats> {
  const now = o.now ?? new Date();
  const warn = o.warn ?? ((line: string) => console.warn(line));
  const answer = await sites.keys({ all: true });
  const rows: z.infer<typeof keyRowSchema>[] = [];
  let refused = 0;
  for (const raw of answer.keys) {
    const at = (raw as { address?: unknown } | null)?.address;
    const where = typeof at === "string" ? at.slice(0, 80) : "a row without an address";
    if (raw !== null && typeof raw === "object" && "secret" in raw) {
      refused++;
      warn(`vault_keys: dropped ${where}: the row carried a secret field`);
      continue;
    }
    const parsed = keyRowSchema.safeParse(raw);
    if (!parsed.success) {
      refused++;
      warn(`vault_keys: dropped ${where}: ${parsed.error.issues[0]?.message ?? "bad row"}`);
      continue;
    }
    rows.push(parsed.data);
  }
  // A repeated address in one answer: the last one stands (one upsert may not touch a row twice).
  const byAddress = new Map(rows.map((r) => [r.address, r]));
  const listed = [...byAddress.keys()];
  const removed = await atomic(db, async (tx) => {
    for (const r of byAddress.values()) {
      const values = {
        site: r.site,
        account: r.account,
        owner: r.owner,
        keyId: r.id,
        purposes: r.purposes,
        status: r.status as VaultKeyState,
        spentUntil: date(r.spentUntil),
        madeAt: new Date(r.madeAt),
        revokedAt: date(r.revokedAt),
        via: r.via ?? null,
        vendorId: r.vendorId ?? null,
        uses: r.uses,
        lastUsedAt: date(r.lastUsedAt),
        readAt: now,
      };
      await tx
        .insert(vaultKeys)
        .values({ address: r.address, ...values })
        .onConflictDoUpdate({ target: vaultKeys.address, set: values });
    }
    // A refused row is not in `listed`, so its old mirror row goes too: a row we can't read is not shown.
    const gone = await tx
      .delete(vaultKeys)
      .where(listed.length ? notInArray(vaultKeys.address, listed) : sql`true`)
      .returning({ address: vaultKeys.address });
    return gone.length;
  });
  return { keys: listed.length, removed, refused };
}

// ---- the service ----

type SitesKeys = {
  keys: (ctx: restate.Context, req: KeysRequest) => Promise<KeysAnswer>;
  keySpend: (ctx: restate.Context, req: { address: string; until?: string }) => Promise<KeyRow>;
  keyRevoke: (ctx: restate.Context, req: { address: string }) => Promise<KeyRevokeAnswer>;
  keyRotate: (ctx: restate.Context, req: { address: string }) => Promise<KeyRotateAnswer>;
};

export interface VaultKeysDeps {
  db: Db;
  /** Where `sites/keys`, `keyRevoke` and `keySpend` run (`sitesHost`); the box by default. */
  host?: SitesHost;
  /** Where `keyRotate` runs: the Mac, whose browser the Console needs. */
  desk?: SitesHost;
  notifier?: Notifier;
  /** How long a call to autobrowse may take (default `LIMITS.quick`); tests shorten it. */
  limitMs?: number;
}

const ADDRESS = z.string().min(1).max(160).describe("The key's address: site@account");

const spendInput = z.looseObject({
  address: ADDRESS,
  until: z.string().min(1).optional().describe("Spent until this date; the 1st of next month"),
});
const addressInput = z.looseObject({ address: ADDRESS });

/**
 * `VaultKeys/box`: mirrors the operator's keys hourly, and carries the three actions on them.
 * A key that isn't in the mirror is refused before autobrowse hears of it.
 */
export function makeVaultKeys(deps: VaultKeysDeps) {
  const limit = deps.limitMs ?? LIMITS.quick;
  const sites = (ctx: restate.Context, host: SitesHost = deps.host ?? { service: SITES }) =>
    ctx.serviceClient<SitesKeys>(host.service);
  const wake = async (ctx: restate.Context, host: SitesHost = deps.host ?? { service: SITES }) => {
    if (host.wake) await ctx.run("wake autobrowse", host.wake);
  };
  /** The vault's whole key list now, mirrored; throws what autobrowse refused. */
  const resync = async (ctx: restate.Context, host?: SitesHost): Promise<SyncStats> => {
    const h = host ?? deps.host ?? { service: SITES };
    const answer = await within(ctx, sites(ctx, h).keys({ all: true }), {
      ms: limit,
      call: `${h.service.name}/keys`,
    });
    return ctx.run("mirror vault keys", () =>
      syncVaultKeys(deps.db, { keys: async () => answer }, { now: new Date() }),
    );
  };
  const known = async (ctx: restate.Context, address: string) => {
    const there = await ctx.run("known key", async () => {
      const [r] = await deps.db
        .select({ address: vaultKeys.address })
        .from(vaultKeys)
        .where(eq(vaultKeys.address, address));
      return !!r;
    });
    if (!there) throw new restate.TerminalError(`No operator key ${address}`, { errorCode: 404 });
  };

  return makeLoopObject(
    "VaultKeys",
    async (ctx: restate.ObjectContext) => {
      const now = new Date(await ctx.date.now());
      const host = deps.host ?? { service: SITES };
      await wake(ctx, host);
      let answer: KeysAnswer | null = null;
      let refused: string | null = null;
      try {
        answer = await within(ctx, sites(ctx, host).keys({ all: true }), {
          ms: limit,
          call: `${host.service.name}/keys`,
        });
      } catch (err) {
        // An old box without `keys`, or no answer in time: this pass's problem, asked again in an hour.
        if (!(err instanceof restate.TerminalError)) throw err;
        refused = err.message;
      }
      const got = answer;
      return runPass<SyncStats>(ctx, deps.db, now, {
        name: "sync",
        ledger: { command: VAULT_KEYS_COMMAND, argv: { daemon: true } },
        body: async () => {
          if (!got) throw new Error(`sites keys refused: ${refused}`);
          return syncVaultKeys(deps.db, { keys: async () => got }, { now });
        },
        delayAfter: () => HOUR_MS,
        retryMs: HOUR_MS,
        ...(deps.notifier ? { notifier: deps.notifier } : {}),
      }) as Promise<PassOutcome<SyncStats>>;
    },
    {
      extra: {
        /** Start the vendor's mint flow for this key on the Mac; the run's own gate asks William. */
        rotate: exclusiveHandler(
          { input: addressInput },
          async (
            ctx: restate.ObjectContext,
            req: { address: string },
          ): Promise<KeyRotateAnswer> => {
            await known(ctx, req.address);
            const desk = deps.desk ?? { service: DESK };
            return within(ctx, sites(ctx, desk).keyRotate({ address: req.address }), {
              ms: limit,
              call: `${desk.service.name}/keyRotate`,
              keep: true,
            });
          },
        ),
        /** Out of use for good, in the vault; the vendor's own copy is revoked by hand. */
        revoke: exclusiveHandler(
          { input: addressInput },
          async (
            ctx: restate.ObjectContext,
            req: { address: string },
          ): Promise<{
            address: string;
            status: string;
            projected: KeyRevokeAnswer["projected"];
          }> => {
            await known(ctx, req.address);
            await wake(ctx);
            const done = await within(ctx, sites(ctx).keyRevoke({ address: req.address }), {
              ms: limit,
              call: "sites/keyRevoke",
              keep: true,
            });
            await resync(ctx);
            return { address: req.address, status: done.key.status, projected: done.projected };
          },
        ),
        /** Out of credit until a date (the 1st of next month when none). */
        spend: exclusiveHandler(
          { input: spendInput },
          async (
            ctx: restate.ObjectContext,
            req: { address: string; until?: string },
          ): Promise<{ address: string; status: string; spentUntil: string | null }> => {
            await known(ctx, req.address);
            await wake(ctx);
            const done = await within(
              ctx,
              sites(ctx).keySpend({
                address: req.address,
                ...(req.until ? { until: req.until } : {}),
              }),
              { ms: limit, call: "sites/keySpend", keep: true },
            );
            await resync(ctx);
            return {
              address: req.address,
              status: done.status,
              spentUntil: done.spentUntil ?? null,
            };
          },
        ),
      },
    },
  );
}

export type VaultKeys = ReturnType<typeof makeVaultKeys>;

// ---- both kinds as one list ----

/** The key states a row shows. */
export type KeyState = "live" | "spent" | "revoked";

/** One API key as an account: the operator's (vault) or a client's own (client). */
export interface KeyAccount {
  /** The row id: the address for the vault's, the `ks_` ref for a client's. */
  id: string;
  origin: "vault" | "client";
  /** `site@account`: the vendor, then the label. */
  address: string;
  vendor: string;
  /** `wren`, the autobrowse owner, or the client id. */
  owner: string;
  purposes: string[];
  state: KeyState;
  /** A spent key's date it is good again. */
  until: Date | null;
  keyId: string | null;
  /** This month's estimated spend in micro-dollars; null where no usage is tied to the key. */
  spendMicros: number | null;
  lastUsedAt: Date | null;
}

/** The vendor a client key's name belongs to: `EXA_API_KEY` is `exa`. Null for a name that isn't a vendor's key. */
export function vendorOfKeyName(name: string): Vendor | null {
  return VENDORS.find((v) => v.keyName === name) ?? null;
}

/**
 * Every API key: the operator's from the mirror, and each client's live own keys. A client's key
 * shows when its name is a vendor's key name (not a mailbox or a social token). `client` limits it
 * to one client's keys and none of the operator's. A spent key whose date has passed reads live.
 */
export async function keyAccounts(
  db: Queryable,
  o: { now?: Date; vendor?: string; client?: string } = {},
): Promise<KeyAccount[]> {
  const now = o.now ?? new Date();
  const since = monthStart(now);
  const [spend, vault, secrets, modes, reads, bucketSpend] = await Promise.all([
    usageByKey(db, { since }),
    o.client ? Promise.resolve([]) : db.select().from(vaultKeys),
    db
      .select()
      .from(clientSecrets)
      .where(
        and(
          eq(clientSecrets.state, "live"),
          o.client ? eq(clientSecrets.client, o.client) : sql`true`,
        ),
      ),
    db
      .select({
        client: vendorModes.client,
        vendor: vendorModes.vendor,
        purpose: vendorModes.purpose,
        keyName: vendorModes.keyName,
      })
      .from(vendorModes)
      .where(eq(vendorModes.mode, "own")),
    db
      .select({
        secret: clientSecretEvents.secret,
        at: sql<Date>`max(${clientSecretEvents.at})`.mapWith((v) => new Date(v as string)),
        reads: sql<string>`count(*)`,
      })
      .from(clientSecretEvents)
      .where(eq(clientSecretEvents.op, "read"))
      .groupBy(clientSecretEvents.secret),
    // The own-key bucket: for a key with no id of its own, where it is the client's only one.
    db
      .select({
        client: vendorUsage.client,
        vendor: vendorUsage.vendor,
        micros: sql<string>`sum(${vendorUsage.micros})`,
      })
      .from(vendorUsage)
      .where(and(eq(vendorUsage.mode, "own"), gte(vendorUsage.at, since)))
      .groupBy(vendorUsage.client, vendorUsage.vendor),
  ]);

  const out: KeyAccount[] = [];
  for (const k of vault) {
    if (o.vendor && k.site !== o.vendor) continue;
    const back = k.status === "spent" && k.spentUntil !== null && k.spentUntil <= now;
    out.push({
      id: k.address,
      origin: "vault",
      address: k.address,
      vendor: k.site,
      owner: k.owner,
      purposes: k.purposes,
      state: back ? "live" : k.status,
      until: k.status === "spent" && !back ? k.spentUntil : null,
      keyId: k.keyId,
      spendMicros: spend.get(k.keyId)?.micros ?? 0,
      lastUsedAt: k.lastUsedAt,
    });
  }

  const lastRead = new Map(reads.map((r) => [r.secret, r.at]));
  const liveOf = new Map<string, number>();
  const vendored = secrets.flatMap((s) => {
    const v = vendorOfKeyName(s.name);
    return v ? [{ s, v }] : [];
  });
  for (const { s, v } of vendored)
    liveOf.set(`${s.client}|${v.id}`, (liveOf.get(`${s.client}|${v.id}`) ?? 0) + 1);
  const bucket = new Map(bucketSpend.map((b) => [`${b.client}|${b.vendor}`, Number(b.micros)]));
  for (const { s, v } of vendored) {
    if (o.vendor && v.id !== o.vendor) continue;
    const only = liveOf.get(`${s.client}|${v.id}`) === 1;
    out.push({
      id: s.id,
      origin: "client",
      address: `${v.id}@${s.label}`,
      vendor: v.id,
      owner: s.client,
      purposes: modes
        .filter((m) => m.client === s.client && m.vendor === v.id && m.keyName === s.id)
        .map((m) => m.purpose)
        .sort((a, b) =>
          a === DEFAULT_PURPOSE ? -1 : b === DEFAULT_PURPOSE ? 1 : a.localeCompare(b),
        ),
      state: "live",
      until: null,
      keyId: s.keyId,
      spendMicros: s.keyId
        ? (spend.get(s.keyId)?.micros ?? 0)
        : only
          ? (bucket.get(`${s.client}|${v.id}`) ?? 0)
          : null,
      lastUsedAt: lastRead.get(s.id) ?? null,
    });
  }
  return out.sort((a, b) => a.address.localeCompare(b.address) || a.owner.localeCompare(b.owner));
}

/** Micro-dollars as dollars. */
export const dollars = (micros: number) => micros / 1_000_000;
