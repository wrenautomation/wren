/**
 * Client social access (designs/2026-10-07-client-social.md): a client's own accounts, connected
 * one sign-in each on Wren's apps. Refresh and Page tokens live in the key store, sealed under the
 * client; access tokens live in memory for their life. Nothing here returns or logs a token.
 */
import { createHash } from "node:crypto";
import type { FetchLike } from "@wren/core";
import { WREN } from "@wren/core/access";
import type { KeyStore } from "@wren/core/keys";
import { addAccount } from "@wren/core/setup";
import { clientAccounts } from "@wren/core/setup-schema";
import type { Db, Queryable } from "@wren/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  connectUrl,
  type Landed,
  landCode,
  pkceVerifier,
  randomState,
  refreshToken,
  type SocialAppKeys,
  SocialAuthError,
  type StoredToken,
  whoAmI,
} from "./oauth.js";
import {
  APP_NAMES,
  appKey,
  SOCIAL,
  SOCIAL_APPS,
  SOCIAL_PLATFORMS,
  type SocialApp,
  type SocialPlatform,
} from "./platforms.js";
import { type SocialConnectionRow, socialConnections, socialGrants } from "./schema.js";

export type SocialApps = Partial<Record<SocialApp, SocialAppKeys>>;

export interface SocialDeps {
  main: Db;
  /** Wren's apps, from the key store; a missing one is "Needs setup". */
  apps: () => Promise<SocialApps>;
  /** Where tokens go; null: connecting says the key store isn't set up here. */
  keys: KeyStore | null;
  /** The portal's origin the callbacks land on. */
  origin: string | null;
  fetch: FetchLike;
  /** Platforms whose review passed (`liveFrom`). */
  live: ReadonlySet<SocialPlatform>;
  now?: () => Date;
}

/** The fact a connection's setup makes true. */
export const SOCIAL_FACT = "social.connected";
/** Who reads and writes social tokens in the key store's log. */
export const SOCIAL_KEYS = "wren:social";
/** A sign-in's link lives half an hour. */
const CONNECT_MS = 30 * 60_000;
/** LinkedIn's 60 days: warn this long before. */
export const EXPIRY_WARN_MS = 7 * 86_400_000;

export const callbackUrl = (origin: string, platform: SocialPlatform) =>
  `${origin.replace(/\/+$/, "")}/oauth/social/${platform}`;

/** The login a connection is in `clientContent`'s logins: `social:<id>`. */
export const loginOf = (id: number) => `social:${id}`;
export const connectionIdOf = (login: string | null | undefined): number | null => {
  const m = /^social:(\d+)$/.exec(login ?? "");
  return m ? Number(m[1]) : null;
};

/** A refusal said to a person: the page shows it as is. */
export class SocialRefusal extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "SocialRefusal";
  }
}

/** The key store's name for an account's token, under its client: its id hashed. */
export function tokenName(platform: SocialPlatform, externalId: string) {
  const h = createHash("sha256").update(externalId).digest("hex").slice(0, 16);
  return `SOCIAL_${platform.toUpperCase()}_${h.toUpperCase()}`;
}

export type SocialStateName = "not_connected" | "waiting_review" | "connected" | "broken";

export interface ConnectionView {
  id: number;
  name: string | null;
  handle: string | null;
  state: "connected" | "broken";
  why: string | null;
  connectedAt: string;
  checkedAt: string | null;
  expiresAt: string | null;
  /** Its sign-in lapses within a week (LinkedIn's 60 days). */
  expiring: boolean;
}

