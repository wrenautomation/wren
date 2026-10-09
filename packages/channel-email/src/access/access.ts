/**
 * Mail access (designs/2026-10-07-mail-access.md): a client's mailboxes, connected one sign-in
 * each, after its Workspace admin trusts Wren's app or its Microsoft 365 admin consents. Refresh
 * tokens live in the key store (designs/2026-10-07-key-store.md), sealed under the client;
 * access tokens live in memory for their hour. Nothing here returns or logs a token.
 */
import { createHash } from "node:crypto";
import { WREN } from "@wren/core/access";
import type { KeyStore } from "@wren/core/keys";
import type { Mailbox, MailSender } from "@wren/core/mailbox";
import { type AccountView, accountsOf, addAccount } from "@wren/core/setup";
import { type AccountRow, clientAccounts } from "@wren/core/setup-schema";
import type { Db, Queryable } from "@wren/db";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import {
  gmailMailbox,
  gmailReads,
  gmailReply,
  graphMailbox,
  graphReads,
  graphReply,
  MailApiError,
} from "./mailbox.js";
import {
  accessOf,
  CONSUMER_GOOGLE,
  CONSUMER_MICROSOFT,
  connectUrl,
  consentUrl,
  exchange,
  type MailApp,
  type MailApps,
  OAuthError,
  pkceVerifier,
  randomState,
  refresh,
} from "./oauth.js";
import {
  type ConnectionRow,
  type GrantRow,
  MAIL_ACCESS,
  type MailAccess,
  type MailProvider,
  mailConnections,
  mailConsents,
  mailGrants,
} from "./schema.js";

export interface MailDeps {
  main: Db;
  /** Wren's mail apps, from config or the key store; a missing one is "Needs setup". */
  apps: () => Promise<MailApps>;
  /** Where refresh tokens go; null: connecting says the key store isn't set up here. */
  keys: KeyStore | null;
  /** The portal's origin the callbacks land on (`https://app.wrenautomation.com`). */
  origin: string | null;
  fetch: FetchLike;
  now?: () => Date;
}

/** The facts each setup makes true (`./setups.ts`). */
export const FACTS = {
  googleApp: "mail.google_app",
  microsoftApp: "mail.microsoft_app",
  googleTrust: "google.mail_trust",
  microsoftConsent: "microsoft.admin_consent",
  mailbox: "mailbox.connected",
} as const;

/** A connect's link lives half an hour; an admin's consent link a week (it's forwarded). */
const CONNECT_MS = 30 * 60_000;
const CONSENT_MS = 7 * 86_400_000;
const ADDRESS = /^[^\s@]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}$/;

export const callbackUrl = (origin: string, provider: MailProvider) =>
  `${origin.replace(/\/+$/, "")}/oauth/mail/${provider}`;

/** A refusal said to a person: the page shows it as is. */
export class MailRefusal extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "MailRefusal";
  }
}

export const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

/** Who reads and writes mailbox tokens in the key store's log. */
export const MAIL_KEYS = "wren:mail";

/** The key store's name for a mailbox's refresh token, under its client: the address hashed. */
export function tokenName(provider: MailProvider, address: string) {
  const h = createHash("sha256").update(address.toLowerCase()).digest("hex").slice(0, 16);
  return `MAIL_${provider.toUpperCase()}_${h.toUpperCase()}`;
}

/** The org account's site for a provider. */
export const orgSite = (p: MailProvider) => (p === "google" ? "google_workspace" : "microsoft_365");

/** What a mailbox wants, from its account's role. */
export const wantOf = (a: Pick<AccountRow, "role">): MailAccess =>
  (MAIL_ACCESS as readonly string[]).includes(a.role) ? (a.role as MailAccess) : "send";

export type MailboxState = "not_set_up" | "waiting_admin" | "send_only" | "read_send" | "broken";

export interface MailboxView {
  id: number;
  address: string;
  provider: MailProvider;
  /** Personal Gmail: no admin, no reading. */
  personal: boolean;
  want: MailAccess;
  state: MailboxState;
  /** What stops it, said plainly; null when nothing does. */
  blocking: string | null;
  /** Who acts next and what they do; null when it's done. */
  next: string | null;
  /** The buttons it offers. */
  may: { connectSend: boolean; connectRead: boolean };
  org: number | null;
  connectedAt: string | null;
  checkedAt: string | null;
}

