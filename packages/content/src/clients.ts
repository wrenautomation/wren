/**
 * Content per client (designs/2026-10-07-per-client-runs.md): a client's plan, drafts, posts and
 * social reads run on its own logins into its own database. LinkedIn and Reddit logins post now;
 * the other channels wait on their apps ("In development"). Drafts wait in its To approve; a post
 * leaves only once an admin turns its posting on (`sendsOn`).
 */

import { type Client, findClient } from "@wren/core/clients";
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { listAccounts, loginsOf } from "@wren/outreach";
import { type ClientPlannerSettings, clientPlannerSchema } from "./components.js";
import type { Brand } from "./voice.js";

/** The channels a client's own login posts on today. */
export const CLIENT_PLATFORMS = ["linkedin", "reddit"] as const satisfies readonly Platform[];
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

/** A client's voice until it sets its own: plain, and never William's first person. */
export const CLIENT_VOICE = `Plain and concise. Short sentences a person would say out loud.
Concrete over abstract: what was done, for whom, what changed, with numbers where there are any.
No hype, no jargon, no emoji, no hashtags, no exclamation marks, no calls to follow or like.`;

export type ClientContent =
  | { kind: "gone"; why: string }
  | {
      kind: "work";
      client: Client;
      /** Its logins by platform, Wren's own left out. */
      logins: Partial<Record<ClientPlatform, string>>;
      platforms: ClientPlatform[];
    };

/** Is this client's `part` run, and on which logins? Its first login per platform posts. */
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
  for (const l of loginsOf(client.accounts, wren).logins)
    if ((CLIENT_PLATFORMS as readonly string[]).includes(l.platform))
      logins[l.platform as ClientPlatform] ??= l.account;
  const platforms = CLIENT_PLATFORMS.filter((p) => logins[p]);
  if (!platforms.length) return { kind: "gone", why: "no LinkedIn or Reddit login connected" };
  return { kind: "work", client, logins, platforms };
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