export interface PlatformView {
  platform: SocialPlatform;
  label: string;
  state: SocialStateName;
  /** What stops it, said plainly; null when nothing does. */
  blocking: string | null;
  /** What works before review; null when review passed or there's none. */
  today: string | null;
  selfServe: string;
  forYou: string;
  dms: boolean;
  comments: boolean;
  connections: ConnectionView[];
  may: { connect: boolean };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Each platform's state for a client, from its connections, Wren's apps and the review list. */
export function platformStates(
  conns: readonly SocialConnectionRow[],
  o: { apps: SocialApps; live: ReadonlySet<SocialPlatform>; ready: boolean; now: Date },
): PlatformView[] {
  return SOCIAL_PLATFORMS.map((platform): PlatformView => {
    const s = SOCIAL[platform];
    const mine = conns.filter((c) => c.platform === platform);
    const live = o.live.has(platform);
    const hasApp = !!o.apps[s.app];
    const connections = mine.map(
      (c): ConnectionView => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        state: c.state,
        why: c.why,
        connectedAt: c.connectedAt.toISOString(),
        checkedAt: iso(c.checkedAt),
        expiresAt: iso(c.expiresAt),
        expiring: !!c.expiresAt && c.expiresAt.getTime() - o.now.getTime() < EXPIRY_WARN_MS,
      }),
    );
    const state: SocialStateName = mine.some((c) => c.state === "connected")
      ? "connected"
      : mine.length
        ? "broken"
        : live
          ? "not_connected"
          : "waiting_review";
    const blocking = !hasApp
      ? `Needs setup: Wren's ${APP_NAMES[s.app]} app`
      : !o.ready
        ? "In development: connecting isn't set up here yet"
        : state === "broken"
          ? (mine[0]?.why ?? "Its sign-in stopped working")
          : !live && state === "waiting_review"
            ? s.review
            : null;
    return {
      platform,
      label: s.label,
      state,
      blocking,
      today: live ? null : s.before,
      selfServe: s.selfServe,
      forYou: s.forYou,
      dms: s.dms,
      comments: s.comments,
      connections,
      may: { connect: hasApp && o.ready && (live || s.before !== null) },
    };
  });
}

