/**
 * What the seed copies say about each sending domain, and the pause that follows
 * (designs/2026-10-05-deliverability-tests.md). Three tests, each ruling out one cause:
 * setup (the receiver's SPF, DKIM and DMARC word on every copy), plain (a personal
 * note: the domain's reputation) and real (the newest opener: the copy).
 *
 * **Why plain decides the pause.** A plain note in spam means the domain is burned
 * whatever the copy says; a pause plus warmup is the cure. A real copy in spam while
 * the plain one lands is the copy's fault, and pausing the domain fixes nothing, so
 * that is a warning only.
 *
 * **Why a placement pause lifts itself.** The evidence that set it is measured again
 * every send day, from copies sent after the pause. Bounces and complaints are not:
 * those pauses stay a human's to lift (`health.ts`).
 */
import type { Db, Queryable } from "@wren/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  type AuthResults,
  type Placement,
  type ProbeKind,
  placementChecks,
  type SenderPause,
  senderPauses,
} from "../schema.js";
import { activePauses, domainOf } from "./health.js";

/** At or above this inbox share a test passes. */
export const HEALTHY_RATE = 0.8;
/** Fewer landed copies than this, and a test says nothing yet. */
export const MIN_LANDED = 6;
/** A domain's verdict reads its last this-many send days with a landing. */
export const WINDOW_DAYS = 2;
/** A placement pause stands at least this long, so warmup has time to work. */
export const MIN_PAUSE_DAYS = 7;
/** Still failing after this long paused: the warning says to think about a new domain. */
export const REPLACE_AFTER_DAYS = 14;
/** How far back the verdict reads at all. */
const LOOKBACK_DAYS = 21;
const DAY_MS = 86_400_000;

const AUTH_CHECKS = ["spf", "dkim", "dmarc"] as const;

