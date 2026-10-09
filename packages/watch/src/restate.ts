/**
 * `Watch/all`: every 15 minutes, read new mail in each inbox and each Learn source due a read.
 * Mail goes along the `watch` workflow, where triage settles it; new feed items along `learn`,
 * where they're read and scored. Then Learn's alerts and its 09:00 digest go out, and every
 * workspace's people get their portal bell (and their digest mail where it's on). Served on the
 * Postgres box, like the books: the personal inbox is read through the Mac's desk, and waiting
 * there costs nothing. Mail sends no notices: what needs William shows in the Inbox app, and an
 * inbox it couldn't read shows on the loop.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Mailbox } from "@wren/core/mailbox";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import {
  alertLearn,
  type DigestMail,
  embedMissing,
  type FetchFn,
  itemEvent,
  mailLearnDigests,
  type PullStats,
  pullFeeds,
  tellLearn,
} from "@wren/learn";
import { LEARN_FEEDS_FROM, LEARN_FLOW } from "@wren/learn/console";
import type { Embed } from "@wren/llm";
import { type ReadStats, readMail } from "./read.js";
import { mailEvent } from "./triage.js";

export * from "./console.js";

export const WATCH_KEY = "all";
export const WATCH_EVERY_MS = 15 * 60_000;
/** While every inbox has a live Gmail watch, a push wakes the pass: the poll is only the net. */
export const WATCH_NET_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/** The workflow, and the node the reader is in it. */
export const WATCH_FLOW = "watch";
export const WATCH_FROM = "read.mail";

export interface WatchDeps {
  db: Db;
  mailboxes: readonly Mailbox[];
  fetch?: FetchFn;
  /** Where Learn's alerts and digest go; absent, they wait. */
  notifier?: Notifier;
  /** William's wall clock, for the 09:00 digest. */
  zone?: string;
  /** The portal's address, linked from an alert. */
  portal?: string | null;
  /** Mails a person their Learn digest, in a workspace that turned it on; absent, none goes. */
  send?: ((m: DigestMail) => Promise<void>) | null;
  /**
   * Renew an inbox's Gmail watch; when it lapses (ms), or null for one with no push
   * (designs/2026-10-06-mail-push.md). Absent: no push, the 15-minute poll.
   */
  watch?: (address: string) => Promise<number | null>;
  /** Embeds Learn's read items for search by meaning; absent, search is by words alone. */
  embed?: Embed | null;
}

/** `InboxPush` (channel-email) as far as the Monitor calls it. */
type InboxPush = {
  listen: (
    ctx: restate.ObjectContext,
    l: { service: string; key: string; until: number },
  ) => Promise<void>;
};

const untilKey = (address: string) => `watch until:${address.toLowerCase()}`;

/**
 * Each inbox's watch, renewed once under a day is left, and `InboxPush` told to wake this key on
 * its push. True when every inbox has a live one. A refusal waits for the next pass.
 */
async function keepWatches(
  ctx: restate.ObjectContext,
  deps: WatchDeps,
  now: number,
): Promise<boolean> {
  const watch = deps.watch;
  if (!watch || !deps.mailboxes.length) return false;
  let all = true;
  for (const box of deps.mailboxes) {
    const until = (await ctx.get<number>(untilKey(box.address))) ?? 0;
    if (until - now > DAY_MS) continue;
    const renewed = await ctx.run(`renew watch ${box.address}`, () =>
      watch(box.address).then(
        (next) => ({ next, error: null }),
        (e: unknown) => ({ next: null, error: e instanceof Error ? e.message : String(e) }),
      ),
    );
    if (renewed.error) ctx.console.warn(`gmail watch for ${box.address}: ${renewed.error}`);
    if (renewed.next === null) {
      if (until <= now) all = false;
      continue;
    }
    ctx.set(untilKey(box.address), renewed.next);
    ctx
      .objectSendClient<InboxPush>({ name: "InboxPush" }, box.address.toLowerCase())
      .listen({ service: "Watch", key: ctx.key, until: renewed.next });
  }
  return all;
}

type Stats = ReadStats & { feeds: PullStats };

export function makeWatch(deps: WatchDeps) {
  return makeLoopObject("Watch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const pushed = await keepWatches(ctx, deps, now.getTime());
    const outcome = (await runPass<Stats>(ctx, deps.db, now, {
      name: "read",
      ledger: { command: "watch read", argv: { daemon: true } },
      body: async () => ({
        ...(await readMail(deps.db, deps.mailboxes, now)),
        feeds: await pullFeeds(deps.db, deps.fetch ?? fetch, now),
      }),
      delayAfter: () => (pushed ? WATCH_NET_MS : WATCH_EVERY_MS),
      retryMs: WATCH_EVERY_MS,
    })) as PassOutcome<Stats>;
    const kept = outcome.stats?.kept ?? [];
    if (kept.length)
      spineEmit(ctx, {
        client: null,
        workflow: WATCH_FLOW,
        from: WATCH_FROM,
        events: kept.map(mailEvent),
      });
    const added = outcome.stats?.feeds?.added ?? [];
    if (added.length)
      spineEmit(ctx, {
        client: null,
        workflow: LEARN_FLOW,
        from: LEARN_FEEDS_FROM,
        events: added.map(itemEvent),
      });
    const w = wallClock(deps.zone ?? "America/Chicago", now);
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
    const failed = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
    // Every workspace's bell; what the hour's limit holds back rolls into each person's Today.
    await ctx.run("alert learn", () => alertLearn(deps.db, now).catch(failed));
    const embed = deps.embed;
    if (embed) await ctx.run("embed learn", () => embedMissing(deps.db, embed).catch(failed));
    const send = deps.send;
    if (send)
      await ctx.run("mail learn digests", () =>
        mailLearnDigests(deps.db, send, {
          now,
          today,
          hour: w.hour,
          portal: deps.portal ?? null,
        }).catch(failed),
      );
    const notifier = deps.notifier;
    if (notifier) {
      // A failed send is tried next pass; it never fails this one.
      await ctx.run("tell learn", () =>
        tellLearn(deps.db, notifier, {
          today,
          hour: w.hour,
          now,
          portal: deps.portal ?? null,
        }).catch(failed),
      );
    }
    return outcome;
  });
}

export type Watch = ReturnType<typeof makeWatch>;
