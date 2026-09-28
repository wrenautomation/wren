/**
 * When the harness may send, and how far apart (C-D2).
 *
 * The pure half of the tick: a frozen `SendPolicy`, parsed once from
 * settings, that answers clock questions and nothing else. It reads no
 * database, holds no counters, and never decides *which* message goes; the
 * walk in `deliver.ts` does that with the outbox in front of it.
 *
 * Caps are per inbox because reputation is earned per sending address. The
 * one fleet-wide number is `newOpenersPerDay`, a brake on new conversations;
 * 0 means follow-ups only (threads already open finish, none start).
 * The ramp is data: `from + step × (send days elapsed ÷ every)`, never above
 * the ceiling, counted in the schedule's own days. Every window question is
 * answered on the operator's local clock and returned as a UTC instant.
 */
import { ENV_KEYS } from "@wren/config";
import { type ClockTime, formatClock, minutesOfDay, PlainDate } from "./dates.js";
import type { Rng } from "./rng.js";
import { assertInstant, canonicalZone, wallClock, zonedInstant } from "./tz.js";

/** An instant every real clock is already past: what an inbox that never sent owes. */
export const EPOCH = new Date(0);

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_INDEX = new Map<string, number>();
DAY_NAMES.forEach((name, i) => {
  DAY_INDEX.set(name, i);
  DAY_INDEX.set(name.slice(0, 3), i);
});
const ABBREVIATIONS = DAY_NAMES.map((n) => n[0]?.toUpperCase() + n.slice(1, 3));

// Strict on purpose: "08", "08:00:30" and offsets are refused, since a schedule
// that silently means something other than what was typed is worse than a
// startup error.
const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** The settings block `SendPolicy` parses; `@wren/config` `Settings` satisfies it. */
export interface SendPolicySettings {
  readonly sendTimezone: string;
  readonly sendDays: string;
  readonly sendWindowStart: string;
  readonly sendWindowEnd: string;
  readonly sendLeadWindowStart?: string | undefined;
  readonly sendLeadWindowEnd?: string | undefined;
  readonly coldSendsPerInboxPerDay: number;
  readonly coldSendsRampStart?: string | undefined;
  readonly coldSendsRampFrom: number;
  readonly coldSendsRampStep: number;
  readonly coldSendsRampEveryDays: number;
  readonly sendGapMinMinutes: number;
  readonly sendGapMaxMinutes: number;
  readonly newOpenersPerDay?: number | undefined;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMinutes: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowDays: number;
}

export interface SendPolicyFields {
  readonly timezone: string; // canonical IANA name
  readonly days: ReadonlySet<number>; // 0 = Monday … 6 = Sunday
  readonly windowStart: ClockTime; // inclusive
  readonly windowEnd: ClockTime; // exclusive
  readonly leadWindowStart: ClockTime | null;
  readonly leadWindowEnd: ClockTime | null;
  readonly perInboxCeiling: number;
  readonly rampStart: PlainDate | null;
  readonly rampFrom: number;
  readonly rampStep: number;
  readonly rampEverySendDays: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly newOpenersPerDay: number | null;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMs: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowMs: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The parsed send schedule and pacing limits. Built once at startup, frozen. */
export class SendPolicy implements SendPolicyFields {
  readonly timezone: string;
  readonly days: ReadonlySet<number>;
  readonly windowStart: ClockTime;
  readonly windowEnd: ClockTime;
  readonly leadWindowStart: ClockTime | null;
  readonly leadWindowEnd: ClockTime | null;
  readonly perInboxCeiling: number;
  readonly rampStart: PlainDate | null;
  readonly rampFrom: number;
  readonly rampStep: number;
  readonly rampEverySendDays: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly newOpenersPerDay: number | null;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMs: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowMs: number;