export interface OrgView {
  id: number;
  site: "google_workspace" | "microsoft_365";
  provider: MailProvider;
  domain: string;
  /** The admin's step is done: Wren's app trusted, or consent given. */
  ready: boolean;
  /** Its fact's last word: "A read works on ann@acme.test". */
  why: string | null;
  checkedAt: string | null;
  /** Microsoft: the tenant consent landed in. */
  tenant: string | null;
  /** Mailboxes on this domain that want to read. */
  readers: number;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Each mailbox's state from its account, its connection and its org's admin fact. A client sees
 * only its own: the caller passes the client's id.
 */
export function mailboxStates(
  accounts: readonly AccountView[],
  conns: readonly ConnectionRow[],
  apps: { google: boolean; microsoft: boolean },
): { mailboxes: MailboxView[]; orgs: OrgView[] } {
  const orgs: OrgView[] = accounts
    .filter((a) => a.site === "google_workspace" || a.site === "microsoft_365")
    .map((a) => {
      const provider: MailProvider = a.site === "google_workspace" ? "google" : "microsoft";
      const fact = a.facts.find(
        (f) => f.fact === (provider === "google" ? FACTS.googleTrust : FACTS.microsoftConsent),
      );
      const seen = (fact?.seen ?? null) as { tenant?: string } | null;
      return {
        id: a.id,
        site: a.site as OrgView["site"],
        provider,
        domain: a.ref,
        ready: fact?.state === "ok",
        why: fact?.why ?? null,
        checkedAt: iso(fact?.checkedAt),
        tenant: seen?.tenant ?? null,
        readers: accounts.filter(
          (m) => m.site === "mailbox" && domainOf(m.ref) === a.ref && wantOf(m) === "read",
        ).length,
      };
    });
  const mailboxes = accounts
    .filter((a) => a.site === "mailbox")
    .map((a): MailboxView => {
      const domain = domainOf(a.ref);
      const personal = CONSUMER_GOOGLE.has(domain);
      const org = orgs.find((o) => o.domain === domain) ?? null;
      const provider: MailProvider = personal ? "google" : (org?.provider ?? "google");
      const c = conns.find((x) => x.accountId === a.id) ?? null;
      const want = wantOf(a);
      const hasApp = apps[provider];
      const appName = provider === "google" ? "Wren's Google app" : "Wren's Microsoft app";
      const admin = provider === "google" ? "trust Wren's app" : "consent for Wren's app";
      const base = {
        id: a.id,
        address: a.ref,
        provider,
        personal,
        want,
        org: org?.id ?? null,
        connectedAt: iso(c?.connectedAt),
        checkedAt: iso(c?.checkedAt),
      };
      // Google lets a mailbox connect to read before trust (the test read); Microsoft refuses
      // a user's consent until the admin's.
      const readable = !personal && (provider === "google" || !!org?.ready);
      const may = { connectSend: hasApp, connectRead: hasApp && want === "read" && readable };
      if (!hasApp)
        return {
          ...base,
          state: c?.state === "broken" ? "broken" : "not_set_up",
          blocking: `Needs setup: ${appName}`,
          next: "Wren's team sets up its app. Nothing for you to do yet.",
          may,
        };
      if (c?.state === "broken")
        return {
          ...base,
          state: "broken",
          blocking: c.why ?? "Its sign-in stopped working",
          next: "Connect it again.",
          may: { connectSend: true, connectRead: may.connectRead },
        };
      if (c?.access === "read")
        return { ...base, state: "read_send", blocking: null, next: null, may };
      if (c?.access === "send") {
        if (want === "send")
          return { ...base, state: "send_only", blocking: null, next: null, may };
        const blocking = personal
          ? "Needs Workspace trust: personal Gmail can't let Wren read without a yearly Google security review. Sending works."
          : org?.ready
            ? null
            : provider === "google"
              ? "Needs Workspace trust: your Google admin hasn't trusted Wren's app yet."
              : "Needs admin consent: your Microsoft 365 admin hasn't consented yet.";
        return {
          ...base,
          state: "send_only",
          blocking,
          next: personal
            ? "Use a Workspace address for reading."
            : org?.ready
              ? "Connect again to add reading."
              : `Your admin follows the steps above to ${admin}.`,
          may,
        };
      }
      if (want === "read" && !personal && !org?.ready)
        return {
          ...base,
          state: "waiting_admin",
          blocking:
            provider === "google"
              ? "Your Google admin hasn't trusted Wren's app yet."
              : "Your Microsoft 365 admin hasn't consented yet.",
          next:
            provider === "google"
              ? "Your admin trusts Wren's app, then connect this mailbox to read. You can connect it to send now."
              : "Your admin consents, then connect this mailbox. You can connect it to send now.",
          may,
        };
      return {
        ...base,
        state: "not_set_up",
        blocking:
          want === "read" && personal
            ? "Personal Gmail can't let Wren read without a yearly Google security review."
            : null,
        next: "Connect it: sign in once as this mailbox.",
        may,
      };
    });
  return { mailboxes, orgs };
}

/** The plumbing: grants, the callback, tokens, the checks' reads. */
export function mailAccess(deps: MailDeps) {
  const { main } = deps;
  const now = () => deps.now?.() ?? new Date();
  const cache = new Map<number, { token: string; until: number }>();

  const appFor = async (p: MailProvider): Promise<MailApp> => {
    const app = (await deps.apps())[p];
    if (!app)
      throw new MailRefusal(
        `Needs setup: Wren's ${p === "google" ? "Google" : "Microsoft"} app. Wren's team is on it.`,
      );
    return app;
  };
  const account = async (id: number) => {
    const [a] = await main.select().from(clientAccounts).where(eq(clientAccounts.id, id));
    return a ?? null;
  };
  const connectionOf = async (accountId: number) => {
    const [c] = await main
      .select()
      .from(mailConnections)
      .where(eq(mailConnections.accountId, accountId));
    return c ?? null;
  };
  const orgOf = async (client: string, address: string) => {
    const [o] = await main
      .select()
      .from(clientAccounts)
      .where(
        and(
          eq(clientAccounts.client, client),
          inArray(clientAccounts.site, ["google_workspace", "microsoft_365"]),
          eq(clientAccounts.ref, domainOf(address)),
        ),
      );
    return o ?? null;
  };
  const providerOf = async (a: AccountRow): Promise<MailProvider> => {
    if (CONSUMER_GOOGLE.has(domainOf(a.ref))) return "google";
    const org = a.client ? await orgOf(a.client, a.ref) : null;
    if (!org) throw new MailRefusal("No Workspace or Microsoft 365 account for this domain");
    return org.site === "google_workspace" ? "google" : "microsoft";
  };
  const grant = async (g: Omit<GrantRow, "createdAt" | "usedAt">) => {
    await main.insert(mailGrants).values(g);
    return g.state;
  };

  /** A connection broken: the reader stops on it, the page says why, the recheck loses its fact. */
  const broke = async (accountId: number, why: string) => {
    cache.delete(accountId);
    await main
      .update(mailConnections)
      .set({ state: "broken", why: why.slice(0, 300), checkedAt: now() })
      .where(eq(mailConnections.accountId, accountId));
  };

  /** A live access token for a connection: from memory, else a refresh (Microsoft's rotates). */
  const tokenOf = async (c: ConnectionRow): Promise<string> => {
    const hit = cache.get(c.accountId);
    const at = now().getTime();
    if (hit && hit.until > at + 60_000) return hit.token;
    if (!deps.keys) throw new MailRefusal("The key store isn't set up here");
    const client = (await account(c.accountId))?.client;
    if (!client) throw new MailRefusal("This mailbox has no client");
    const stored = await deps.keys.get({
      ref: c.tokenName,
      client,
      by: MAIL_KEYS,
      why: `refresh mailbox ${c.accountId}`,
    });
    if (!stored) {
      await broke(c.accountId, "Its token is gone. Connect it again.");
      throw new MailRefusal("Its token is gone. Connect it again.");
    }
    const saved = JSON.parse(stored) as { refresh: string };
    const app = await appFor(c.provider);
    let t: Awaited<ReturnType<typeof refresh>>;
    try {
      t = await refresh(deps.fetch, c.provider, app, {
        refresh: saved.refresh,
        tenant: c.provider === "microsoft" ? c.org : null,
      });
    } catch (err) {
      if (err instanceof OAuthError && err.revoked) {
        await broke(c.accountId, "Access was taken back. Connect it again.");
        throw new MailRefusal("Access was taken back. Connect it again.");
      }
      throw err;
    }
    // Microsoft's rotates: the new one under the same ref.
    if (t.refresh && t.refresh !== saved.refresh)
      await deps.keys.rotate({
        ref: c.tokenName,
        client,
        value: JSON.stringify({ ...saved, refresh: t.refresh }),
        by: MAIL_KEYS,
      });
    cache.set(c.accountId, { token: t.access, until: at + t.expiresIn * 1000 });
    return t.access;
  };

  /** A provider call refused for the token or its scopes: the connection breaks. */
  const guarded = async <T>(
    c: ConnectionRow,
    fn: () => Promise<T>,
    why = "Reading was refused. Connect it again.",
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MailApiError && (err.status === 401 || err.status === 403))
        await broke(c.accountId, why);
      throw err;
    }
  };

  /** One read on a connection: proves it reads. */
  const reads = (c: ConnectionRow) =>
    guarded(c, () =>
      c.provider === "google"
        ? gmailReads(deps.fetch, () => tokenOf(c))
        : graphReads(deps.fetch, () => tokenOf(c)),
    );

  return {
    connectionOf,
    tokenOf,
    reads,

    /**
     * A mailbox to connect: its account, and its org's (a Workspace or Microsoft 365 domain) when
     * it isn't personal Gmail. `want` read adds the admin's setup to the org.
     */
    async addMailbox(o: {
      client: string;
      address: string;
      provider: MailProvider;
      want: MailAccess;
      by: string;
    }): Promise<{ mailbox: AccountRow; org: AccountRow | null }> {
      const address = o.address.trim().toLowerCase();
      if (!ADDRESS.test(address)) throw new MailRefusal("That isn't an email address", 400);
      const domain = domainOf(address);
      if (CONSUMER_MICROSOFT.has(domain))
        throw new MailRefusal("Personal Outlook addresses aren't supported yet. Use a work one.");
      const personal = CONSUMER_GOOGLE.has(domain);
      if (personal && o.provider !== "google")
        throw new MailRefusal("A Gmail address is Google's", 400);
      const existing = await orgOf(o.client, address);
      if (existing && existing.site !== orgSite(o.provider))
        throw new MailRefusal(
          `${domain} is set up as ${existing.site === "google_workspace" ? "Google Workspace" : "Microsoft 365"}`,
        );
      const org = personal
        ? null
        : (existing ??
          (await addAccount(main, {
            client: o.client,
            site: orgSite(o.provider),
            ref: domain,
            by: o.by,
          })));
      const mailbox = await addAccount(main, {
        client: o.client,
        site: "mailbox",
        ref: address,
        role: o.want,
        by: o.by,
      });
      if (mailbox.role !== o.want)
        await main
          .update(clientAccounts)
          .set({ role: o.want })
          .where(eq(clientAccounts.id, mailbox.id));
      return { mailbox: { ...mailbox, role: o.want }, org };
    },

    /** Where to sign in as the mailbox; the link is good for half an hour, once. */
    async connect(o: { accountId: number; want: MailAccess; by: string }): Promise<string> {
      const a = await account(o.accountId);
      if (!a || a.site !== "mailbox" || !a.client) throw new MailRefusal("no such mailbox", 404);
      if (!deps.keys) throw new MailRefusal("In development: Wren's key store isn't set up yet");
      if (!deps.origin) throw new MailRefusal("In development: the portal's address isn't set");
      const provider = await providerOf(a);
      if (o.want === "read" && CONSUMER_GOOGLE.has(domainOf(a.ref)))
        throw new MailRefusal(
          "Personal Gmail can't let Wren read without a yearly Google security review. Connect it to send.",
        );
      const app = await appFor(provider);
      const org = await orgOf(a.client, a.ref);
      const [consent] = org
        ? await main.select().from(mailConsents).where(eq(mailConsents.accountId, org.id))
        : [];
      const state = randomState();
      const verifier = pkceVerifier();
      await grant({
        state,
        kind: "connect",
        provider,
        accountId: a.id,
        want: o.want,
        verifier,
        by: o.by,
        expiresAt: new Date(now().getTime() + CONNECT_MS),
      });
      return connectUrl(provider, app, {
        redirect: callbackUrl(deps.origin, provider),
        state,
        verifier,
        want: o.want,
        address: a.ref,
        tenant: provider === "microsoft" ? (consent?.tenant ?? org?.ref ?? null) : null,
      });
    },

    /** The Microsoft 365 admin's consent link for the org: good for a week, once. */
    async consent(o: { accountId: number; by: string }): Promise<string> {
      const org = await account(o.accountId);
      if (!org || org.site !== "microsoft_365") throw new MailRefusal("no such org", 404);
      if (!deps.origin) throw new MailRefusal("In development: the portal's address isn't set");
      const app = await appFor("microsoft");
      const state = randomState();
      await grant({
        state,
        kind: "consent",
        provider: "microsoft",
        accountId: org.id,
        want: "read",
        verifier: null,
        by: o.by,
        expiresAt: new Date(now().getTime() + CONSENT_MS),
      });
      return consentUrl(app, {
        tenant: org.ref,
        redirect: callbackUrl(deps.origin, "microsoft"),
        state,
      });
    },

    /**
     * Google or Microsoft sent the person back. The state is used once and must be fresh. A
     * connect's code becomes a refresh token in the key store; a consent is kept for its tenant.
     * Answers what the page says and the account whose setup should check now.
     */
    async land(q: {
      provider: MailProvider;
      state: string;
      code?: string | null | undefined;
      error?: string | null | undefined;
      admin_consent?: string | null | undefined;
      tenant?: string | null | undefined;
      scope?: string | null | undefined;
    }): Promise<{
      ok: boolean;
      said: string;
      client: string | null;
      /** Accounts whose setups should check now. */
      check: number[];
    }> {
      const at = now();
      const [g] = await main
        .update(mailGrants)
        .set({ usedAt: at })
        .where(
          and(
            eq(mailGrants.state, String(q.state ?? "").slice(0, 64)),
            eq(mailGrants.provider, q.provider),
            isNull(mailGrants.usedAt),
            gt(mailGrants.expiresAt, at),
          ),
        )
        .returning();
      if (!g)
        return {
          ok: false,
          said: "This link expired or was used. Start again from Account → Mail.",
          client: null,
          check: [],
        };
      const a = await account(g.accountId);
      if (!a?.client) return { ok: false, said: "That account is gone.", client: null, check: [] };
      const client = a.client;
      if (q.error)
        return {
          ok: false,
          said:
            q.error === "access_denied" || q.error === "consent_required"
              ? "Nothing was granted. You can try again from Account → Mail."
              : `Google or Microsoft said no (${String(q.error).slice(0, 60)}).`,
          client,
          check: [],
        };

      if (g.kind === "consent") {
        const ok = String(q.admin_consent ?? "").toLowerCase() === "true";
        const tenant = String(q.tenant ?? "").trim();
        if (!ok || !/^[0-9a-f-]{36}$/i.test(tenant))
          return { ok: false, said: "Consent didn't come through.", client, check: [] };
        await main
          .insert(mailConsents)
          .values({ accountId: a.id, tenant, scopes: String(q.scope ?? ""), by: g.by })
          .onConflictDoUpdate({
            target: mailConsents.accountId,
            set: { tenant, scopes: String(q.scope ?? ""), by: g.by, consentedAt: at },
          });
        return {
          ok: true,
          said: `Consent recorded for ${a.ref}. Each mailbox can connect now.`,
          client,
          check: [a.id],
        };
      }

      if (!q.code || !g.verifier || !deps.origin || !deps.keys)
        return { ok: false, said: "Nothing came back to connect with.", client, check: [] };
      const app = await appFor(g.provider);
      const org = await orgOf(client, a.ref);
      const [consent] = org
        ? await main.select().from(mailConsents).where(eq(mailConsents.accountId, org.id))
        : [];
      let t: Awaited<ReturnType<typeof exchange>>;
      try {
        t = await exchange(deps.fetch, g.provider, app, {
          code: q.code,
          redirect: callbackUrl(deps.origin, g.provider),
          verifier: g.verifier,
          tenant: g.provider === "microsoft" ? (consent?.tenant ?? org?.ref ?? null) : null,
        });
      } catch (err) {
        const code = err instanceof OAuthError ? err.code : "error";
        return {
          ok: false,
          said: `The sign-in didn't finish (${code}). Try again.`,
          client,
          check: [],
        };
      }
      if (t.address !== a.ref.toLowerCase())
        return {
          ok: false,
          said: `You signed in as ${t.address ?? "someone else"}, not ${a.ref}. Try again as ${a.ref}.`,
          client,
          check: [],
        };
      const access = accessOf(g.provider, t.scopes);
      if (!access || !t.refresh)
        return {
          ok: false,
          said: "Sending wasn't allowed, so nothing was connected. Tick every box and try again.",
          client,
          check: [],
        };
      const { ref } = await deps.keys.put({
        client,
        name: tokenName(g.provider, a.ref),
        value: JSON.stringify({ refresh: t.refresh, address: a.ref }),
        by: g.by,
      });
      cache.set(a.id, { token: t.access, until: at.getTime() + t.expiresIn * 1000 });
      const row = {
        provider: g.provider,
        address: a.ref,
        org: t.org,
        scopes: t.scopes.join(" ").slice(0, 2000),
        access,
        tokenName: ref,
        state: "connected" as const,
        why: null,
        connectedAt: at,
        checkedAt: at,
        by: g.by,
      };
      await main
        .insert(mailConnections)
        .values({ accountId: a.id, ...row })
        .onConflictDoUpdate({ target: mailConnections.accountId, set: row });
      const said =
        access === "read"
          ? `${a.ref} is connected to read and send.`
          : g.want === "read"
            ? `${a.ref} is connected to send. Reading wasn't granted.`
            : `${a.ref} is connected to send.`;
      return { ok: true, said, client, check: [a.id, ...(org ? [org.id] : [])] };
    },

    /** Clients with a mailbox connected to read: the reader's list. */
    async readingClients(): Promise<string[]> {
      const rows = await main
        .selectDistinct({ client: clientAccounts.client })
        .from(mailConnections)
        .innerJoin(clientAccounts, eq(clientAccounts.id, mailConnections.accountId))
        .where(
          and(
            eq(mailConnections.access, "read"),
            eq(mailConnections.state, "connected"),
            isNotNull(clientAccounts.client),
          ),
        );
      return rows.map((r) => r.client).filter((c): c is string => !!c);
    },

    /** A client's mailboxes connected to read, as the Monitor's `Mailbox`. */
    async boxesOf(client: string): Promise<Mailbox[]> {
      const rows = await main
        .select({ c: mailConnections })
        .from(mailConnections)
        .innerJoin(clientAccounts, eq(clientAccounts.id, mailConnections.accountId))
        .where(
          and(
            eq(clientAccounts.client, client),
            eq(mailConnections.access, "read"),
            eq(mailConnections.state, "connected"),
          ),
        );
      return rows.map(({ c }) => {
        const box =
          c.provider === "google"
            ? gmailMailbox(deps.fetch, c.address, () => tokenOf(c))
            : graphMailbox(deps.fetch, c.address, () => tokenOf(c));
        return {
          address: box.address,
          search: (q) => guarded(c, () => box.search(q)),
          raw: (id) => guarded(c, () => box.raw(id)),
          meta: (id) => guarded(c, () => box.meta(id)),
        };
      });
    },

    /**
     * A client's mailbox that sends, for a reply from its Inbox. Not connected, or broken: "Needs
     * setup" and where to fix it. Every connection sends; reading adds the original's headers.
     */
    async senderOf(client: string, address: string): Promise<MailSender> {
      const at = address.trim().toLowerCase();
      const [row] = await main
        .select({ c: mailConnections })
        .from(mailConnections)
        .innerJoin(clientAccounts, eq(clientAccounts.id, mailConnections.accountId))
        .where(and(eq(clientAccounts.client, client), eq(mailConnections.address, at)));
      const c = row?.c;
      if (!c) throw new MailRefusal(`Needs setup: ${at} isn't connected to send.`);
      if (c.state !== "connected")
        throw new MailRefusal(`Needs setup: ${at} needs connecting again.`);
      const token = () => tokenOf(c);
      return {
        address: at,
        reply: (to, body, ours) =>
          guarded(
            c,
            () =>
              c.provider === "google"
                ? gmailReply(deps.fetch, token, {
                    from: at,
                    to,
                    body,
                    ours,
                    read: c.access === "read",
                  })
                : graphReply(deps.fetch, token, { to, body }),
            "Sending was refused. Connect it again.",
          ),
      };
    },

    /** The page: the client's mailboxes and orgs, each with its state and next step. */
    async view(client: string) {
      const accounts = (await accountsOf(main, client)).filter((a) =>
        ["mailbox", "google_workspace", "microsoft_365"].includes(a.site),
      );
      const ids = accounts.map((a) => a.id);
      const conns = ids.length
        ? await main.select().from(mailConnections).where(inArray(mailConnections.accountId, ids))
        : [];
      const consents = ids.length
        ? await main.select().from(mailConsents).where(inArray(mailConsents.accountId, ids))
        : [];
      const apps = await deps.apps();
      const out = mailboxStates(accounts, conns, {
        google: !!apps.google,
        microsoft: !!apps.microsoft,
      });
      for (const o of out.orgs)
        o.tenant = consents.find((c) => c.accountId === o.id)?.tenant ?? o.tenant;
      return {
        ...out,
        apps: { google: !!apps.google, microsoft: !!apps.microsoft },
        /** What the Workspace admin pastes into App access control: an OAuth client id is public. */
        googleClientId: apps.google?.id ?? null,
        keyStore: deps.keys !== null,
      };
    },
  };
}
export type MailAccessApi = ReturnType<typeof mailAccess>;

