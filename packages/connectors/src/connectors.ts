/**
 * A client's connected apps (designs/2026-10-09-connectors.md): the page's view, the sign-in and
 * its landing, a live token, and disconnect. Tokens sit in the key store under the client; Wren's
 * developer apps under Wren, or in the worker's env.
 */
import { createHash } from "node:crypto";
import type { FetchLike } from "@wren/core";
import { WREN } from "@wren/core/access";
import type { KeyStore } from "@wren/core/keys";
import { OAuthError, randomState } from "@wren/core/oauth";
import type { Db, Queryable } from "@wren/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { APPS, appKeyName, CONNECTOR_APPS, type ConnectorApp } from "./apps.js";
import { type AppKeys, connectUrl, exchange, refresh } from "./oauth.js";
import { whoHubspot } from "./pull/hubspot.js";
import { whoJobber } from "./pull/jobber.js";
import { whoQuickbooks } from "./pull/quickbooks.js";
import type { WhoAmI } from "./pull/types.js";
import { type ConnectorLink, connectorGrants, connectorLinks, type LinkExtra } from "./schema.js";

export type ConnectorApps = Partial<Record<ConnectorApp, AppKeys>>;

export interface ConnectorDeps {
  main: Db;
  /** Wren's developer apps; a missing one is "Needs setup". */
  apps: () => Promise<ConnectorApps>;
  /** Where tokens go; null: connecting says the key store isn't set up here. */
  keys: KeyStore | null;
  /** The portal's origin the sign-in lands on. */
  origin: string | null;
  fetch: FetchLike;
  now?: () => Date;
}

/** Who reads and writes connector tokens in the key store's log. */
export const CONNECTOR_KEYS = "wren:connectors";
/** A sign-in's link lives half an hour. */
const CONNECT_MS = 30 * 60_000;

export const WHO: Record<ConnectorApp, WhoAmI> = {
  hubspot: whoHubspot,
  quickbooks: whoQuickbooks,
  jobber: whoJobber,
};

export const connectorCallback = (origin: string, app: ConnectorApp) =>
  `${origin.replace(/\/+$/, "")}/oauth/connector/${app}`;

/** The key store's name for a link's token, under its client: the account's id hashed. */
export function connectorTokenName(app: ConnectorApp, externalId: string) {
  const h = createHash("sha256").update(externalId).digest("hex").slice(0, 16);
  return `CONNECTOR_${app.toUpperCase()}_${h.toUpperCase()}`;
}

/** What the key store keeps for a link. */
interface StoredToken {
  access: string;
  refresh: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** A refusal said to a person: the page shows it as is. */
export class ConnectorRefusal extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "ConnectorRefusal";
  }
}

export type ConnectorState = "needs_setup" | "not_connected" | "connected" | "broken";

export interface LinkView {
  id: number;
  name: string | null;
  externalId: string;
  state: "connected" | "broken";
  why: string | null;
  people: number;
  fired: number;
  syncedAt: string | null;
  connectedAt: string;
  by: string;
}

export interface AppView {
  app: ConnectorApp;
  label: string;
  reads: string;
  fires: string;
  state: ConnectorState;
  links: LinkView[];
}

const linkView = (l: ConnectorLink): LinkView => ({
  id: l.id,
  name: l.name,
  externalId: l.externalId,
  state: l.state,
  why: l.why,
  people: l.people,
  fired: l.fired,
  syncedAt: l.syncedAt?.toISOString() ?? null,
  connectedAt: l.connectedAt.toISOString(),
  by: l.by,
});

/** What landed: said to the person, and the link to sync first when it worked. */
export interface Landing {
  ok: boolean;
  said: string;
  link: number | null;
}

export interface LandQuery {
  app: ConnectorApp;
  state: string;
  code?: string | null | undefined;
  error?: string | null | undefined;
  /** QuickBooks' company. */
  realmId?: string | null | undefined;
}