  constructor(fields: SendPolicyFields) {
    this.timezone = fields.timezone;
    this.days = new Set(fields.days);
    this.windowStart = fields.windowStart;
    this.windowEnd = fields.windowEnd;
    this.leadWindowStart = fields.leadWindowStart;
    this.leadWindowEnd = fields.leadWindowEnd;
    this.perInboxCeiling = fields.perInboxCeiling;
    this.rampStart = fields.rampStart;
    this.rampFrom = fields.rampFrom;
    this.rampStep = fields.rampStep;
    this.rampEverySendDays = fields.rampEverySendDays;
    this.gapMinMs = fields.gapMinMs;
    this.gapMaxMs = fields.gapMaxMs;
    this.newOpenersPerDay = fields.newOpenersPerDay;
    this.resendCooldownDays = fields.resendCooldownDays;
    this.reconcileGraceMs = fields.reconcileGraceMs;
    this.bouncePauseRate = fields.bouncePauseRate;
    this.bouncePauseMinBounces = fields.bouncePauseMinBounces;
    this.healthWindowMs = fields.healthWindowMs;
    Object.freeze(this);
  }

  /**
   * Parse the `WREN_SEND_*` block, or throw a loud Error. The composition
   * root builds this once, at startup, so a schedule typo stops the process
   * before a run row opens, never at the moment a message would have gone out.
   */
  static fromSettings(s: SendPolicySettings): SendPolicy {
    const timezone = parseTimezone(s.sendTimezone);
    const days = parseDays(s.sendDays);
    const windowStart = parseTime(s.sendWindowStart, ENV_KEYS.sendWindowStart);
    const windowEnd = parseTime(s.sendWindowEnd, ENV_KEYS.sendWindowEnd);
    const [leadWindowStart, leadWindowEnd] = parseLeadWindow(s);
    if (minutesOfDay(windowEnd) <= minutesOfDay(windowStart)) {
      throw new Error(
        `${ENV_KEYS.sendWindowEnd} (${formatClock(windowEnd)}) must be after ` +
          `${ENV_KEYS.sendWindowStart} (${formatClock(windowStart)})`,
      );
    }
    if (s.coldSendsPerInboxPerDay < 1) {
      throw new Error(
        `${ENV_KEYS.coldSendsPerInboxPerDay} must be at least 1, got ${s.coldSendsPerInboxPerDay}`,
      );
    }
    for (const [key, value] of [
      [ENV_KEYS.coldSendsRampFrom, s.coldSendsRampFrom],
      [ENV_KEYS.coldSendsRampStep, s.coldSendsRampStep],
      [ENV_KEYS.coldSendsRampEveryDays, s.coldSendsRampEveryDays],
    ] as const) {
      if (value < 1) throw new Error(`${key} must be at least 1, got ${value}`);
    }
    const rampStart =
      s.coldSendsRampStart === undefined ? null : parseRampStart(s.coldSendsRampStart);
    if (rampStart !== null && s.coldSendsRampFrom > s.coldSendsPerInboxPerDay) {
      throw new Error(
        `${ENV_KEYS.coldSendsRampFrom} (${s.coldSendsRampFrom}) must not exceed ` +
          `${ENV_KEYS.coldSendsPerInboxPerDay} (${s.coldSendsPerInboxPerDay}), ` +
          "the ceiling the ramp climbs to",
      );
    }
    if (s.sendGapMinMinutes < 0) {
      throw new Error(
        `${ENV_KEYS.sendGapMinMinutes} must not be negative, got ${s.sendGapMinMinutes}`,
      );
    }
    if (s.sendGapMaxMinutes < s.sendGapMinMinutes) {
      throw new Error(
        `${ENV_KEYS.sendGapMaxMinutes} (${s.sendGapMaxMinutes}) must not be below ` +
          `${ENV_KEYS.sendGapMinMinutes} (${s.sendGapMinMinutes})`,
      );
    }
    if (s.newOpenersPerDay !== undefined && s.newOpenersPerDay < 0) {
      throw new Error(
        `${ENV_KEYS.newOpenersPerDay} must not be negative (unset = unlimited, ` +
          `0 = follow-ups only), got ${s.newOpenersPerDay}`,
      );
    }
    if (s.resendCooldownDays < 0) {
      throw new Error(
        `${ENV_KEYS.resendCooldownDays} must not be negative, got ${s.resendCooldownDays}`,
      );
    }
    if (s.reconcileGraceMinutes < 0) {
      throw new Error(
        `${ENV_KEYS.reconcileGraceMinutes} must not be negative, got ${s.reconcileGraceMinutes}`,
      );
    }
    if (!(s.bouncePauseRate > 0 && s.bouncePauseRate <= 1)) {
      throw new Error(
        `${ENV_KEYS.bouncePauseRate} must be in (0, 1] — a rate, not a percentage ` +
          `(0.02 is 2%), got ${s.bouncePauseRate}`,
      );
    }
    if (s.bouncePauseMinBounces < 1) {
      throw new Error(
        `${ENV_KEYS.bouncePauseMinBounces} must be at least 1, got ${s.bouncePauseMinBounces}`,
      );
    }
    if (s.healthWindowDays < 1) {
      throw new Error(`${ENV_KEYS.healthWindowDays} must be at least 1, got ${s.healthWindowDays}`);
    }
    return new SendPolicy({
      timezone,
      days,
      windowStart,
      windowEnd,
      leadWindowStart,
      leadWindowEnd,
      perInboxCeiling: s.coldSendsPerInboxPerDay,
      rampStart,
      rampFrom: s.coldSendsRampFrom,
      rampStep: s.coldSendsRampStep,
      rampEverySendDays: s.coldSendsRampEveryDays,
      gapMinMs: s.sendGapMinMinutes * MINUTE_MS,
      gapMaxMs: s.sendGapMaxMinutes * MINUTE_MS,
      newOpenersPerDay: s.newOpenersPerDay ?? null,
      resendCooldownDays: s.resendCooldownDays,
      reconcileGraceMs: s.reconcileGraceMinutes * MINUTE_MS,
      bouncePauseRate: s.bouncePauseRate,
      bouncePauseMinBounces: s.bouncePauseMinBounces,
      healthWindowMs: s.healthWindowDays * DAY_MS,
    });
  }

