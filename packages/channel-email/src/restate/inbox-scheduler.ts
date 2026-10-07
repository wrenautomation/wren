/**
 * The inbox sync as a Virtual Object keyed by sender address: one key = one
 * mailbox = one loop. Each pass reads this inbox from its cursor forward and
 * acts on what came back; a pass that found human replies hands the fleet's
 * `Disposition` object a `classify` (when an LLM is configured), so the
 * operator's queue is labelled minutes after the reply lands rather than the
 * next time someone runs a command.
 *
 * A failed pass is asked again after one tick, not one sync interval (U-D10):
 * the cursor did not move, so nothing is skipped by asking soon — and not
 * sooner than a tick, so a mailbox that is down is asked once a minute rather
 * than as fast as it can refuse.
 *
 * A key's scope names the database its mailbox's replies land in and the
 * `Disposition` key that labels them: Wren's own, or its client's.
 *
 * Gmail push: each pass keeps the mailbox's `users.watch` alive, so a change
 * reaches `InboxPush/<address>/notify` (the phone Worker's `/webhooks/gmail`)
 * and runs a pass at once. While the watch lives, the loop polls only as a net.
 */
import * as restate from "@restatedev/restate-sdk";
import { type Notifier, plural } from "@wren/core/notify";
import {
  exclusiveHandler,
  makeLoopObject,
  NO_INPUT,
  runPass,
  sharedHandler,
  unitOfKey,
} from "@wren/core/restate";
import { type FireTriggers, replyFired } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import type { SharedSuppressions } from "../guards.js";
import { DAY_MS, type InboxReader, type SyncStats, syncInbox } from "../inbox/sync.js";
import type { Disposition } from "./disposition.js";

/** Where one key's replies land, and which `Disposition` key labels them. */
export interface InboxScope {
  db: Db;
  disposition: string;
  /** A client's mailbox: its opt-outs and bounces also land on main's list. */
  shared?: SharedSuppressions | null;
  /** Whose workflows a reply here may start: a client's id, null for Wren's. */
  client?: string | null;
}

export interface InboxSchedulerDeps {
  reader: InboxReader;
  /** From the key alone, so it needs no step: `acme/a@x.com` is acme's. */
  scopeOf: (key: string) => InboxScope;
  /** Between passes that returned (default 2 min). */
  syncMs?: number;
  /** After a pass that threw (default 1 min). */
  tickMs?: number;
  /** A mailbox's first sync reach (default 30 days). */
  firstSyncLookbackMs?: number;
  /** Classify after a pass that found replies. Off when no real LLM is configured. */
  classify?: boolean;
  /** Told the counts a pass found (replies; hard bounces and unsubscribes), never the text. */
  notifier?: Notifier;
  /**
   * Renew this mailbox's Gmail watch; when it lapses (ms), or null for a mailbox with
   * no push (IMAP). Unset = no push, the loop polls at `syncMs`.
   */
  watch?: (sender: string) => Promise<number | null>;
  /** Between passes while the watch is live: the net under the push (default 30 min). */
  netMs?: number;
  /** Each person's reply to the spine's Reply triggers (`spineFire`). Unset, none fire. */
  fire?: FireTriggers;
}

export const INBOX_SYNC_COMMAND = "outreach inbox sync";

