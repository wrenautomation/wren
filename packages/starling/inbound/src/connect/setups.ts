/**
 * A connected social account as a setup (designs/2026-10-07-client-social.md): one step, its
 * token, checked every hour. A refresh or a who-am-I read that fails marks it Broken, and
 * SetupWatch starts it over once lost.
 */
import { defineSetup, type SetupCheck } from "@wren/core/setup";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { SOCIAL_FACT, type SocialAccessApi } from "./access.js";
import { socialConnections } from "./schema.js";

export const SOCIAL_SETUP = defineSetup({
  id: "setup.social",
  name: "Connect social account",
  blurb: "One sign-in on the platform, so Wren can post, read comments and DMs, and reply.",
  site: "social",
  repeat: "1 hour",
  steps: [
    {
      id: "connected",
      fact: SOCIAL_FACT,
      label: "Account connected",
      who: "client",
      how: "Press Connect on Account → Social and sign in as the account.",
      forYou: "Only the account's owner can sign in. Wren's team helps on a call.",
      check: "social.token",
      every: "1 hour",
      within: "14 days",
    },
  ],
});

export const SOCIAL_SETUPS = [SOCIAL_SETUP];

/** The check: the connection's token refreshes and reads who it is. */
export function socialChecks(o: {
  main: Queryable;
  access: SocialAccessApi;
}): Record<string, SetupCheck> {
  return {
    "social.token": async ({ account }) => {
      const [c] = await o.main
        .select()
        .from(socialConnections)
        .where(eq(socialConnections.accountId, account.id));
      if (!c) return { ok: false, why: "Not connected yet" };
      const r = await o.access.check(c);
      return { ...r, seen: { platform: c.platform, handle: c.handle } };
    },
  };
}