  // ---- the local clock ---------------------------------------------

  /** `now` as a wall clock in the send timezone. */
  localNow(now: Date): { date: PlainDate; time: ClockTime; weekday: number } {
    const w = wallClock(this.timezone, assertInstant(now));
    const date = new PlainDate(w.year, w.month, w.day);
    return { date, time: { hour: w.hour, minute: w.minute }, weekday: date.weekday() };
  }

  /** The local calendar day `now` falls in: the grain of the daily cap. */
  localDay(now: Date): PlainDate {
    return this.localNow(now).date;
  }

  /**
   * The UTC half-open interval `[local midnight, next local midnight)`.
   * DST-correct by construction: 23 h or 25 h on transition days.
   */
  localDayBounds(now: Date): [Date, Date] {
    const day = this.localDay(now);
    return [
      this.localAt(day, { hour: 0, minute: 0 }),
      this.localAt(day.addDays(1), { hour: 0, minute: 0 }),
    ];
  }

  // ---- the window ---------------------------------------------------

  /** True when `now` is a send day and inside the local window (start inclusive, end exclusive). */
  windowOpen(now: Date): boolean {
    const local = this.localNow(now);
    const minute = minutesOfDay(local.time);
    return (
      this.days.has(local.weekday) &&
      minutesOfDay(this.windowStart) <= minute &&
      minute < minutesOfDay(this.windowEnd)
    );
  }

  /**
   * The next UTC instant the window is open: `now` itself if it is, else
   * today's opening if still ahead on a send day, else the next send day's.
   */
  nextWindowOpen(now: Date): Date {
    assertInstant(now);
    if (this.windowOpen(now)) return now;
    const local = this.localNow(now);
    for (let offset = 0; offset < 8; offset++) {
      const day = local.date.addDays(offset);
      if (!this.days.has(day.weekday())) continue;
      if (offset === 0 && minutesOfDay(local.time) >= minutesOfDay(this.windowStart)) continue;
      return this.localAt(day, this.windowStart);
    }
    throw new Error(`no send day within a week of ${local.date}; days=${[...this.days].sort()}`);
  }

  /** Today's closing instant (UTC) while the window is open, else null. */
  windowClose(now: Date): Date | null {
    if (!this.windowOpen(now)) return null;
    return this.localAt(this.localDay(now), this.windowEnd);
  }

  private localAt(day: PlainDate, at: ClockTime): Date {
    return zonedInstant(this.timezone, day.year, day.month, day.day, at.hour, at.minute);
  }