/** The first verdict per check in an `Authentication-Results` value; null when a check is absent. */
export function parseAuthResults(header: string | null | undefined): AuthResults {
  const of = (check: string) =>
    header?.match(new RegExp(`(?:^|[;\\s])${check}=([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  return { spf: of("spf"), dkim: of("dkim"), dmarc: of("dmarc") };
}

/** The checks that did not pass, as `dkim=fail`; a missing check counts. */
export function authFailures(auth: AuthResults): string[] {
  return AUTH_CHECKS.flatMap((c) => (auth[c] === "pass" ? [] : [`${c}=${auth[c] ?? "none"}`]));
}

export interface Tally {
  inbox: number;
  landed: number;
}

export type PlacementVerdict = "healthy" | "domain problem" | "copy problem" | "not enough";

export interface DomainPlacement {
  domain: string;
  senders: string[];
  plain: Tally;
  real: Tally;
  /** One line per copy the receiver did not fully authenticate: `a@x.com: dkim=fail`. */
  auth: string[];
  verdict: PlacementVerdict;
  /** The active placement pause's start, when there is one. */
  pausedAt: Date | null;
}

const passes = (t: Tally) => t.landed >= MIN_LANDED && t.inbox / t.landed >= HEALTHY_RATE;
const fails = (t: Tally) => t.landed >= MIN_LANDED && t.inbox / t.landed < HEALTHY_RATE;

export function verdictOf(plain: Tally, real: Tally): PlacementVerdict {
  if (fails(plain)) return "domain problem";
  if (!passes(plain)) return "not enough";
  if (fails(real)) return "copy problem";
  return "healthy";
}

const pct = (t: Tally) => `${t.inbox}/${t.landed} = ${Math.round((t.inbox / t.landed) * 100)}%`;
export const tallyText = (t: Tally) => (t.landed === 0 ? "none yet" : `${t.inbox}/${t.landed}`);

/** `wren-automations.com: setup ok · plain 8/9 · real 7/9`, plus the verdict when not healthy. */
export function placementSummary(d: DomainPlacement): string {
  const setup = d.auth.length === 0 ? "setup ok" : `setup ${d.auth.length} failing`;
  const tail = d.pausedAt !== null ? " · paused" : d.verdict === "healthy" ? "" : ` · ${d.verdict}`;
  return `${d.domain}: ${setup} · plain ${tallyText(d.plain)} · real ${tallyText(d.real)}${tail}`;
}

/** The warnings a domain stands on today: auth failures, copy in spam, a pause that is not healing. */
export function placementTrouble(d: DomainPlacement, now: Date): string[] {
  const out = d.auth.map((a) => `${d.domain} setup: ${a}`);
  if (d.verdict === "copy problem")
    out.push(
      `${d.domain}: the opener lands ${pct(d.real)} inbox while plain notes land ${pct(d.plain)}; the copy is the problem`,
    );
  if (d.verdict === "domain problem")
    out.push(`${d.domain}: plain notes land ${pct(d.plain)} inbox; cold sends paused, warmup only`);
  if (
    d.pausedAt &&
    d.verdict !== "healthy" &&
    now.getTime() - d.pausedAt.getTime() >= REPLACE_AFTER_DAYS * DAY_MS
  )
    out.push(
      `${d.domain}: still failing after ${REPLACE_AFTER_DAYS} days paused; consider a new domain`,
    );
  return out;
}

interface Row {
  sender: string;
  seed: string;
  day: string;
  kind: ProbeKind;
  landed: Placement;
  auth: AuthResults | null;
  sentAt: Date | null;
}

/**
 * Each domain's verdict over its last `WINDOW_DAYS` send days with a landing. While a
 * placement pause stands, only copies sent after it count: the pause is judged on
 * what warmup did, not on what set it.
 */
export async function placementVerdicts(
  db: Queryable,
  opts: { now: Date; senders: readonly string[] },
): Promise<DomainPlacement[]> {
  const senders = [...new Set(opts.senders.map((s) => s.trim().toLowerCase()))];
  if (senders.length === 0) return [];
  const since = new Date(opts.now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const rows = (
    await db
      .select({
        sender: placementChecks.sender,
        seed: placementChecks.seed,
        day: placementChecks.day,
        kind: placementChecks.kind,
        landed: placementChecks.landed,
        auth: placementChecks.auth,
        sentAt: placementChecks.sentAt,
      })
      .from(placementChecks)
      .where(inArray(placementChecks.sender, senders))
  ).filter((r): r is Row => r.landed !== null && r.day >= since);
  const paused = await activePauses(db);
  const byDomain = new Map<string, string[]>();
  for (const s of senders) byDomain.set(domainOf(s), [...(byDomain.get(domainOf(s)) ?? []), s]);
  return [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, on]) => {
      const pauses = on.flatMap((s) => {
        const p = paused.get(s);
        return p?.source === "placement" ? [p.pausedAt] : [];
      });
      const pausedAt = pauses.length ? new Date(Math.min(...pauses.map((d) => d.getTime()))) : null;
      const mine = rows.filter(
        (r) =>
          on.includes(r.sender) &&
          (pausedAt === null || (r.sentAt !== null && r.sentAt > pausedAt)),
      );
      const days = [...new Set(mine.map((r) => r.day))].sort().reverse().slice(0, WINDOW_DAYS);
      const window = mine.filter((r) => days.includes(r.day));
      const tally = (kind: ProbeKind): Tally => {
        const of = window.filter((r) => r.kind === kind);
        return { inbox: of.filter((r) => r.landed === "inbox").length, landed: of.length };
      };
      const plain = tally("plain");
      const real = tally("real");
      const latest = days[0];
      const auth = window
        .filter((r) => r.day === latest && r.auth !== null)
        .flatMap((r) => {
          const bad = authFailures(r.auth as AuthResults);
          return bad.length ? [`${r.sender} (${r.kind}): ${bad.join(" ")}`] : [];
        });
      return {
        domain,
        senders: on,
        plain,
        real,
        auth: [...new Set(auth)].sort(),
        verdict: verdictOf(plain, real),
        pausedAt,
      };
    });
}

export interface PlacementChanges {
  paused: SenderPause[];
  lifted: SenderPause[];
  verdicts: DomainPlacement[];
}

/**
 * Pause every inbox on a domain whose plain notes fail; lift a placement pause that has
 * stood `MIN_PAUSE_DAYS` and whose plain notes pass again. Idempotent: a domain
 * already paused (by anything) writes nothing, and a healthy unpaused one neither.
 */
export async function evaluatePlacement(
  db: Db,
  opts: { now: Date; senders: readonly string[] },
): Promise<PlacementChanges> {
  const verdicts = await placementVerdicts(db, opts);
  const active = await activePauses(db);
  const paused: SenderPause[] = [];
  const lifted: SenderPause[] = [];
  for (const d of verdicts) {
    if (d.verdict === "domain problem" && d.pausedAt === null) {
      const fresh = d.senders.filter((s) => !active.has(s));
      if (!fresh.length) continue;
      const reason = `plain test inbox ${pct(d.plain)} < ${HEALTHY_RATE * 100}% over ${WINDOW_DAYS} d`;
      paused.push(
        ...(await db
          .insert(senderPauses)
          .values(
            fresh.map((sender) => ({
              sender,
              domain: d.domain,
              reason,
              source: "placement" as const,
              pausedAt: opts.now,
              detail: { plain: d.plain, real: d.real },
            })),
          )
          .returning()),
      );
    }
    const stood =
      d.pausedAt && opts.now.getTime() - d.pausedAt.getTime() >= MIN_PAUSE_DAYS * DAY_MS;
    if (stood && passes(d.plain)) {
      lifted.push(
        ...(await db
          .update(senderPauses)
          .set({ liftedAt: opts.now, liftedBy: "placement" })
          .where(
            and(
              inArray(senderPauses.sender, d.senders),
              eq(senderPauses.source, "placement"),
              isNull(senderPauses.liftedAt),
            ),
          )
          .returning()),
      );
    }
  }
  return { paused, lifted, verdicts };
}