export function makeInboxScheduler(deps: InboxSchedulerDeps) {
  const syncMs = deps.syncMs ?? 120_000;
  const tickMs = deps.tickMs ?? 60_000;
  const lookbackMs = deps.firstSyncLookbackMs ?? 30 * DAY_MS;
  const netMs = deps.netMs ?? 30 * 60_000;

  return makeLoopObject("InboxScheduler", async (ctx: restate.ObjectContext) => {
    const sender = unitOfKey(ctx.key);
    const scope = deps.scopeOf(ctx.key);
    const now = new Date(await ctx.date.now());
    const watched = deps.watch ? await keepWatch(ctx, deps.watch, sender, now.getTime()) : false;
    const outcome = await runPass<SyncStats>(ctx, scope.db, now, {
      name: "inbox sync",
      ledger: {
        command: INBOX_SYNC_COMMAND,
        argv: { daemon: true, senders: [sender], lookback_days: lookbackMs / DAY_MS },
      },
      body: (runId) =>
        syncInbox(scope.db, {
          reader: deps.reader,
          senders: [sender],
          now,
          runId,
          firstSyncLookbackMs: lookbackMs,
          shared: scope.shared ?? null,
        }),
      delayAfter: () => (watched ? netMs : syncMs),
      retryMs: tickMs,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    if (deps.classify && (outcome.stats?.replies ?? 0) > 0) {
      ctx.objectSendClient<Disposition>({ name: "Disposition" }, scope.disposition).classify();
    }
    if (deps.notifier && outcome.stats) await tell(ctx, deps.notifier, sender, outcome.stats);
    // Each person's reply: every live Reply trigger that hears email gets it.
    if (deps.fire)
      for (const id of outcome.stats?.replied ?? [])
        deps.fire(ctx, replyFired(scope.client ?? null, "email", id));
    return outcome;
  });
}

const WATCH_UNTIL = "watch until";
const LOOP_KEY = "loop key";

/** Gmail drops a watch after 7 days: renewed once under a day is left. True while one is live. */
async function keepWatch(
  ctx: restate.ObjectContext,
  watch: (sender: string) => Promise<number | null>,
  sender: string,
  now: number,
): Promise<boolean> {
  const until = (await ctx.get<number>(WATCH_UNTIL)) ?? 0;
  if (until - now > DAY_MS) return true;
  // A refusal is not retried here: the loop polls at its usual pace and the next pass asks again.
  const renewed = await ctx.run("renew watch", () =>
    watch(sender).then(
      (next) => ({ next, error: null }),
      (e: unknown) => ({ next: null, error: e instanceof Error ? e.message : String(e) }),
    ),
  );
  if (renewed.error) ctx.console.warn(`gmail watch for ${sender}: ${renewed.error}`);
  if (renewed.next === null) return until > now;
  ctx.set(WATCH_UNTIL, renewed.next);
  ctx.objectSendClient<InboxPush>({ name: "InboxPush" }, sender.toLowerCase()).claim(ctx.key);
  return true;
}

/** Another loop on the same mailbox's push: its object, key, and when its watch lapses (ms). */
export interface PushListener {
  service: string;
  key: string;
  until: number;
}

const LISTENERS = "listeners";
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<null>;
const LISTENER = z.object({
  service: z.string().min(1),
  key: z.string().min(1),
  until: z.number(),
});

/**
 * Gmail's push by address: Pub/Sub names the mailbox only, so its state holds the
 * `InboxScheduler` key that watches it (a client's is `<client>/<address>`), and any other
 * loop that listens (the Watch). Each is woken; a listener whose watch lapsed is skipped.
 */
export const inboxPush = restate.object({
  name: "InboxPush",
  handlers: {
    /** Set by that loop each time it renews the watch. */
    claim: exclusiveHandler(
      { ingressPrivate: true },
      async (ctx: restate.ObjectContext, key: string): Promise<void> => {
        ctx.set(LOOP_KEY, key);
      },
    ),
    /** Another loop object's `wake` on this mailbox's push, until its watch lapses. */
    listen: exclusiveHandler(
      { ingressPrivate: true, input: LISTENER },
      async (ctx: restate.ObjectContext, l: PushListener): Promise<void> => {
        const all = (await ctx.get<PushListener[]>(LISTENERS)) ?? [];
        const now = await ctx.date.now();
        ctx.set(LISTENERS, [
          ...all.filter((o) => o.until > now && !(o.service === l.service && o.key === l.key)),
          l,
        ]);
      },
    ),
    /** The mailbox changed: one pass now for each. Before any claim, the address is the key. */
    notify: sharedHandler(
      { input: NO_INPUT },
      async (ctx: restate.ObjectSharedContext): Promise<void> => {
        const loop = await ctx.get<string>(LOOP_KEY);
        const now = await ctx.date.now();
        const live = ((await ctx.get<PushListener[]>(LISTENERS)) ?? []).filter(
          (l) => l.until > now,
        );
        if (loop || !live.length)
          ctx.objectSendClient<InboxScheduler>({ name: "InboxScheduler" }, loop ?? ctx.key).sync();
        for (const l of live)
          ctx.genericSend({
            service: l.service,
            method: "wake",
            key: l.key,
            parameter: null,
            inputSerde: JSON_SERDE,
          });
      },
    ),
  },
});

export type InboxPush = typeof inboxPush;

/** A pointer to the mailbox, not a mirror of it: counts only, journaled so a replay stays quiet. */
async function tell(
  ctx: restate.ObjectContext,
  notifier: Notifier,
  sender: string,
  stats: SyncStats,
): Promise<void> {
  if (stats.replies > 0) {
    await ctx.run("notify replies", () =>
      notifier.notify(
        `${plural(stats.replies, "new reply", "new replies")} in ${sender}`,
        "conversations are human-owned: answer from the inbox",
        "action",
      ),
    );
  }
  if (stats.bounces_hard > 0 || stats.unsubscribes > 0) {
    await ctx.run("notify bounces", () =>
      notifier.notify(
        `${plural(stats.bounces_hard, "hard bounce")}, ${plural(stats.unsubscribes, "unsubscribe")} via ${sender}`,
        "suppressed and stopped by the sync; the kill switch pauses a domain at 2% bounces",
        "warning",
      ),
    );
  }
}

export type InboxScheduler = ReturnType<typeof makeInboxScheduler>;
