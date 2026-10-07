/**
 * The daily Postmaster pull (U-D12) as a Virtual Object with one key. A pass
 * re-reads the last `days` for every sending domain (upserted: Google
 * publishes late and revises), then sleeps until the next local midnight —
 * whether or not it worked. A Postmaster outage must not become a call per
 * minute, and tomorrow's pull re-reads today's window anyway.
 *
 * `PostmasterScheduler/<client>/daily`: the same pull for a client with Inbox health installed,
 * on its own sending domains (`accounts.postmaster`), into its own database. Only a domain its
 * setup verified in Postmaster (`postmaster.verified` on its `domain` account) is read; the rest
 * are named in the pass. Wren's Postmaster login reads them: the domain is added to it.
 */
import type * as restate from "@restatedev/restate-sdk";
import { findClient } from "@wren/core/clients";
import { clientOfKey, makeLoopObject, pausedPass, runPass, stoppedPass } from "@wren/core/restate";
import { accountsOf } from "@wren/core/setup";
import { partPaused, pausedText } from "@wren/core/setup-alerts";
import type { Db, Queryable } from "@wren/db";
import { EMAIL_COMPONENTS, INBOX_HEALTH } from "../components.js";
import {
  type PostmasterClient,
  type PostmasterStats,
  syncPostmaster,
} from "../inbox/postmaster.js";
import type { SendPolicy } from "../send/policy.js";

export interface PostmasterSchedulerDeps {
  db: Db;
  client: PostmasterClient;
  /** The distinct domains the roster sends from, in roster order. */
  domains: readonly string[];
  /** For the local day boundary (the send timezone). */
  policy: SendPolicy;
  /** The window each pull re-reads (default 7 days). */
  days?: number;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
}

export const POSTMASTER_KEY = "fleet";
export const POSTMASTER_SYNC_COMMAND = "outreach postmaster sync";
export const POSTMASTER_VERIFIED = "postmaster.verified";

type ClientPostmaster =
  | { kind: "gone"; why: string }
  | { kind: "work"; domains: string[]; skipped: string[] };

/** Its sending domains, comma separated, lower case, once each. */
export const domainsOf = (raw: string | undefined): string[] => [
  ...new Set(
    (raw ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** Which of a client's domains its pass reads, or why it stops. */
export async function clientPostmaster(main: Queryable, id: string): Promise<ClientPostmaster> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  if (!(INBOX_HEALTH in client.products))
    return { kind: "gone", why: "inbox health is not installed" };
  const named = domainsOf(client.accounts.postmaster);
  if (!named.length) return { kind: "gone", why: "no sending domain connected" };
  const verified = new Set(
    (await accountsOf(main, id))
      .filter(
        (a) =>
          a.site === "domain" &&
          a.facts.some((f) => f.fact === POSTMASTER_VERIFIED && f.state === "ok"),
      )
      .map((a) => a.ref.toLowerCase()),
  );
  const domains = named.filter((d) => verified.has(d));
  const skipped = named.filter((d) => !verified.has(d));
  if (!domains.length)
    return { kind: "gone", why: `not verified in Postmaster yet: ${skipped.join(", ")}` };
  return { kind: "work", domains, skipped };
}

/** Ms from `now` to the next local midnight. */
export function untilNextLocalDay(policy: SendPolicy, now: Date): number {
  const [, nextMidnight] = policy.localDayBounds(now);
  return nextMidnight.getTime() - now.getTime();
}

export function makePostmasterScheduler(deps: PostmasterSchedulerDeps) {
  const days = deps.days ?? 7;
  /** A client's pass: its verified domains into its own database. */
  const clientPass = async (ctx: restate.ObjectContext, id: string, now: Date, delay: number) => {
    if (!deps.clientDb) return stoppedPass<ClientStats>(ctx, now, "no client databases here");
    const plan = await ctx.run("client", () => clientPostmaster(deps.db, id));
    if (plan.kind === "gone") return stoppedPass<ClientStats>(ctx, now, plan.why);
    // A lost fact (Postmaster no longer verified) holds the pull; it resumes once it's back.
    const part = EMAIL_COMPONENTS.find((c) => c.id === INBOX_HEALTH);
    const lost = part ? await ctx.run("paused", () => partPaused(deps.db, id, part)) : null;
    if (lost) return pausedPass<ClientStats>(ctx, now, pausedText(lost), delay);
    const db = deps.clientDb(id);
    return runPass<ClientStats>(ctx, db, now, {
      name: "postmaster sync",
      ledger: {
        command: POSTMASTER_SYNC_COMMAND,
        argv: { daemon: true, days, domains: plan.domains },
      },
      body: async (runId) => ({
        ...(await syncPostmaster(db, {
          client: deps.client,
          domains: plan.domains,
          days,
          today: now.toISOString().slice(0, 10),
          runId,
        })),
        not_verified: plan.skipped,
      }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  };
  return makeLoopObject("PostmasterScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const delay = untilNextLocalDay(deps.policy, now);
    const client = clientOfKey(ctx.key);
    if (client) return clientPass(ctx, client.client, now, delay);
    return runPass<PostmasterStats>(ctx, deps.db, now, {
      name: "postmaster sync",
      ledger: {
        command: POSTMASTER_SYNC_COMMAND,
        argv: { daemon: true, days, domains: [...deps.domains] },
      },
      body: (runId) =>
        syncPostmaster(deps.db, {
          client: deps.client,
          domains: deps.domains,
          days,
          today: now.toISOString().slice(0, 10),
          runId,
        }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  });
}

type ClientStats = PostmasterStats & { not_verified: string[] };

export type PostmasterScheduler = ReturnType<typeof makePostmasterScheduler>;
