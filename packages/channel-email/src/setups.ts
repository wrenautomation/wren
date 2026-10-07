/**
 * Sending domains and inboxes as setups (designs/2026-10-07-setup-and-vendors.md): one domain
 * account per sending domain, one inbox account per address. Both repeat weekly, so a broken
 * record or a bad placement shows the same week.
 */

import { defineSetup, type SetupCheck } from "@wren/core/setup";
import type { Queryable } from "@wren/db";
import { placementVerdicts } from "./inbox/placement.js";

export const DOMAIN_SETUP = defineSetup({
  id: "setup.domain",
  name: "Sending domain",
  blurb: "A domain of its own for cold email, with the records receivers check.",
  site: "domain",
  repeat: "7 days",
  steps: [
    {
      id: "owned",
      fact: "domain.owned",
      label: "Domain bought",
      who: "wren",
      how: "Buy a domain close to your main one and tell Wren its name.",
      forYou: "Wren buys a domain close to your main one.",
      goal: "buy this domain at the registrar",
      buys: true,
      check: "dns.answers",
      every: "1 hour",
      within: "7 days",
    },
    {
      id: "dns",
      fact: "domain.dns",
      label: "SPF, DKIM and DMARC",
      who: "client",
      how: "Add the MX, SPF, DKIM and DMARC records Wren sends you at your DNS host.",
      forYou: "Wren's team adds the mail records at your DNS host.",
      goal: "add the MX, SPF, DKIM and DMARC records for this domain at its DNS host",
      check: "dns.mail_records",
      every: "15 minutes",
      within: "2 days",
    },
    {
      id: "postmaster",
      fact: "postmaster.verified",
      label: "Postmaster verified",
      who: "client",
      how: "Add the domain in Google Postmaster Tools and put its TXT record at your DNS host.",
      forYou: "Wren's team adds the domain to Postmaster Tools and puts its TXT record in DNS.",
      goal: "verify this domain in Google Postmaster Tools",
      check: "dns.postmaster_txt",
      every: "1 hour",
      within: "7 days",
    },
  ],
});

export const INBOX_SETUP = defineSetup({
  id: "setup.inbox",
  name: "Sending inbox",
  blurb: "An inbox on a sending domain, warmed before it sends cold.",
  site: "inbox",
  repeat: "7 days",
  steps: [
    {
      id: "signs_in",
      fact: "inbox.signs_in",
      label: "Inbox signs in",
      who: "wren",
      how: "Wren creates the inbox and checks it signs in.",
      forYou: "Wren creates the inbox and checks it signs in.",
      goal: "create this inbox and confirm it signs in",
      buys: true,
      check: "inbox.auth",
      every: "1 hour",
      within: "7 days",
    },
    {
      id: "warmed",
      fact: "inbox.warmed",
      label: "Warmup reached its ramp",
      who: "auto",
      how: "Warmup sends a little more each day. This takes about a month.",
      forYou: "Warmup sends a little more each day. This takes about a month.",
      check: "inbox.warmup",
      every: "1 day",
      within: "45 days",
    },
    {
      id: "placement",
      fact: "inbox.placement",
      label: "Lands in the inbox",
      who: "auto",
      how: "Test sends show where its mail lands.",
      forYou: "Test sends show where its mail lands.",
      check: "inbox.placement",
      every: "1 day",
      within: "14 days",
    },
  ],
});

export const EMAIL_SETUPS = [DOMAIN_SETUP, INBOX_SETUP];

/** When an inbox's warmup began, and its ramp: the roster's `warmupStart`, `warmupStep`, `warmupLimit`. */
export interface Warmup {
  start: Date;
  step: number;
  limit: number;
}

const DAY_MS = 86_400_000;

/**
 * The inbox checks that read what Wren already keeps: warmup from the roster, placement from
 * the owner's placement tests. `dbOf` is the database holding the owner's tests.
 */
export function emailChecks(o: {
  dbOf: (client: string | null) => Promise<Queryable>;
  warmupOf: (address: string) => Promise<Warmup | null>;
}): Record<string, SetupCheck> {
  return {
    "inbox.warmup": async ({ account, now }) => {
      const w = await o.warmupOf(account.ref.toLowerCase());
      if (!w) return { ok: false, why: "Warmup hasn't started" };
      const days = Math.max(0, Math.floor((now.getTime() - w.start.getTime()) / DAY_MS));
      const at = Math.min(w.limit, days * w.step);
      return at >= w.limit
        ? { ok: true, why: `Warmup at ${w.limit} a day`, seen: { days, at } }
        : { ok: false, why: `Warmup at ${at} of ${w.limit} a day`, seen: { days, at } };
    },
    "inbox.placement": async ({ account, now }) => {
      const db = await o.dbOf(account.client);
      const [d] = await placementVerdicts(db, { now, senders: [account.ref] });
      if (!d || d.verdict === "not enough")
        return { ok: false, why: "Not enough test sends yet", seen: d };
      // A copy problem is the copy's, not the inbox's.
      return d.verdict === "domain problem"
        ? { ok: false, why: "Test sends land in spam", seen: d }
        : { ok: true, why: "Test sends land in the inbox", seen: d };
    },
  };
}