/**
 * Whether a client's connected mailbox is a Google one: its mail is Google user data, so a model
 * reads it only if it doesn't train on it (designs/2026-10-09-app-reviews.md).
 */
export async function isGoogleMailbox(
  main: Queryable,
  client: string,
  address: string,
): Promise<boolean> {
  const [c] = await main
    .select({ provider: mailConnections.provider })
    .from(mailConnections)
    .innerJoin(clientAccounts, eq(clientAccounts.id, mailConnections.accountId))
    .where(
      and(
        eq(clientAccounts.client, client),
        sql`lower(${mailConnections.address}) = ${address.toLowerCase()}`,
      ),
    )
    .limit(1);
  return c?.provider === "google";
}

/** Expired or used grants older than a day: swept by the reader's pass. */
export async function sweepGrants(main: Queryable, at: Date): Promise<void> {
  await main
    .delete(mailGrants)
    .where(
      sql`${mailGrants.expiresAt} < ${new Date(at.getTime() - 86_400_000).toISOString()}::timestamptz`,
    );
}

/**
 * Wren's apps from config: the worker's settings first, else the key store under Wren's own
 * client (`wren keys put --client wren MAIL_GOOGLE_CLIENT_ID`), which keeps them out of the SSM
 * env parameter, near its size cap.
 */