  // ---- the lead's own window -----------------------------------------

  /**
   * True when the lead's own clock is inside the lead window, or when nothing
   * holds the message: no lead window configured, no zone known for this
   * lead, or a zone whose lead window never meets today's fleet window.
   * False means "hold it for a later tick today", never "skip it".
   */
  leadWindowOpen(now: Date, leadZone: string | null): boolean {
    if (this.leadWindowStart === null || this.leadWindowEnd === null || leadZone === null) {
      return true;
    }
    const w = wallClock(leadZone, assertInstant(now));
    const minute = w.hour * 60 + w.minute;
    if (minutesOfDay(this.leadWindowStart) <= minute && minute < minutesOfDay(this.leadWindowEnd)) {
      return true;
    }
    return !this.leadWindowMeetsFleetWindow(now, leadZone);
  }

  /**
   * Whether the lead window, on the lead's clock, overlaps today's fleet
   * window at all, today being the fleet's local day of `now`.
   */
  leadWindowMeetsFleetWindow(now: Date, leadZone: string): boolean {
    if (this.leadWindowStart === null || this.leadWindowEnd === null) return true;
    const day = this.localDay(now);
    const fleetOpen = this.localAt(day, this.windowStart).getTime();
    const fleetClose = this.localAt(day, this.windowEnd).getTime();
    for (const edge of [fleetOpen, fleetClose]) {
      const w = wallClock(leadZone, new Date(edge));
      const leadOpen = zonedInstant(
        leadZone,
        w.year,
        w.month,
        w.day,
        this.leadWindowStart.hour,
        this.leadWindowStart.minute,
      ).getTime();
      const leadClose = zonedInstant(
        leadZone,
        w.year,
        w.month,
        w.day,
        this.leadWindowEnd.hour,
        this.leadWindowEnd.minute,
      ).getTime();
      if (leadOpen < fleetClose && fleetOpen < leadClose) return true;
    }
    return false;
  }

  // ---- the ramp -----------------------------------------------------

  /** Send days from `rampStart` up to, not including, the local day of `now`. */
  sendDaysElapsed(now: Date): number {
    if (this.rampStart === null) return 0;
    const today = this.localDay(now);
    if (today.compare(this.rampStart) <= 0) return 0;
    const total = this.rampStart.daysUntil(today);
    const weeks = Math.floor(total / 7);
    const rest = total % 7;
    let count = weeks * this.days.size;
    const firstOfTail = this.rampStart.addDays(weeks * 7);
    for (let offset = 0; offset < rest; offset++) {
      if (this.days.has(firstOfTail.addDays(offset).weekday())) count += 1;
    }
    return count;
  }

  /** Real sends one inbox may make on the local day of `now`. */
  perInboxCap(now: Date): number {
    if (this.rampStart === null) return this.perInboxCeiling;
    const steps = Math.floor(this.sendDaysElapsed(now) / this.rampEverySendDays);
    return Math.min(this.perInboxCeiling, this.rampFrom + this.rampStep * steps);
  }

  // ---- the gap ------------------------------------------------------

  /** A uniform draw in `[gapMin, gapMax]`, whole seconds, as milliseconds. */
  gapFor(rng: Rng): number {
    const low = Math.round(this.gapMinMs / 1000);
    const high = Math.round(this.gapMaxMs / 1000);
    return rng.int(low, high) * 1000;
  }

  /**
   * The soonest an inbox that last sent at `lastSent` may send again. `null`
   * (never sent) yields `EPOCH` and draws nothing.
   */
  earliestNextSend(lastSent: Date | null, rng: Rng): Date {
    if (lastSent === null) return EPOCH;
    return new Date(assertInstant(lastSent).getTime() + this.gapFor(rng));
  }

  // ---- for humans ---------------------------------------------------

