/**
 * Inbox placement: `PlacementScheduler/fleet` mails two copies from each ramped
 * inbox to every seed Gmail (`WREN_PLACEMENT_SEEDS`) once a send day, at the
 * window's open, through the inbox's own transport: a short personal note
 * (`plain`, tests the domain) and the newest opener (`real`, tests the copy).
 * Ramps not started yet are included, so warmup is measured too. The loop's
 * next pass, two hours on, asks each seed's Gmail (autobrowse's `gmail` site)
 * where its copy landed and what SPF, DKIM and DMARC said, then judges each
 * domain (`inbox/placement.ts`): a failing plain test pauses it, a passing one
 * lifts that pause. Never a lead row, a `messages` row or a send cap.
 * designs/2026-10-05-deliverability-tests.md.
 */
import type * as restate from "@restatedev/restate-sdk";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import { type Notifier, plural } from "@wren/core/notify";
import { errorText, makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
  evaluatePlacement,
  parseAuthResults,
  placementSummary,
  placementTrouble,
  placementVerdicts,
} from "../inbox/placement.js";
import {
  type AuthResults,
  enrollments,
  messages,
  type Placement,
  type ProbeKind,
  placementChecks,
} from "../schema.js";
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

/**
 * What a friend would send: short, no link, no pitch. One a day, the same from every
 * inbox, so the inboxes are compared on one text. Seeds only; never a lead.
 */
export const PLAIN_NOTES: readonly { subject: string; body: string }[] = [
  { subject: "sunday", body: "Hey, are you still on for Sunday? I can do any time after 2." },
  {
    subject: "that book",
    body: "Finally started the book you lent me. Two chapters in and hooked.",
  },
  { subject: "quick one", body: "Did you end up hearing back about the apartment?" },
  { subject: "lunch?", body: "Free for lunch Thursday? Same place as last time works for me." },
  {
    subject: "re: the trip",
    body: "I looked at flights. Friday morning looks cheapest, want me to hold two?",
  },
  { subject: "thanks again", body: "Thanks again for the help moving. Dinner is on me next week." },
  { subject: "game", body: "Are you watching the game tonight? Come over if you want." },
  { subject: "photos", body: "Found the old photos from the lake. I'll bring them Saturday." },
];

/** The day's note: `PLAIN_NOTES` in turn by fleet day. */
export function plainNote(day: string): { subject: string; body: string } {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  return PLAIN_NOTES[((n % PLAIN_NOTES.length) + PLAIN_NOTES.length) % PLAIN_NOTES.length] as {
    subject: string;
    body: string;
  };
}

export interface PlacementSchedulerDeps {
  db: Db;
  policy: SendPolicy;
  transport: Transport;
  /** Its `ramps` name the inboxes measured; `fromNames` what they send as. */
  fleet: Pick<Fleet, "ramps" | "fromNames">;
  /** Each inbox's roster niches (null = all): where its opener comes from before it has leads. */
  niches: Readonly<Record<string, readonly string[] | null>>;
  seeds: readonly string[];
  /** autobrowse's `sites` for this invocation. */
  sitesFor: (ctx: restate.Context) => SiteClient;
  /** Told when a domain is paused or lifted, or a test turns bad. */
  notifier?: Notifier;
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
  /** Domains paused and lifted by this pass's verdict. */
  paused: string[];
  lifted: string[];
  /** When the next pass is due. */
  next: string;
}

export interface Landing {
  landed: Placement;
  /** Null when there was no copy to read. */
  auth: AuthResults | null;
}

/** Gmail labels → where the copy landed. Spam outranks the Promotions tab, which outranks the inbox. */
export function landedFrom(labelIds: readonly string[]): Placement {
  if (labelIds.includes("SPAM")) return "spam";
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "promotions";
  // INBOX, or delivered and filed elsewhere (archived, trash): it was not held as spam.
  return "inbox";
}

/**
 * Where `messageId` landed in `seed`'s Gmail, spam and trash searched too, and the
 * receiver's SPF, DKIM and DMARC word from the topmost `Authentication-Results`
 * (Gmail's own; any below it came from relays).
 */
