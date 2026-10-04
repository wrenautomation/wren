/**
 * Inbox placement: `PlacementScheduler/fleet` mails each ramped inbox's newest
 * opener to every seed Gmail (`WREN_PLACEMENT_SEEDS`) once a send day, at the
 * window's open, through the inbox's own transport; ramps not started yet
 * included, so warmup is measured too. The loop's next pass, two hours on,
 * asks each seed's Gmail (autobrowse's `gmail` site) where its copy landed.
 * Never a lead row, a `messages` row or a send cap. The morning digest says
 * it per inbox and warns on spam or missing.
 */
import type * as restate from "@restatedev/restate-sdk";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { enrollments, messages, type Placement, placementChecks } from "../schema.js";
import { fillCallTimes } from "../send/call-times.js";
import { mintMessageId } from "../send/deliver.js";
import type { SendPolicy } from "../send/policy.js";
import type { Fleet } from "../send/tick.js";
import {
  carrierOf,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "../send/transport.js";

export const PLACEMENT_KEY = "fleet";
export const PLACEMENT_COMMAND = "placement";
export const NO_DRAFT = "no draft yet";
/** How long a copy gets to land before its seed is asked. */
export const CHECK_AFTER_MS = 2 * 3600_000;
/** A check that failed (not a refusal) is asked again this much later, for a day at most. */
const CHECK_RETRY_MS = 30 * 60_000;
const DAY_MS = 24 * 3600_000;
/** Openers a lead got or will get; a rejected one is not the campaign's copy. */
const COMPOSED = ["draft", "approved", "sending", "sent"] as const;

export interface PlacementSchedulerDeps {
  db: Db;
  policy: SendPolicy;
  transport: Transport;
  /** Its `ramps` name the inboxes measured; `fromNames` what they send as. */
  fleet: Pick<Fleet, "ramps" | "fromNames">;
  seeds: readonly string[];
  /** autobrowse's `sites` for this invocation. */
  sitesFor: (ctx: restate.Context) => SiteClient;
}

export interface PlacementStats {
  sent: number;
  noDraft: string[];
  failed: number;
  checked: number;
  /** Checks a seed's Gmail refused (4xx): nothing recorded but why. */
  refused: string[];
  /** Checks that failed otherwise: asked again on a later pass. */
  retrying: number;
  /** When the next pass is due. */
  next: string;
}

/** Gmail labels → where the copy landed. Spam outranks the Promotions tab, which outranks the inbox. */
export function landedFrom(labelIds: readonly string[]): Placement {
  if (labelIds.includes("SPAM")) return "spam";
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "promotions";
  // INBOX, or delivered and filed elsewhere (archived, trash): it was not held as spam.
  return "inbox";
}

/** Where `messageId` landed in `seed`'s Gmail, spam and trash searched too. */
export async function landedAt(
  sites: SiteClient,
  seed: string,
  messageId: string,
): Promise<Placement> {
  const found = await sites.call<{ messages?: { id: string }[] }>(
    "gmail",
    "GET",
    "/gmail/v1/users/me/messages",
    { q: `rfc822msgid:${messageId.replace(/^<|>$/g, "")}`, includeSpamTrash: "true" },
    seed,
  );
  const id = found?.messages?.[0]?.id;
  if (!id) return "missing";
  const message = await sites.call<{ labelIds?: string[] }>(
    "gmail",
    "GET",
    `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
    { format: "minimal" },
    seed,
  );
  return landedFrom(message?.labelIds ?? []);
}

/** The sender's newest composed opener, as its lead gets it (sign-off already in the body). */
async function newestOpener(
  db: Db,
  sender: string,
): Promise<{ subject: string | null; body: string } | null> {
  const [row] = await db
    .select({ subject: messages.subject, body: messages.body })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(eq(enrollments.sender, sender), eq(messages.step, 0), inArray(messages.state, COMPOSED)),
    )
    .orderBy(desc(messages.id))
    .limit(1);
  return row ?? null;
}

/**
 * Today's seed copies, one per ramped inbox and seed. Each row is claimed before its
 * send, so a retried pass finds it and sends nothing: a crash in between loses
 * that day's check, never sends twice.
 */
export async function sendPlacements(
  deps: Omit<PlacementSchedulerDeps, "sitesFor">,
  now: Date,
): Promise<Pick<PlacementStats, "sent" | "noDraft" | "failed">> {
  const day = deps.policy.localDay(now).toString();
  const stats = { sent: 0, noDraft: [] as string[], failed: 0 };
  if (deps.seeds.length === 0) return stats;
  for (const sender of Object.keys(deps.fleet.ramps ?? {})) {
    const draft = await newestOpener(deps.db, sender);
    if (!draft) stats.noDraft.push(sender);
    for (const seed of deps.seeds) {
      const messageId = mintMessageId(sender);
      const [claimed] = await deps.db
        .insert(placementChecks)
        .values({ sender, seed, day, ...(draft ? { messageId } : { detail: NO_DRAFT }) })
        .onConflictDoNothing()
        .returning();
      if (!claimed || !draft) continue;
      const row = and(
        eq(placementChecks.sender, sender),
        eq(placementChecks.seed, seed),
        eq(placementChecks.day, day),
      );
      try {
        await carrierOf(deps.transport, sender).send({
          fromAddress: sender,
          fromName: deps.fleet.fromNames[sender] ?? null,
          to: seed,
          subject: draft.subject,
          replySubject: null,
          body: fillCallTimes(draft.body, null, null, now).body,
          messageId,
        });
        await deps.db.update(placementChecks).set({ sentAt: now }).where(row);
        stats.sent += 1;
      } catch (err) {
        if (!(err instanceof TransportRefused || err instanceof TransportAmbiguous)) throw err;
        await deps.db.update(placementChecks).set({ detail: "send failed" }).where(row);
        stats.failed += 1;
      }
    }
  }
  return stats;
}

/** Copies sent at least `CHECK_AFTER_MS` ago and not yet read, from the last day. */
async function dueChecks(db: Db, now: Date) {
  const rows = (await db.execute(sql`
    SELECT sender, seed, day::text AS day, message_id AS "messageId"
    FROM placement_checks
    WHERE checked_at IS NULL AND sent_at IS NOT NULL
      AND sent_at <= ${new Date(now.getTime() - CHECK_AFTER_MS).toISOString()}
      AND sent_at > ${new Date(now.getTime() - DAY_MS).toISOString()}
    ORDER BY sent_at, sender, seed
  `)) as unknown as { sender: string; seed: string; day: string; messageId: string }[];
  return rows;
}

/** The earliest unread copy's due time within the last day, or null. */
async function nextDue(db: Db, now: Date): Promise<Date | null> {
  const [row] = (await db.execute(sql`
    SELECT min(sent_at) AS at FROM placement_checks
    WHERE checked_at IS NULL AND sent_at > ${new Date(now.getTime() - DAY_MS).toISOString()}
  `)) as unknown as { at: Date | string | null }[];
  return row?.at ? new Date(new Date(row.at).getTime() + CHECK_AFTER_MS) : null;
}

/** One digest line per inbox from its latest day of checks: `a@x: inbox 1/2, spam 1`. */
export function placementLine(
  sender: string,
  rows: readonly { landed: Placement | null; detail: string | null }[],
): string {
  const count = (l: Placement) => rows.filter((r) => r.landed === l).length;
  if (rows.every((r) => r.landed === null))
    return `${sender}: ${rows.find((r) => r.detail)?.detail ?? "not checked yet"}`;
  const rest = (["promotions", "spam", "missing"] as const)
    .filter((l) => count(l) > 0)
    .map((l) => `, ${l} ${count(l)}`)
    .join("");
  return `${sender}: inbox ${count("inbox")}/${rows.length}${rest}`;
}

/** Each inbox's line, and those with a copy in spam or missing. */
export async function placementLines(
  db: Db,
  senders: readonly string[],
): Promise<{ lines: string[]; trouble: string[] }> {
  const rows = (await db.execute(sql`
    SELECT p.sender, p.landed, p.detail FROM placement_checks p
    WHERE p.day = (SELECT max(q.day) FROM placement_checks q WHERE q.sender = p.sender)
  `)) as unknown as { sender: string; landed: Placement | null; detail: string | null }[];
  const out = senders.map((s) => {
    const mine = rows.filter((r) => r.sender === s);
    return {
      line: placementLine(s, mine),
      bad: mine.some((r) => r.landed === "spam" || r.landed === "missing"),
    };
  });
  return { lines: out.map((o) => o.line), trouble: out.filter((o) => o.bad).map((o) => o.line) };
}

export function makePlacementScheduler(deps: PlacementSchedulerDeps) {
  return makeLoopObject("PlacementScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    // The checks call `sites` from the handler, outside any step; each answer is journaled.
    const sites = deps.sitesFor(ctx);
    const due = await ctx.run("due checks", () => dueChecks(deps.db, now));
    let checked = 0;
    let retrying = 0;
    const refused: string[] = [];
    for (const c of due) {
      const where = and(
        eq(placementChecks.sender, c.sender),
        eq(placementChecks.seed, c.seed),
        eq(placementChecks.day, c.day),
      );
      try {
        const landed = await landedAt(sites, c.seed, c.messageId);
        await ctx.run(`landed ${c.sender} ${c.seed}`, async () => {
          await deps.db.update(placementChecks).set({ landed, checkedAt: now }).where(where);
        });
        checked += 1;
      } catch (err) {
        if (!(err instanceof SiteCallError)) throw err;
        // A refusal will say the same tomorrow: no landing, just why. Anything else asks again.
        if (!isRefusal(err)) {
          retrying += 1;
          continue;
        }
        refused.push(errorText(err));
        await ctx.run(`refused ${c.sender} ${c.seed}`, async () => {
          await deps.db
            .update(placementChecks)
            .set({ checkedAt: now, detail: "check refused" })
            .where(where);
        });
      }
    }
    return runPass<PlacementStats>(ctx, deps.db, now, {
      name: "placement",
      ledger: { command: PLACEMENT_COMMAND, argv: { daemon: true } },
      body: async () => {
        const open = deps.policy.windowOpen(now);
        const sent = open ? await sendPlacements(deps, now) : { sent: 0, noDraft: [], failed: 0 };
        // Today's copies went at the open; tomorrow's go at the next one.
        let next = deps.policy
          .nextWindowOpen(open ? deps.policy.localDayBounds(now)[1] : now)
          .getTime();
        const check = await nextDue(deps.db, now);
        if (check) next = Math.min(next, Math.max(check.getTime(), now.getTime() + CHECK_RETRY_MS));
        return { ...sent, checked, refused, retrying, next: new Date(next).toISOString() };
      },
      delayAfter: (s) => new Date(s.next).getTime() - now.getTime(),
      retryMs: CHECK_RETRY_MS,
    });
  });
}

export type PlacementScheduler = ReturnType<typeof makePlacementScheduler>;