export function mailAppsFrom(
  set: {
    googleId?: string | undefined;
    googleSecret?: string | undefined;
    microsoftId?: string | undefined;
    microsoftSecret?: string | undefined;
  },
  keys: KeyStore | null,
): () => Promise<MailApps> {
  let memo: { at: number; ttl: number; apps: MailApps } | null = null;
  const stored = (name: string) =>
    keys
      ? keys.named({ client: WREN, name, by: MAIL_KEYS, why: "Wren's mail app" }).catch(() => null)
      : null;
  const one = async (
    id: string | undefined,
    secret: string | undefined,
    prefix: string,
  ): Promise<MailApp | null> => {
    const i = id ?? (await stored(`${prefix}_CLIENT_ID`));
    const s = secret ?? (await stored(`${prefix}_CLIENT_SECRET`));
    return i && s ? { id: i, secret: s } : null;
  };
  return async () => {
    // Both found: kept an hour. One missing: asked again in 10 minutes, so an app William adds
    // shows without a deploy. Each read is a logged read.
    if (memo && Date.now() - memo.at < memo.ttl) return memo.apps;
    const apps = {
      google: await one(set.googleId, set.googleSecret, "MAIL_GOOGLE"),
      microsoft: await one(set.microsoftId, set.microsoftSecret, "MAIL_MICROSOFT"),
    };
    memo = { at: Date.now(), ttl: apps.google && apps.microsoft ? 3_600_000 : 600_000, apps };
    return apps;
  };
}