/** The plumbing: grants, the callback, tokens, checks. */
export function socialAccess(deps: SocialDeps) {
  const { main } = deps;
  const now = () => deps.now?.() ?? new Date();
  const cache = new Map<number, { token: string; until: number }>();

  const appFor = async (platform: SocialPlatform): Promise<SocialAppKeys> => {
    const app = (await deps.apps())[SOCIAL[platform].app];
    if (!app)
      throw new SocialRefusal(
        `Needs setup: Wren's ${APP_NAMES[SOCIAL[platform].app]} app. Wren's team is on it.`,
      );
    return app;
  };
  const connection = async (id: number) => {
    const [c] = await main.select().from(socialConnections).where(eq(socialConnections.id, id));
    return c ?? null;
  };
  const connectionsOf = (client: string) =>
    main
      .select()
      .from(socialConnections)
      .where(eq(socialConnections.client, client))
      .orderBy(socialConnections.id);

  /** A connection broken: its channel stops, the page says why, the recheck loses its fact. */
  const broke = async (id: number, why: string) => {
    cache.delete(id);
    await main
      .update(socialConnections)
      .set({ state: "broken", why: why.slice(0, 300), checkedAt: now() })
      .where(eq(socialConnections.id, id));
  };

  const stored = async (c: SocialConnectionRow): Promise<StoredToken> => {
    if (!deps.keys) throw new SocialRefusal("The key store isn't set up here");
    const v = await deps.keys.get({
      ref: c.tokenRef,
      client: c.client,
      by: SOCIAL_KEYS,
      why: `${c.platform} account ${c.id}`,
    });
    if (!v) {
      await broke(c.id, "Its token is gone. Connect it again.");
      throw new SocialRefusal("Its token is gone. Connect it again.");
    }
    return JSON.parse(v) as StoredToken;
  };

  /** A live access token: from memory, else from what's kept (X's and TikTok's rotate). */
  const tokenOf = async (c: SocialConnectionRow): Promise<string> => {
    if (c.state === "broken") throw new SocialRefusal(c.why ?? "Its sign-in stopped working");
    const hit = cache.get(c.id);
    const at = now().getTime();
    if (hit && hit.until > at + 60_000) return hit.token;
    const kept = await stored(c);
    let t: Awaited<ReturnType<typeof refreshToken>>;
    try {
      t = await refreshToken(deps.fetch, c.platform, await appFor(c.platform), kept, now());
    } catch (err) {
      if (err instanceof SocialAuthError && err.revoked) {
        const why =
          err.code === "expired"
            ? "Its sign-in ran out. Connect it again."
            : "Access was taken back. Connect it again.";
        await broke(c.id, why);
        throw new SocialRefusal(why);
      }
      throw err;
    }
    if (t.stored && deps.keys)
      await deps.keys.rotate({
        ref: c.tokenRef,
        client: c.client,
        value: JSON.stringify(t.stored),
        by: SOCIAL_KEYS,
      });
    cache.set(c.id, { token: t.access, until: at + t.expiresIn * 1000 });
    return t.access;
  };

  const grantFor = async (state: string, platform: SocialPlatform) => {
    const at = now();
    const [g] = await main
      .update(socialGrants)
      .set({ usedAt: at })
      .where(
        and(
          eq(socialGrants.state, state.slice(0, 64)),
          eq(socialGrants.platform, platform),
          isNull(socialGrants.usedAt),
          gt(socialGrants.expiresAt, at),
        ),
      )
      .returning();
    return g ?? null;
  };

  /** Keep what landed: its account, its token in the key store, its connection. */
  const keep = async (client: string, platform: SocialPlatform, l: Landed, by: string) => {
    if (!deps.keys) throw new SocialRefusal("The key store isn't set up here");
    const account = await addAccount(main, {
      client,
      site: "social",
      ref: `${platform}:${l.externalId}`.slice(0, 200),
      role: platform,
      by,
    });
    const { ref } = await deps.keys.put({
      client,
      name: tokenName(platform, l.externalId),
      value: JSON.stringify(l.stored),
      by,
    });
    const at = now();
    const row = {
      accountId: account.id,
      name: l.name,
      handle: l.handle,
      scopes: l.scopes.join(" ").slice(0, 2000),
      tokenRef: ref,
      expiresAt: l.expiresAt,
      extra: l.extra,
      state: "connected" as const,
      why: null,
      connectedAt: at,
      checkedAt: at,
      by,
    };
    const [c] = await main
      .insert(socialConnections)
      .values({ client, platform, externalId: l.externalId, ...row })
      .onConflictDoUpdate({
        target: [
          socialConnections.client,
          socialConnections.platform,
          socialConnections.externalId,
        ],
        set: row,
      })
      .returning();
    if (!c) throw new Error("social: the connection didn't save");
    cache.set(c.id, { token: l.access, until: at.getTime() + l.accessFor * 1000 });
    return c;
  };

  return {
    connection,
    connectionsOf,
    tokenOf,
    broke,

    /** Where to sign in to connect one account; the link is good for half an hour, once. */
    async connect(o: { client: string; platform: SocialPlatform; by: string }): Promise<string> {
      if (o.client === WREN) throw new SocialRefusal("Wren's own accounts aren't connected here");
      if (!deps.keys) throw new SocialRefusal("In development: Wren's key store isn't set up yet");
      if (!deps.origin) throw new SocialRefusal("In development: the portal's address isn't set");
      const s = SOCIAL[o.platform];
      if (!deps.live.has(o.platform) && s.before === null)
        throw new SocialRefusal(`Waiting on review: ${s.review}`);
      const app = await appFor(o.platform);
      await sweepSocialGrants(main, now());
      const state = randomState();
      const verifier = s.pkce ? pkceVerifier() : null;
      await main.insert(socialGrants).values({
        state,
        client: o.client,
        platform: o.platform,
        verifier,
        by: o.by,
        expiresAt: new Date(now().getTime() + CONNECT_MS),
      });
      return connectUrl(o.platform, app, {
        redirect: callbackUrl(deps.origin, o.platform),
        state,
        verifier,
      });
    },

    /**
     * The platform sent the person back. The state is used once and must be fresh. The code
     * becomes a token in the key store. Answers what the page says and the account to check.
     */
    async land(q: {
      platform: SocialPlatform;
      state: string;
      code?: string | null | undefined;
      error?: string | null | undefined;
    }): Promise<{ ok: boolean; said: string; client: string | null; check: number[] }> {
      const g = await grantFor(String(q.state ?? ""), q.platform);
      const label = SOCIAL[q.platform].label;
      if (!g)
        return {
          ok: false,
          said: "This link expired or was used. Start again from Account → Social.",
          client: null,
          check: [],
        };
      const client = g.client;
      if (q.error)
        return {
          ok: false,
          said: /denied|cancel/i.test(q.error)
            ? "Nothing was granted. You can try again from Account → Social."
            : `${label} said no (${String(q.error).slice(0, 60)}).`,
          client,
          check: [],
        };
      if (!q.code || !deps.origin)
        return { ok: false, said: "Nothing came back to connect with.", client, check: [] };
      let landed: Landed;
      try {
        landed = await landCode(deps.fetch, q.platform, await appFor(q.platform), {
          code: q.code,
          redirect: callbackUrl(deps.origin, q.platform),
          verifier: g.verifier,
          now: now(),
        });
      } catch (err) {
        const said =
          err instanceof SocialAuthError && !err.code.startsWith("http_") && !err.revoked
            ? err.message.replace(/^[a-z_0-9]+: /, "")
            : "The sign-in didn't finish. Try again.";
        return {
          ok: false,
          said: err instanceof SocialRefusal ? err.message : said,
          client,
          check: [],
        };
      }
      const c = await keep(client, q.platform, landed, g.by);
      const who = landed.handle ? `@${landed.handle}` : (landed.name ?? "The account");
      return {
        ok: true,
        said: `${who} is connected on ${label}.`,
        client,
        check: [c.accountId],
      };
    },

    /** One who-am-I read on a fresh token: proves the connection works. Breaks it when refused. */
    async check(c: SocialConnectionRow): Promise<{ ok: boolean; why: string }> {
      if (c.state === "broken") return { ok: false, why: c.why ?? "Its sign-in stopped working" };
      try {
        const token = await tokenOf(c);
        const who = await whoAmI(deps.fetch, c.platform, token, c.extra);
        await main
          .update(socialConnections)
          .set({ checkedAt: now(), name: who.name ?? c.name, handle: who.handle ?? c.handle })
          .where(eq(socialConnections.id, c.id));
      } catch (err) {
        if (err instanceof SocialAuthError && err.revoked)
          await broke(c.id, "Access was taken back. Connect it again.");
        return {
          ok: false,
          why: err instanceof Error ? err.message.slice(0, 200) : "Its sign-in stopped working",
        };
      }
      const left = c.expiresAt ? c.expiresAt.getTime() - now().getTime() : null;
      return {
        ok: true,
        why:
          left !== null && left < EXPIRY_WARN_MS
            ? `Works. Connect again within ${Math.max(1, Math.ceil(left / 86_400_000))} days.`
            : "Works",
      };
    },

    /** Off: its token deleted, its account gone with it. */
    async disconnect(o: { client: string; id: number; by: string }): Promise<boolean> {
      const c = await connection(o.id);
      if (!c || c.client !== o.client) throw new SocialRefusal("no such account", 404);
      if (deps.keys)
        await deps.keys.delete({ ref: c.tokenRef, client: c.client, by: o.by }).catch(() => false);
      cache.delete(c.id);
      await main.delete(clientAccounts).where(eq(clientAccounts.id, c.accountId));
      return true;
    },

    /** The page: every platform with its state, its accounts and the next step. */
    async view(client: string) {
      const [conns, apps] = await Promise.all([connectionsOf(client), deps.apps()]);
      return {
        platforms: platformStates(conns, {
          apps,
          live: deps.live,
          ready: !!deps.keys && !!deps.origin,
          now: now(),
        }),
        apps: Object.fromEntries(SOCIAL_APPS.map((a) => [a, !!apps[a]])) as Record<
          SocialApp,
          boolean
        >,
      };
    },
  };
}
export type SocialAccessApi = ReturnType<typeof socialAccess>;

