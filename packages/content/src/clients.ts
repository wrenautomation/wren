/**
 * Content per client (designs/2026-10-07-per-client-runs.md): a client's plan, drafts, posts and
 * social reads run on its own logins into its own database. Its connected social accounts
 * (designs/2026-10-07-client-social.md) post through each platform's API; LinkedIn and Reddit
 * logins through autobrowse. Drafts wait in its To approve; a post leaves only once an admin turns
 * its posting on (`sendsOn`).
 */

import { type Client, findClient } from "@wren/core/clients";
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { listAccounts, loginsOf } from "@wren/outreach";
import { type ClientPlannerSettings, clientPlannerSchema } from "./components.js";
import { liveConnections, loginOf } from "./connect/access.js";
import { channelOf, SOCIAL, type SocialPlatform } from "./connect/platforms.js";
import type { SocialExtra } from "./connect/schema.js";
import type { Brand } from "./voice.js";

/** The channels a client's own autobrowse login posts on. */
export const CLIENT_PLATFORMS = ["linkedin", "reddit"] as const satisfies readonly Platform[];
/** Every channel a client posts on: its logins, and its connected accounts. */
const CHANNEL_ORDER = [
  "linkedin",
  "reddit",
  "youtube",
  "x",
  "instagram",
  "facebook",
  "tiktok",
  "google_business",
] as const;
export type ClientPlatform = Platform;

/** A connected account behind a channel: what its adapter needs past the token. */
export interface ConnectedAccount {
  platform: SocialPlatform;
  extra: SocialExtra;
}

/** A client's voice until it sets its own: plain, and never William's first person. */
export const CLIENT_VOICE = `Plain and concise. Short sentences a person would say out loud.
Concrete over abstract: what was done, for whom, what changed, with numbers where there are any.
No hype, no jargon, no emoji, no hashtags, no exclamation marks, no calls to follow or like.`;

export type ClientContent =
  | { kind: "gone"; why: string }
  | {
      kind: "work";
      client: Client;
      /** Its logins by platform, Wren's own left out; a connected account is `social:<id>`. */
      logins: Partial<Record<ClientPlatform, string>>;
      platforms: ClientPlatform[];
      /** The connected account behind each channel that has one. */
      connected: Partial<Record<ClientPlatform, ConnectedAccount>>;
      /** Channels whose post comments its account can read: an autobrowse login reads them all. */
      comments: ClientPlatform[];
      /** Channels with reviews of the account itself (Business Profile). */
      reviews: ClientPlatform[];
      /** Its connected accounts whose DMs come into its Inbox. */
      dms: SocialPlatform[];
    };

/** Business Profile is the one channel whose comments are reviews of the account. */
const REVIEWED: readonly ClientPlatform[] = ["google_business"];
/** Only a connected account posts here: a Business Profile login is for review asks, not posts. */
const CONNECTED_ONLY: readonly ClientPlatform[] = ["google_business"];
/** On LinkedIn a company page posts ahead of a person's profile. */
const AHEAD: readonly SocialPlatform[] = ["linkedin_page"];

/**
 * Is this client's `part` run, and on which logins? A connected account comes first (a company
 * page ahead of a profile), then its first autobrowse login per platform.
 */
export async function clientContent(
  main: Queryable,
  id: string,
  part: string,
): Promise<ClientContent> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  if (!(part in client.products)) return { kind: "gone", why: `${part} is not installed` };
  const wren = new Set((await listAccounts(main)).map((a) => a.account));
  const logins: Partial<Record<ClientPlatform, string>> = {};
  const connected: Partial<Record<ClientPlatform, ConnectedAccount>> = {};
  const dms = new Set<SocialPlatform>();
  const conns = await liveConnections(main, id);
  const ahead = (p: SocialPlatform) => (AHEAD.includes(p) ? 0 : 1);
  for (const c of [...conns].sort((a, b) => ahead(a.platform) - ahead(b.platform))) {
    const ch = channelOf(c.platform);
    if (!logins[ch]) {
      logins[ch] = loginOf(c.id);
      connected[ch] = { platform: c.platform, extra: c.extra };
    }
    if (SOCIAL[c.platform].dms) dms.add(c.platform);
  }
  for (const l of loginsOf(client.accounts, wren).logins)
    if (
      (CLIENT_PLATFORMS as readonly string[]).includes(l.platform) &&
      !CONNECTED_ONLY.includes(l.platform as ClientPlatform)
    )
      logins[l.platform as ClientPlatform] ??= l.account;
  const platforms = CHANNEL_ORDER.filter((p) => logins[p]);
  if (!platforms.length) return { kind: "gone", why: "no social account connected" };
  const account = (p: ClientPlatform) => connected[p];
  return {
    kind: "work",
    client,
    logins,
    platforms,
    connected,
    comments: platforms.filter((p) => {
      const a = account(p);
      return !REVIEWED.includes(p) && (!a || SOCIAL[a.platform].comments);
    }),
    reviews: platforms.filter((p) => REVIEWED.includes(p) && !!account(p)),
    dms: [...dms],
  };
}

/** Its planner block, or why it won't draft: a client's posts never speak as Wren. */
export function clientPlan(
  client: Client,
):
  | { ok: true; settings: ClientPlannerSettings; brand: Brand; voice: string }
  | { ok: false; why: string } {
  const parsed = clientPlannerSchema.safeParse(client.products["content.planner"] ?? {});
  if (!parsed.success) return { ok: false, why: "the content plan settings do not parse" };
  const about = parsed.data.about?.trim();
  if (!about) return { ok: false, why: "say what it does and for whom: set About" };
  return {
    ok: true,
    settings: parsed.data,
    brand: { name: client.name, about },
    voice: parsed.data.voice?.trim() || CLIENT_VOICE,
  };
}
