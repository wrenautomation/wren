/**
 * Where a client's DM or comment reply can go (designs/2026-10-07-inbox-reply.md): only through
 * the client's own connected account for that platform, never Wren's. A platform with no API for
 * it says "Not available yet" and why; one with no connected account says so and points at
 * Account → Social.
 */
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { socialConnections } from "../connect/schema.js";
import type { InboxChannel } from "../schema.js";
import type { ReplyOption } from "./conversation.js";

/** A connected account's platform and state, all a route needs. */
export interface AccountState {
  platform: string;
  state: string;
}

/** Why a route is shut, and whether connecting an account fixes it. */
export interface Shut {
  off: string;
  fix: "social" | null;
}

/** Where the fix lives in the portal. */
export const SOCIAL_PAGE = "/account/social";

const NAME: Record<string, string> = {
  facebook: "Facebook Page",
  google_business: "Business Profile",
  instagram: "Instagram",
  linkedin: "LinkedIn company page",
  x: "X",
  youtube: "YouTube channel",
};

/** Which channels each platform's official API answers on a client's own account. */
const ANSWERS: Record<string, readonly ("dm" | "comment")[]> = {
  facebook: ["dm", "comment"],
  google_business: ["comment"],
  instagram: ["dm", "comment"],
  linkedin: ["comment"],
  x: ["dm", "comment"],
  youtube: ["comment"],
};

/** The connected account that answers a platform's comments when it isn't the platform itself. */
const ACCOUNT_OF: Record<string, string> = { linkedin: "linkedin_page" };

const REDDIT =
  "Not available yet. Reddit approves each API app by hand, and client accounts can't connect yet.";

/** Why a platform can't answer yet, said to the client. */
const NOT_YET: Record<string, Partial<Record<"dm" | "comment", string>>> = {
  linkedin: {
    dm: "Not available yet. LinkedIn has no messaging API.",
  },
  google_business: { dm: "Business Profile chat isn't connected." },
  reddit: {
    dm: REDDIT,
    comment: REDDIT,
  },
  tiktok: {
    dm: "Not available yet. TikTok has no API for DMs.",
    comment: "Not available yet. TikTok has no API for comments.",
  },
  youtube: { dm: "YouTube has no DMs." },
};

/**
 * Is a client's reply on this channel shut, and why? Null when it can go. Texts and email are
 * the client's own numbers and mailboxes: never shut here.
 */
export function clientRoute(
  channel: InboxChannel,
  platform: string | null,
  accounts: readonly AccountState[],
): Shut | null {
  if (channel !== "dm" && channel !== "comment") return null;
  const p = platform ?? "";
  if (!ANSWERS[p]?.includes(channel))
    return {
      off: NOT_YET[p]?.[channel] ?? "Not available yet. That site has no API for it.",
      fix: null,
    };
  const account = ACCOUNT_OF[p] ?? p;
  const mine = accounts.filter((a) => a.platform === account);
  const name = NAME[p] ?? p;
  if (mine.some((a) => a.state === "connected")) return null;
  if (mine.length) return { off: `Your ${name} account needs connecting again.`, fix: "social" };
  return {
    off: `No ${name} account connected. Replies go out on your own account.`,
    fix: "social",
  };
}

/** Each option a client's thread offers, with its route checked. One already shut stays as is. */
export function withRoutes(
  options: readonly ReplyOption[],
  accounts: readonly AccountState[],
): ReplyOption[] {
  return options.map((o) => {
    if (o.off) return o;
    const shut = clientRoute(o.channel, o.platform, accounts);
    return shut ? { ...o, ...shut } : o;
  });
}

/** A client's connected accounts, live or broken. */
export async function clientAccounts(main: Queryable, client: string): Promise<AccountState[]> {
  return main
    .select({ platform: socialConnections.platform, state: socialConnections.state })
    .from(socialConnections)
    .where(eq(socialConnections.client, client));
}