export async function landedAt(
  sites: SiteClient,
  seed: string,
  messageId: string,
): Promise<Landing> {
  const found = await sites.call<{ messages?: { id: string }[] }>(
    "gmail",
    "GET",
    "/gmail/v1/users/me/messages",
    { q: `rfc822msgid:${messageId.replace(/^<|>$/g, "")}`, includeSpamTrash: "true" },
    seed,
  );
  const id = found?.messages?.[0]?.id;
  if (!id) return { landed: "missing", auth: null };
  const message = await sites.call<{
    labelIds?: string[];
    payload?: { headers?: { name: string; value: string }[] };
  }>(
    "gmail",
    "GET",
    `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
    { format: "metadata" },
    seed,
  );
  const header = message?.payload?.headers?.find(
    (h) => h.name.toLowerCase() === "authentication-results",
  );
  return { landed: landedFrom(message?.labelIds ?? []), auth: parseAuthResults(header?.value) };
}

/**
 * The sender's newest composed opener, as its lead gets it (sign-off already in the body).
 * An inbox still in warmup has no leads, so it borrows the newest in its niches.
 */
async function newestOpener(
  db: Db,
  sender: string,
  niches: readonly string[] | null,
): Promise<{ subject: string | null; body: string } | null> {
  const newest = async (whose: SQL | undefined) => {
    const [row] = await db
      .select({ subject: messages.subject, body: messages.body })
      .from(messages)
      .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
      .where(and(whose, eq(messages.step, 0), inArray(messages.state, COMPOSED)))
      .orderBy(desc(messages.id))
      .limit(1);
    return row ?? null;
  };
  return (
    (await newest(eq(enrollments.sender, sender))) ??
    (niches?.length === 0
      ? null
      : await newest(niches ? inArray(enrollments.niche, niches) : undefined))
  );
}

/**
 * Today's seed copies, a plain note and the opener per ramped inbox and seed. Each row
 * is claimed before its send, so a retried pass finds it and sends nothing: a crash
 * in between loses that day's check, never sends twice. An inbox with no opener yet
 * still sends its plain note.
 */
export async function sendPlacements(
  deps: Omit<PlacementSchedulerDeps, "sitesFor">,
  now: Date,
): Promise<Pick<PlacementStats, "sent" | "noDraft" | "failed">> {
  const day = deps.policy.localDay(now).toString();
  const stats = { sent: 0, noDraft: [] as string[], failed: 0 };
  if (deps.seeds.length === 0) return stats;
  const note = plainNote(day);
  for (const sender of Object.keys(deps.fleet.ramps ?? {})) {
    const fromName = deps.fleet.fromNames[sender] ?? null;
    const opener = await newestOpener(deps.db, sender, deps.niches[sender] ?? null);
    if (!opener) stats.noDraft.push(sender);
    const copies: { kind: ProbeKind; subject: string | null; body: string | null }[] = [
      {
        kind: "plain",
        subject: note.subject,
        body: fromName ? `${note.body}\n\n${fromName.split(/\s+/)[0]}` : note.body,
      },
      {
        kind: "real",
        subject: opener?.subject ?? null,
        body: opener ? fillCallTimes(opener.body, null, null, now).body : null,
      },
    ];
    for (const seed of deps.seeds)
      for (const copy of copies) {
        const messageId = mintMessageId(sender);
        const [claimed] = await deps.db
          .insert(placementChecks)
          .values({
            sender,
            seed,
            day,
            kind: copy.kind,
            ...(copy.body !== null ? { messageId } : { detail: NO_DRAFT }),
          })
          .onConflictDoNothing()
          .returning();
        if (!claimed || copy.body === null) continue;
        const row = and(
          eq(placementChecks.sender, sender),
          eq(placementChecks.seed, seed),
          eq(placementChecks.day, day),
          eq(placementChecks.kind, copy.kind),
        );
        try {
          await carrierOf(deps.transport, sender).send({
            fromAddress: sender,
            fromName,
            to: seed,
            subject: copy.subject,
            replySubject: null,
            body: copy.body,
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
    SELECT sender, seed, day::text AS day, kind, message_id AS "messageId"
    FROM placement_checks
    WHERE checked_at IS NULL AND sent_at IS NOT NULL
      AND sent_at <= ${new Date(now.getTime() - CHECK_AFTER_MS).toISOString()}
      AND sent_at > ${new Date(now.getTime() - DAY_MS).toISOString()}
    ORDER BY sent_at, sender, seed, kind
  `)) as unknown as {
    sender: string;
    seed: string;
    day: string;
    kind: ProbeKind;
    messageId: string;
  }[];
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

/** One digest line per sending domain, and the warnings it stands on. */
export async function placementLines(
  db: Db,
  senders: readonly string[],
  now: Date,
): Promise<{ lines: string[]; trouble: string[] }> {
  const verdicts = await placementVerdicts(db, { now, senders });
  return {
    lines: verdicts.map(placementSummary),
    trouble: verdicts.flatMap((d) => placementTrouble(d, now)),
  };
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
        eq(placementChecks.kind, c.kind),
      );
      try {
        const { landed, auth } = await landedAt(sites, c.seed, c.messageId);
        await ctx.run(`landed ${c.sender} ${c.seed} ${c.kind}`, async () => {
          await deps.db.update(placementChecks).set({ landed, auth, checkedAt: now }).where(where);
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
        await ctx.run(`refused ${c.sender} ${c.seed} ${c.kind}`, async () => {
          await deps.db
            .update(placementChecks)
            .set({ checkedAt: now, detail: "check refused" })
            .where(where);
        });
      }
    }
    const senders = Object.keys(deps.fleet.ramps ?? {});
    // Judged only when something new landed: the same rows give the same verdict.
    const changes =
      checked > 0
        ? await ctx.run("verdict", async () => {
            const c = await evaluatePlacement(deps.db, { now, senders });
            const domains = (rows: { domain: string }[]) => [...new Set(rows.map((r) => r.domain))];
            return {
              paused: domains(c.paused),
              lifted: domains(c.lifted),
              trouble: c.verdicts.flatMap((d) => placementTrouble(d, now)),
            };
          })
        : { paused: [], lifted: [], trouble: [] };
    const notifier = deps.notifier;
    if (notifier && changes.paused.length + changes.lifted.length > 0) {
      await ctx.run("notify placement", () =>
        notifier.notify(
          `placement ${[
            changes.paused.length ? `paused ${plural(changes.paused.length, "domain")}` : "",
            changes.lifted.length ? `lifted ${plural(changes.lifted.length, "domain")}` : "",
          ]
            .filter(Boolean)
            .join(", ")}`,
          [
            ...changes.paused.map(
              (d) => `paused ${d}: cold sends stop, warmup and seed copies go on`,
            ),
            ...changes.lifted.map((d) => `lifted ${d}: plain notes land again`),
            ...changes.trouble,
          ].join("\n"),
          "warning",
        ),
      );
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
        return {
          ...sent,
          checked,
          refused,
          retrying,
          paused: changes.paused,
          lifted: changes.lifted,
          next: new Date(next).toISOString(),
        };
      },
      delayAfter: (s) => new Date(s.next).getTime() - now.getTime(),
      retryMs: CHECK_RETRY_MS,
    });
  });
}

export type PlacementScheduler = ReturnType<typeof makePlacementScheduler>;