/** A client's live connections, for its content channels and its DM reader. */
export async function liveConnections(
  main: Queryable,
  client: string,
): Promise<SocialConnectionRow[]> {
  return main
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.client, client), eq(socialConnections.state, "connected")))
    .orderBy(socialConnections.id);
}

/** Expired or used grants older than a day. */
export async function sweepSocialGrants(main: Queryable, at: Date): Promise<void> {
  await main
    .delete(socialGrants)
    .where(
      sql`${socialGrants.expiresAt} < ${new Date(at.getTime() - 86_400_000).toISOString()}::timestamptz`,
    );
}

/**
 * Wren's apps from the key store under Wren's own client (`wren keys put --client wren
 * SOCIAL_X_CLIENT_ID`). All found: kept an hour; one missing: asked again in 10 minutes.
 */
export function socialAppsFrom(keys: KeyStore | null): () => Promise<SocialApps> {
  let memo: { at: number; ttl: number; apps: SocialApps } | null = null;
  const named = (name: string) =>
    keys
      ? keys
          .named({ client: WREN, name, by: SOCIAL_KEYS, why: "Wren's social app" })
          .catch(() => null)
      : Promise.resolve(null);
  return async () => {
    if (memo && Date.now() - memo.at < memo.ttl) return memo.apps;
    const apps: SocialApps = {};
    for (const a of SOCIAL_APPS) {
      const [id, secret] = await Promise.all([named(appKey(a, "ID")), named(appKey(a, "SECRET"))]);
      if (id && secret) apps[a] = { id, secret };
    }
    const all = SOCIAL_APPS.every((a) => apps[a]);
    memo = { at: Date.now(), ttl: all ? 3_600_000 : 600_000, apps };
    return apps;
  };
}