export function connectorAccess(deps: ConnectorDeps) {
  const { main } = deps;
  const now = () => deps.now?.() ?? new Date();
  const cache = new Map<number, { token: string; until: number }>();

  const keysOf = async (app: ConnectorApp): Promise<AppKeys> => {
    const k = (await deps.apps())[app];
    if (!k)
      throw new ConnectorRefusal(
        `Needs setup: Wren's ${APPS[app].label} app. Wren's team is on it.`,
      );
    return k;
  };
  const store = () => {
    if (!deps.keys) throw new ConnectorRefusal("The key store isn't set up here");
    return deps.keys;
  };
  const link = async (id: number) => {
    const [l] = await main.select().from(connectorLinks).where(eq(connectorLinks.id, id));
    return l ?? null;
  };

  /** Broken: the page says why, the sync stops until it's connected again. */
  const broke = async (id: number, why: string) => {
    cache.delete(id);
    await main
      .update(connectorLinks)
      .set({ state: "broken", why: why.slice(0, 300) })
      .where(eq(connectorLinks.id, id));
  };

  /**
   * A live access token: from memory, else a refresh. QuickBooks and Jobber hand back a new
   * refresh token each time; it's kept before anything else runs, so a crash after can't lose it.
   */
  const tokenOf = async (l: ConnectorLink): Promise<string> => {
    if (l.state === "broken") throw new ConnectorRefusal(l.why ?? "Its sign-in stopped working");
    const at = now().getTime();
    const hit = cache.get(l.id);
    if (hit && hit.until > at + 120_000) return hit.token;
    const keys = store();
    const v = await keys.get({
      ref: l.tokenRef,
      client: l.client,
      by: CONNECTOR_KEYS,
      why: `${l.app} link ${l.id}`,
    });
    if (!v) {
      await broke(l.id, "Its token is gone. Connect it again.");
      throw new ConnectorRefusal("Its token is gone. Connect it again.");
    }
    const kept = JSON.parse(v) as StoredToken;
    if (kept.expiresAt > at + 120_000) {
      cache.set(l.id, { token: kept.access, until: kept.expiresAt });
      return kept.access;
    }
    let t: Awaited<ReturnType<typeof refresh>>;
    try {
      t = await refresh(deps.fetch, l.app, await keysOf(l.app), kept.refresh);
    } catch (err) {
      if (err instanceof OAuthError && err.revoked) {
        await broke(l.id, "Access was taken back or ran out. Connect it again.");
        throw new ConnectorRefusal("Access was taken back or ran out. Connect it again.");
      }
      throw err;
    }
    const next: StoredToken = {
      access: t.access,
      refresh: t.refresh,
      expiresAt: at + t.expiresIn * 1000,
    };
    await keys.rotate({
      ref: l.tokenRef,
      client: l.client,
      value: JSON.stringify(next),
      by: CONNECTOR_KEYS,
    });
    cache.set(l.id, { token: next.access, until: next.expiresAt });
    return next.access;
  };

  const spend = async (state: string, app: ConnectorApp) => {
    const at = now();
    const [g] = await main
      .update(connectorGrants)
      .set({ usedAt: at })
      .where(
        and(
          eq(connectorGrants.state, state.slice(0, 64)),
          eq(connectorGrants.app, app),
          isNull(connectorGrants.usedAt),
          gt(connectorGrants.expiresAt, at),
        ),
      )
      .returning();
    return g ?? null;
  };

  return {
    link,
    broke,
    tokenOf,

    /** Every app with its state and its connected accounts. */
    async view(client: string): Promise<{ apps: AppView[]; ready: boolean }> {
      const [links, apps] = await Promise.all([
        main
          .select()
          .from(connectorLinks)
          .where(eq(connectorLinks.client, client))
          .orderBy(connectorLinks.id),
        deps.apps(),
      ]);
      const ready = !!deps.keys && !!deps.origin;
      return {
        ready,
        apps: CONNECTOR_APPS.map((app) => {
          const mine = links.filter((l) => l.app === app);
          const state: ConnectorState = mine.some((l) => l.state === "connected")
            ? "connected"
            : mine.length
              ? "broken"
              : !apps[app] || !ready
                ? "needs_setup"
                : "not_connected";
          const s = APPS[app];
          return {
            app,
            label: s.label,
            reads: s.reads,
            fires: s.fires,
            state,
            links: mine.map(linkView),
          };
        }),
      };
    },

    /** Where the person signs in to connect `app` for `client`. */
    async connect(o: { client: string; app: ConnectorApp; by: string }): Promise<string> {
      if (o.client === WREN) throw new ConnectorRefusal("Connect apps for a client");
      const keys = await keysOf(o.app);
      store();
      if (!deps.origin) throw new ConnectorRefusal("The portal's address isn't set here");
      const state = randomState();
      await main.insert(connectorGrants).values({
        state,
        client: o.client,
        app: o.app,
        by: o.by.toLowerCase(),
        expiresAt: new Date(now().getTime() + CONNECT_MS),
      });
      return connectUrl(o.app, keys, { redirect: connectorCallback(deps.origin, o.app), state });
    },

    /** Where the app sends the person back: the state spent once, the token kept, the link made. */
    async land(q: LandQuery): Promise<Landing> {
      const label = APPS[q.app].label;
      const g = await spend(q.state, q.app);
      if (!g)
        return {
          ok: false,
          said: "This link expired or was used. Start again from Account → Connectors.",
          link: null,
        };
      if (q.error)
        return {
          ok: false,
          said: /denied|cancel/i.test(q.error)
            ? "Nothing was granted. You can try again from Account → Connectors."
            : `${label} said no (${String(q.error).slice(0, 60)}).`,
          link: null,
        };
      if (!q.code || !deps.origin)
        return { ok: false, said: "Nothing came back to connect with.", link: null };
      if (q.app === "quickbooks" && !q.realmId)
        return { ok: false, said: "QuickBooks named no company. Try again.", link: null };
      const extra: LinkExtra = q.realmId ? { realm: q.realmId.slice(0, 64) } : {};
      try {
        const keys = store();
        const t = await exchange(deps.fetch, q.app, await keysOf(q.app), {
          code: q.code,
          redirect: connectorCallback(deps.origin, q.app),
        });
        const who = await WHO[q.app](deps.fetch, t.access, extra);
        const stored: StoredToken = {
          access: t.access,
          refresh: t.refresh,
          expiresAt: now().getTime() + t.expiresIn * 1000,
        };
        const { ref } = await keys.put({
          client: g.client,
          name: connectorTokenName(q.app, who.id),
          value: JSON.stringify(stored),
          by: g.by,
        });
        const scopes = APPS[q.app].scopes.join(" ");
        const [row] = await main
          .insert(connectorLinks)
          .values({
            client: g.client,
            app: q.app,
            externalId: who.id.slice(0, 128),
            name: who.name,
            scopes,
            tokenRef: ref,
            extra,
            by: g.by,
          })
          .onConflictDoUpdate({
            target: [connectorLinks.client, connectorLinks.app, connectorLinks.externalId],
            set: {
              name: who.name,
              scopes,
              tokenRef: ref,
              extra,
              state: "connected",
              why: null,
              by: g.by,
            },
          })
          .returning();
        if (!row) throw new Error("the link was not kept");
        cache.delete(row.id);
        return {
          ok: true,
          said: `${who.name ?? label} is connected. Its people come in within the hour.`,
          link: row.id,
        };
      } catch (err) {
        if (err instanceof ConnectorRefusal) return { ok: false, said: err.message, link: null };
        const said =
          err instanceof OAuthError && !err.code.startsWith("http_")
            ? `${label} said ${err.code}. Try again.`
            : "The sign-in didn't finish. Try again.";
        return { ok: false, said, link: null };
      }
    },

    /** Off: its token deleted, the link gone. What it brought in stays in the CRM. */
    async disconnect(o: { client: string; id: number; by: string }): Promise<boolean> {
      const l = await link(o.id);
      if (!l || l.client !== o.client) throw new ConnectorRefusal("no such connection", 404);
      await deps.keys?.delete({ ref: l.tokenRef, client: l.client, by: o.by }).catch(() => false);
      cache.delete(l.id);
      await main.delete(connectorLinks).where(eq(connectorLinks.id, l.id));
      return true;
    },
  };
}
export type ConnectorAccess = ReturnType<typeof connectorAccess>;