  /** One line for the operator. With `now`, the ramp's position today. */
  describe(now?: Date): string {
    const openers = this.newOpenersPerDay === null ? "unlimited" : String(this.newOpenersPerDay);
    let cap: string;
    if (this.rampStart === null) {
      cap = `${this.perInboxCeiling}/inbox/day`;
    } else {
      const rule =
        `${this.rampFrom} +${this.rampStep} every ${this.rampEverySendDays} send days ` +
        `from ${this.rampStart}, ceiling ${this.perInboxCeiling}`;
      cap =
        now === undefined
          ? `ramp ${rule}`
          : `${this.perInboxCap(now)}/inbox/day today ` +
            `(send day ${this.sendDaysElapsed(now) + 1}, ramp ${rule})`;
    }
    let leadWindow = "";
    if (this.leadWindowStart !== null && this.leadWindowEnd !== null) {
      leadWindow =
        `lead window ${formatClock(this.leadWindowStart)}–${formatClock(this.leadWindowEnd)}` +
        " on the lead's clock, ";
    }
    return (
      `${describeDays(this.days)} ` +
      `${formatClock(this.windowStart)}–${formatClock(this.windowEnd)} ${this.timezone}, ` +
      `${leadWindow}${cap}, ` +
      `gap ${minutes(this.gapMinMs)}–${minutes(this.gapMaxMs)} min, ` +
      `openers/day ${openers}, ` +
      `cooldown ${this.resendCooldownDays} d`
    );
  }
}

function parseTimezone(raw: string): string {
  const zone = canonicalZone(raw.trim());
  if (zone === null) {
    throw new Error(
      `unknown ${ENV_KEYS.sendTimezone} ${JSON.stringify(raw)}; expected an IANA zone like 'America/Chicago'`,
    );
  }
  return zone;
}

function parseDays(raw: string): ReadonlySet<number> {
  const days = new Set<number>();
  for (const token of raw.split(",")) {
    const name = token.trim().toLowerCase();
    if (!name) continue;
    const index = DAY_INDEX.get(name);
    if (index === undefined) {
      throw new Error(
        `unknown day '${token.trim()}' in ${ENV_KEYS.sendDays}; expected mon..sun or full names, comma-separated`,
      );
    }
    days.add(index);
  }
  if (days.size === 0) {
    throw new Error(`${ENV_KEYS.sendDays} is empty; a schedule needs at least one send day`);
  }
  return days;
}

function parseLeadWindow(s: SendPolicySettings): [ClockTime | null, ClockTime | null] {
  const startRaw = s.sendLeadWindowStart;
  const endRaw = s.sendLeadWindowEnd;
  if (startRaw === undefined && endRaw === undefined) return [null, null];
  if (startRaw === undefined || endRaw === undefined) {
    throw new Error(
      `${ENV_KEYS.sendLeadWindowStart} and ${ENV_KEYS.sendLeadWindowEnd} go together: set both or neither`,
    );
  }
  const start = parseTime(startRaw, ENV_KEYS.sendLeadWindowStart);
  const end = parseTime(endRaw, ENV_KEYS.sendLeadWindowEnd);
  if (minutesOfDay(end) <= minutesOfDay(start)) {
    throw new Error(
      `${ENV_KEYS.sendLeadWindowEnd} (${formatClock(end)}) must be after ` +
        `${ENV_KEYS.sendLeadWindowStart} (${formatClock(start)})`,
    );
  }
  return [start, end];
}

function parseTime(raw: string, key: string): ClockTime {
  const m = HHMM.exec(raw.trim());
  if (!m) throw new Error(`${key} must be HH:MM on a 24-hour clock, got ${JSON.stringify(raw)}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function parseRampStart(raw: string): PlainDate {
  try {
    return PlainDate.fromIso(raw);
  } catch (err) {
    throw new Error(`${ENV_KEYS.coldSendsRampStart}: ${(err as Error).message}`);
  }
}

function minutes(ms: number): string {
  return String(ms / MINUTE_MS);
}

/** `{0..4}` → "Mon–Fri"; `{0, 2, 4}` → "Mon, Wed, Fri". */
function describeDays(days: ReadonlySet<number>): string {
  const runs: number[][] = [];
  for (const day of [...days].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && day === (last[last.length - 1] ?? -9) + 1) last.push(day);
    else runs.push([day]);
  }
  const parts: string[] = [];
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) continue;
    if (run.length >= 3) parts.push(`${ABBREVIATIONS[first]}–${ABBREVIATIONS[last]}`);
    else parts.push(...run.map((d) => ABBREVIATIONS[d] ?? "?"));
  }
  return parts.join(", ");
}
