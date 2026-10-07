/**
 * Reach per client (designs/2026-10-07-per-client-runs.md): a client's comments, discovery, DMs
 * and invites run on its own logins (`clients.accounts.reddit`, `.linkedin`) into its own
 * database. Reads go through the vendor gate on its own limits (`@wren/core/metered`); nothing
 * leaves until an admin turns that part's sends on (`sendsOn`) and the global gate is on too.
 */
import { type Client, findClient, sendsOn } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { inArray } from "drizzle-orm";
import { addAccount, listAccounts } from "./accounts.js";
import { PLATFORMS, type Platform, type ReachAccount, reachAccounts } from "./schema.js";

export const REACH_PARTS = [
  "reach.outreach",
  "reach.touch",
  "comments.read",
  "comments.sort",
  "reddit.discovery",
  "linkedin.invites",
] as const;
export type ReachPart = (typeof REACH_PARTS)[number];

export interface ClientLogin {
  platform: Platform;
  account: string;
}

export type ClientReach =
  | { kind: "gone"; why: string }
  | {
      kind: "work";
      client: Client;
      /** The wanted parts it has installed. */
      parts: ReachPart[];
      logins: ClientLogin[];
      /** Logins left out, with why: a bad key, or one of Wren's own. */
      skipped: string[];
    };

/**
 * Its logins on each reach site, comma separated, each `site@label`. One of Wren's own logins is
 * never a client's: Wren's reach rows name them.
 */
export function loginsOf(
  accounts: Readonly<Record<string, string>>,
  wren: ReadonlySet<string>,
): { logins: ClientLogin[]; skipped: string[] } {
  const logins: ClientLogin[] = [];
  const skipped: string[] = [];
  for (const platform of PLATFORMS)
    for (const raw of (accounts[platform] ?? "").split(",")) {
      const account = raw.trim();
      if (!account) continue;
      if (!account.startsWith(`${platform}@`)) skipped.push(`${account}: not ${platform}@<label>`);
      else if (wren.has(account)) skipped.push(`${account}: one of Wren's own logins`);
      else logins.push({ platform, account });
    }
  return { logins, skipped };
}

/** Is this client worked by a pass of any of `wants`, and on which logins? */
export async function clientReach(
  main: Queryable,
  id: string,
  wants: readonly ReachPart[],
): Promise<ClientReach> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  const parts = wants.filter((p) => p in client.products);
  if (!parts.length) return { kind: "gone", why: `none of ${wants.join(", ")} is installed` };
  const wren = new Set((await listAccounts(main)).map((a) => a.account));
  const { logins, skipped } = loginsOf(client.accounts, wren);
  if (!logins.length)
    return {
      kind: "gone",
      why: skipped.length ? `no usable login: ${skipped.join("; ")}` : "no login connected",
    };
  return { kind: "work", client, parts, logins, skipped };
}

/**
 * The client's logins as reach rows in its own database: a new one starts `warming`, as Wren's
 * do. Answers the rows of the logins it has now; a login it dropped keeps its row, unread.
 */
export async function syncLogins(
  db: Queryable,
  logins: readonly ClientLogin[],
  now: Date,
): Promise<ReachAccount[]> {
  for (const l of logins) await addAccount(db, { platform: l.platform, account: l.account, now });
  if (!logins.length) return [];
  return db
    .select()
    .from(reachAccounts)
    .where(
      inArray(
        reachAccounts.account,
        logins.map((l) => l.account),
      ),
    );
}

/**
 * What may leave for this client, by message kind: an invite (`connect`) on `linkedin.invites`,
 * a Follow-up or Nurture DM on that part's flag, every other DM on `reach.outreach`. All also
 * need the global gate.
 */
export const clientSends =
  (client: Pick<Client, "sends">, globalLive: boolean) =>
  (kind: string): boolean =>
    globalLive &&
    (kind === "follow_up"
      ? sendsOn(client, "follow_up") || sendsOn(client, "nurture")
      : sendsOn(client, kind === "connect" ? "linkedin.invites" : "reach.outreach"));
