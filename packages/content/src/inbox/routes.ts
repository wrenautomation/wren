/**
 * Where a client's DM or comment reply can go (designs/2026-10-07-inbox-reply.md): only through
 * the client's own connected account for that platform, never Wren's. A platform with no API for
 * it says "Not available yet" and why; one with no connected account says so and points at
 * Account → Social. A reply to mail goes out through the client's mailbox it came to: one that
 * isn't connected says "Needs setup" and points at Account → Mail.
 */
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { socialConnections } from "../connect/schema.js";
import type { InboxChannel } from "../schema.js";
import type { ReplyOption } from "./conversation.js";

/** A connected account's platform and state, all a route needs. */
export interface AccountState {
  platform: string;
  state: string;
}

/** A client's mailbox connection: its address and state (`mail_connections`). */
export interface MailboxState {
  address: string;
  state: string;
}

/** Why a route is shut, and what fixes it: connecting a social account, or a mailbox. */
export interface Shut {
  off: string;
  fix: "social" | "mail" | null;
}

/** Where the fix lives in the portal. */
export const SOCIAL_PAGE = "/account/social";
export const MAIL_PAGE = "/account/mail";

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

/**
 * Is a reply to mail through `from` shut? Null when the mailbox is connected. Every connection
 * sends: the send scope is part of each.
 */
export function mailRoute(from: string, mailboxes: readonly MailboxState[]): Shut | null {
  const at = from.toLowerCase();
  const m = mailboxes.find((b) => b.address.toLowerCase() === at);
  if (m?.state === "connected") return null;
  return {
    off: m
      ? `Needs setup: ${at} needs connecting again.`
      : `Needs setup: ${at} isn't connected to send.`,
    fix: "mail",
  };
}

/** What a client's routes read: its social accounts and its mailboxes. */
export interface Routes {
  accounts: readonly AccountState[];
  mailboxes: readonly MailboxState[];
}

/** One option's route for a client: mail by its mailbox, a DM or comment by its account. */
export const routeOf = (o: ReplyOption, r: Routes): Shut | null =>
  o.from ? mailRoute(o.from, r.mailboxes) : clientRoute(o.channel, o.platform, r.accounts);

/** Each option a client's thread offers, with its route checked. One already shut stays as is. */
export function withRoutes(options: readonly ReplyOption[], r: Routes): ReplyOption[] {
  return options.map((o) => {
    if (o.off) return o;
    const shut = routeOf(o, r);
    return shut ? { ...o, ...shut } : o;
  });
}

/** A client's mailbox connections, live or broken (channel-email's `mail_connections`). */
export async function clientMailboxes(main: Queryable, client: string): Promise<MailboxState[]> {
  const rows = (await main.execute(
    sql`select lower(mc.address) address, mc.state from mail_connections mc
      join client_accounts a on a.id = mc.account_id where a.client = ${client}`,
  )) as unknown as MailboxState[];
  return rows.map((r) => ({ address: String(r.address), state: String(r.state) }));
}

/** Everything a client's routes read. */
export async function clientRoutes(main: Queryable, client: string): Promise<Routes> {
  const [accounts, mailboxes] = await Promise.all([
    clientAccounts(main, client),
    clientMailboxes(main, client),
  ]);
  return { accounts, mailboxes };
}

/** A client's connected accounts, live or broken. */
export async function clientAccounts(main: Queryable, client: string): Promise<AccountState[]> {
  return main
    .select({ platform: socialConnections.platform, state: socialConnections.state })
    .from(socialConnections)
    .where(eq(socialConnections.client, client));
}
