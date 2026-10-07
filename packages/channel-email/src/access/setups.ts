/**
 * Mail access as setups (designs/2026-10-07-mail-access.md). An org's admin step once per domain
 * (Google Workspace trust, Microsoft 365 consent), then each mailbox's own sign-in. Every one
 * repeats, so a token taken back or an app un-trusted shows within the hour or day, and
 * SetupWatch starts it over.
 */
import { defineSetup, type SetupCheck } from "@wren/core/setup";
import { clientAccounts } from "@wren/core/setup-schema";
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { domainOf, FACTS, type MailAccessApi, wantOf } from "./access.js";
import { appInTenant, type MailApps } from "./oauth.js";
import { mailConnections, mailConsents } from "./schema.js";

/** Admin console → Security → Access and data control → API controls → App access control. */
export const GOOGLE_APP_ACCESS = "https://admin.google.com/ac/owl/list?tab=configuredApps";

export const GOOGLE_MAIL_SETUP = defineSetup({
  id: "setup.google_mail",
  name: "Trust Wren's app",
  blurb:
    "Your Google Workspace admin trusts Wren's app once, so your mailboxes can connect to read.",
  site: "google_workspace",
  repeat: "1 day",
  steps: [
    {
      id: "app",
      fact: FACTS.googleApp,
      label: "Wren's Google app",
      who: "auto",
      how: "Wren's team sets up its Google app. Nothing for you to do.",
      forYou: "Wren's team sets up its Google app.",
      check: "mail.google_app",
      every: "1 day",
    },
    {
      id: "trust",
      fact: FACTS.googleTrust,
      label: "Trust Wren's app",
      who: "client",
      how: "Your Google admin opens Admin console → Security → API controls → App access control, adds Wren's app by its client ID and marks it Trusted. Then connect one mailbox to read and press Check.",
      forYou: "In development. For now Wren's team walks your admin through it on a short call.",
      check: "google.mail_trust",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const MICROSOFT_MAIL_SETUP = defineSetup({
  id: "setup.microsoft_mail",
  name: "Admin consent",
  blurb: "Your Microsoft 365 admin consents once, so your mailboxes can connect to read.",
  site: "microsoft_365",
  repeat: "1 day",
  steps: [
    {
      id: "app",
      fact: FACTS.microsoftApp,
      label: "Wren's Microsoft app",
      who: "auto",
      how: "Wren's team sets up its Microsoft app. Nothing for you to do.",
      forYou: "Wren's team sets up its Microsoft app.",
      check: "mail.microsoft_app",
      every: "1 day",
    },
    {
      id: "consent",
      fact: FACTS.microsoftConsent,
      label: "Admin consent",
      who: "client",
      how: "Your Microsoft 365 admin opens the consent link, signs in, and accepts Mail.Read, Mail.Send and offline access for your organization.",
      forYou: "In development. For now Wren's team sends your admin the link and stays on a call.",
      check: "microsoft.admin_consent",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const MAILBOX_SETUP = defineSetup({
  id: "setup.mailbox",
  name: "Connect mailbox",
  blurb:
    "One sign-in as the mailbox, so Wren can send from it, and read it once your admin allows.",
  site: "mailbox",
  repeat: "1 hour",
  steps: [
    {
      id: "connected",
      fact: FACTS.mailbox,
      label: "Mailbox connected",
      who: "client",
      how: "Press Connect on Account → Mail and sign in as this mailbox.",
      forYou: "Only the mailbox's owner can sign in as it. Wren's team helps on a call.",
      check: "mailbox.token",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const MAIL_SETUPS = [GOOGLE_MAIL_SETUP, MICROSOFT_MAIL_SETUP, MAILBOX_SETUP];

/**
 * The checks: Wren's apps in config, a test read on a Workspace domain, the Microsoft tenant
 * holding Wren's app, and each mailbox's token refreshing with its scopes.
 */
export function mailChecks(o: {
  main: Queryable;
  apps: () => Promise<MailApps>;
  access: MailAccessApi;
  fetch: FetchLike;
}): Record<string, SetupCheck> {
  const conn = async (accountId: number) => o.access.connectionOf(accountId);
  return {
    "mail.google_app": async () =>
      (await o.apps()).google
        ? { ok: true, why: "Wren's Google app is set" }
        : { ok: false, why: "Needs setup: Wren's Google app" },
    "mail.microsoft_app": async () =>
      (await o.apps()).microsoft
        ? { ok: true, why: "Wren's Microsoft app is set" }
        : { ok: false, why: "Needs setup: Wren's Microsoft app" },

    // Google tells no one but the admin whether an app is trusted. A read on a mailbox of the
    // domain is what trust buys, so it's what this checks.
    "google.mail_trust": async ({ account }) => {
      if (!account.client) return { ok: false, why: "Wren's own mail is the Monitor's" };
      const rows = await o.main
        .select({ c: mailConnections })
        .from(mailConnections)
        .innerJoin(clientAccounts, eq(clientAccounts.id, mailConnections.accountId))
        .where(
          and(
            eq(clientAccounts.client, account.client),
            eq(mailConnections.provider, "google"),
            eq(mailConnections.access, "read"),
            eq(mailConnections.state, "connected"),
          ),
        );
      const mine = rows.filter(({ c }) => domainOf(c.address) === account.ref.toLowerCase());
      if (!mine.length)
        return { ok: false, why: `Connect one ${account.ref} mailbox to read, then check` };
      const tried: string[] = [];
      for (const { c } of mine) {
        try {
          await o.access.reads(c);
          return { ok: true, why: `A read works on ${c.address}`, seen: { mailbox: c.address } };
        } catch (err) {
          tried.push(
            `${c.address}: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`,
          );
        }
      }
      return { ok: false, why: "No read works yet", seen: { tried } };
    },

    "microsoft.admin_consent": async ({ account }) => {
      const [c] = await o.main
        .select()
        .from(mailConsents)
        .where(eq(mailConsents.accountId, account.id));
      if (!c) return { ok: false, why: "Your admin hasn't opened the consent link yet" };
      const app = (await o.apps()).microsoft;
      if (!app) return { ok: false, why: "Needs setup: Wren's Microsoft app" };
      const r = await appInTenant(o.fetch, app, c.tenant);
      return { ...r, seen: { tenant: c.tenant } };
    },

    "mailbox.token": async ({ account }) => {
      const c = await conn(account.id);
      if (!c) return { ok: false, why: "Not connected yet" };
      if (c.state === "broken") return { ok: false, why: c.why ?? "Its sign-in stopped working" };
      try {
        // Read access proves itself with a read; send-only with a refresh.
        if (c.access === "read") await o.access.reads(c);
        else await o.access.tokenOf(c);
      } catch (err) {
        return {
          ok: false,
          why: err instanceof Error ? err.message.slice(0, 200) : "Its sign-in stopped working",
        };
      }
      const want = wantOf(account);
      return {
        ok: true,
        why:
          c.access === "read"
            ? "Reads and sends"
            : want === "read"
              ? "Sends; reading waits on the admin"
              : "Sends",
        seen: { access: c.access },
      };
    },
  };
}