/** Expired or used sign-ins older than a day. */
export async function sweepConnectorGrants(main: Queryable, at: Date): Promise<void> {
  await main
    .delete(connectorGrants)
    .where(lt(connectorGrants.expiresAt, new Date(at.getTime() - 86_400_000)));
}

/**
 * Wren's developer apps: the worker's env first (`WREN_CONNECTOR_HUBSPOT_ID`), else the key store
 * under Wren (`CONNECTOR_HUBSPOT_ID`). All found: kept an hour; one missing: asked again in 10
 * minutes.
 */
export function connectorAppsFrom(
  keys: KeyStore | null,
  env: Record<string, string | undefined> = {},
): () => Promise<ConnectorApps> {
  let memo: { at: number; ttl: number; apps: ConnectorApps } | null = null;
  const named = async (name: string) =>
    env[`WREN_${name}`]?.trim() ||
    (keys
      ? await keys
          .named({ client: WREN, name, by: CONNECTOR_KEYS, why: "Wren's connector app" })
          .catch(() => null)
      : null);
  return async () => {
    if (memo && Date.now() - memo.at < memo.ttl) return memo.apps;
    const apps: ConnectorApps = {};
    for (const a of CONNECTOR_APPS) {
      const [id, secret] = await Promise.all([
        named(appKeyName(a, "ID")),
        named(appKeyName(a, "SECRET")),
      ]);
      if (id && secret) apps[a] = { id, secret };
    }
    const all = CONNECTOR_APPS.every((a) => apps[a]);
    memo = { at: Date.now(), ttl: all ? 3_600_000 : 600_000, apps };
    return apps;
  };
}
