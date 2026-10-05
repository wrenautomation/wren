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
 * `nicheOpenersPerDay` is the same brake for one campaign, so one can wind down
 * while another opens. `killSwitchOffFor` names campaigns the kill switch neither
 * counts nor stops.
 * The ramp is data: `from + step × (send days elapsed ÷ every)`, never above
 * the ceiling, counted in the schedule's own days. Holidays (`holidays.ts`)
 * are not send days: the window stays shut, the ramp does not climb.
 * An inbox with its own `Ramp` (roster `ramp`) climbs from its own start
 * instead, by the same day rules, and sends nothing cold before it.
 * A ramp that names `warmupStart` is also held to its warmup: Instantly climbs
 * `warmupStep` a day (weekends too) to `warmupLimit`, and cold is at most that
 * day's warmup ÷ `warmupPerCold` (2 to 1 by the email-infra SOP).
 * Every window question is answered on the operator's local clock and
 * returned as a UTC instant.
 */
import { ENV_KEYS } from "@wren/config";
import { type ClockTime, formatClock, minutesOfDay, PlainDate } from "./dates.js";
import { type HolidayCalendar, holidayOn, holidaysIn, parseHolidayCalendars } from "./holidays.js";
import { type Rng, seededRng } from "./rng.js";
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

/** One inbox's own ramp: `from + step` per send day since `start`, its first cold day, to `ceiling`. */
export interface Ramp {
  readonly start: PlainDate;
  readonly from: number;
  readonly step: number;
  readonly ceiling: number;
  /** The day its Instantly warmup began; set = cold never passes warmup ÷ `warmupPerCold`. */
  readonly warmupStart?: PlainDate | null;
}

/** The settings block `SendPolicy` parses; `@wren/config` `Settings` satisfies it. */
export interface SendPolicySettings {
  readonly sendTimezone: string;
  readonly sendDays: string;
  readonly sendHolidays: string;
  readonly sendWindowStart: string;
  readonly sendWindowEnd: string;
  readonly sendLeadWindowStart?: string | undefined;
  readonly sendLeadWindowEnd?: string | undefined;
  readonly coldSendsPerInboxPerDay: number;
  readonly coldSendsRampStart?: string | undefined;
  readonly coldSendsRampFrom: number;
  readonly coldSendsRampStep: number;
  readonly coldSendsRampEveryDays: number;
  readonly warmupPerCold?: number;
  readonly warmupStep?: number;
  readonly warmupLimit?: number;
  readonly sendGapMinMinutes: number;
  readonly sendGapMaxMinutes: number;
  readonly newOpenersPerDay?: number | undefined;
  readonly nicheOpenersPerDay?: string | undefined;
  readonly killSwitchOffFor?: string | undefined;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMinutes: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowDays: number;
}

export interface SendPolicyFields {
  readonly timezone: string; // canonical IANA name
  readonly days: ReadonlySet<number>; // 0 = Monday … 6 = Sunday
  readonly holidays: ReadonlySet<HolidayCalendar>;
  readonly windowStart: ClockTime; // inclusive
  readonly windowEnd: ClockTime; // exclusive
  readonly leadWindowStart: ClockTime | null;
  readonly leadWindowEnd: ClockTime | null;
  readonly perInboxCeiling: number;
  readonly rampStart: PlainDate | null;
  readonly rampFrom: number;
  readonly rampStep: number;
  readonly rampEverySendDays: number;
  readonly warmupPerCold: number;
  readonly warmupStep: number;
  readonly warmupLimit: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly newOpenersPerDay: number | null;
  readonly nicheOpenersPerDay: ReadonlyMap<string, number>;
  readonly killSwitchOffFor: ReadonlySet<string>;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMs: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowMs: number;
}

/** A console override of one campaign; null = the env default. */
export interface CampaignControl {
  readonly campaign: string;
  readonly killSwitch: boolean | null;
  readonly openersPerDay: number | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** How far `nextWindowOpen` looks; past this the schedule is broken, not quiet. */
const NEXT_SEND_DAY_HORIZON = 60;

/** The parsed send schedule and pacing limits. Built once at startup, frozen. */
export class SendPolicy implements SendPolicyFields {
  readonly timezone: string;
  readonly days: ReadonlySet<number>;
  readonly holidays: ReadonlySet<HolidayCalendar>;
  readonly windowStart: ClockTime;
  readonly windowEnd: ClockTime;
  readonly leadWindowStart: ClockTime | null;
  readonly leadWindowEnd: ClockTime | null;
  readonly perInboxCeiling: number;
  readonly rampStart: PlainDate | null;
  readonly rampFrom: number;
  readonly rampStep: number;
  readonly rampEverySendDays: number;
  readonly warmupPerCold: number;
  readonly warmupStep: number;
  readonly warmupLimit: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly newOpenersPerDay: number | null;
  readonly nicheOpenersPerDay: ReadonlyMap<string, number>;
  readonly killSwitchOffFor: ReadonlySet<string>;
  readonly resendCooldownDays: number;
  readonly reconcileGraceMs: number;
  readonly bouncePauseRate: number;
  readonly bouncePauseMinBounces: number;
  readonly healthWindowMs: number;

  constructor(fields: SendPolicyFields) {
    this.timezone = fields.timezone;
    this.days = new Set(fields.days);
    this.holidays = new Set(fields.holidays);
    this.windowStart = fields.windowStart;
    this.windowEnd = fields.windowEnd;
    this.leadWindowStart = fields.leadWindowStart;
    this.leadWindowEnd = fields.leadWindowEnd;
    this.perInboxCeiling = fields.perInboxCeiling;
    this.rampStart = fields.rampStart;
    this.rampFrom = fields.rampFrom;
    this.rampStep = fields.rampStep;
    this.rampEverySendDays = fields.rampEverySendDays;
    this.warmupPerCold = fields.warmupPerCold;
    this.warmupStep = fields.warmupStep;
    this.warmupLimit = fields.warmupLimit;
    this.gapMinMs = fields.gapMinMs;
    this.gapMaxMs = fields.gapMaxMs;
    this.newOpenersPerDay = fields.newOpenersPerDay;
    this.nicheOpenersPerDay = new Map(fields.nicheOpenersPerDay);
    this.killSwitchOffFor = new Set(fields.killSwitchOffFor);
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
      [ENV_KEYS.warmupPerCold, s.warmupPerCold ?? 2],
      [ENV_KEYS.warmupStep, s.warmupStep ?? 2],
      [ENV_KEYS.warmupLimit, s.warmupLimit ?? 60],
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
      holidays: parseHolidayCalendars(s.sendHolidays, ENV_KEYS.sendHolidays),
      windowStart,
      windowEnd,
      leadWindowStart,
      leadWindowEnd,
      perInboxCeiling: s.coldSendsPerInboxPerDay,
      rampStart,
      rampFrom: s.coldSendsRampFrom,
      rampStep: s.coldSendsRampStep,
      rampEverySendDays: s.coldSendsRampEveryDays,
      warmupPerCold: s.warmupPerCold ?? 2,
      warmupStep: s.warmupStep ?? 2,
      warmupLimit: s.warmupLimit ?? 60,
      gapMinMs: s.sendGapMinMinutes * MINUTE_MS,
      gapMaxMs: s.sendGapMaxMinutes * MINUTE_MS,
      newOpenersPerDay: s.newOpenersPerDay ?? null,
      nicheOpenersPerDay: parseNicheCaps(s.nicheOpenersPerDay ?? ""),
      killSwitchOffFor: new Set(
        (s.killSwitchOffFor ?? "")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
      ),
      resendCooldownDays: s.resendCooldownDays,
      reconcileGraceMs: s.reconcileGraceMinutes * MINUTE_MS,
      bouncePauseRate: s.bouncePauseRate,
      bouncePauseMinBounces: s.bouncePauseMinBounces,
      healthWindowMs: s.healthWindowDays * DAY_MS,
    });
  }

  /** This policy with the console's campaign overrides merged in: a new frozen policy. */
  withCampaigns(controls: readonly CampaignControl[]): SendPolicy {
    if (!controls.length) return this;
    const off = new Set(this.killSwitchOffFor);
    const caps = new Map(this.nicheOpenersPerDay);
    for (const c of controls) {
      if (c.killSwitch === true) off.delete(c.campaign);
      if (c.killSwitch === false) off.add(c.campaign);
      if (c.openersPerDay !== null) caps.set(c.campaign, c.openersPerDay);
    }
    return new SendPolicy({ ...this, killSwitchOffFor: off, nicheOpenersPerDay: caps });
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

  // ---- days off -----------------------------------------------------

  /** The holiday `day` falls on, by name, or null. Weekends are not holidays. */
  holidayOn(day: PlainDate): string | null {
    return holidayOn(this.holidays, day);
  }

  /** True when `day` is one of the schedule's days and no holiday. */
  sendsOn(day: PlainDate): boolean {
    return this.days.has(day.weekday()) && this.holidayOn(day) === null;
  }

  // ---- the window ---------------------------------------------------

  /** True when `now` is a send day and inside the local window (start inclusive, end exclusive). */
  windowOpen(now: Date): boolean {
    const local = this.localNow(now);
    const minute = minutesOfDay(local.time);
    return (
      this.sendsOn(local.date) &&
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
    for (let offset = 0; offset < NEXT_SEND_DAY_HORIZON; offset++) {
      const day = local.date.addDays(offset);
      if (!this.sendsOn(day)) continue;
      if (offset === 0 && minutesOfDay(local.time) >= minutesOfDay(this.windowStart)) continue;
      return this.localAt(day, this.windowStart);
    }
    throw new Error(
      `no send day within ${NEXT_SEND_DAY_HORIZON} days of ${local.date}; ` +
        `days=${[...this.days].sort()}, holidays=${[...this.holidays].join(",")}`,
    );
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

  /** Send days from the ramp's start (the inbox's own, else `rampStart`) up to, not including, the local day of `now`. */
  sendDaysElapsed(now: Date, ramp?: Ramp | null): number {
    const start = ramp ? ramp.start : this.rampStart;
    if (start === null) return 0;
    const today = this.localDay(now);
    if (today.compare(start) <= 0) return 0;
    const total = start.daysUntil(today);
    const weeks = Math.floor(total / 7);
    const rest = total % 7;
    let count = weeks * this.days.size;
    const firstOfTail = start.addDays(weeks * 7);
    for (let offset = 0; offset < rest; offset++) {
      if (this.days.has(firstOfTail.addDays(offset).weekday())) count += 1;
    }
    return count - this.holidaysOnSendDays(start, today);
  }

  /** Holidays in `[from, to)` that fall on one of the schedule's days. */
  private holidaysOnSendDays(from: PlainDate, to: PlainDate): number {
    let n = 0;
    for (let year = from.year; year <= to.year; year++) {
      for (const iso of holidaysIn(this.holidays, year).keys()) {
        const day = PlainDate.fromIso(iso);
        if (day.compare(from) >= 0 && day.compare(to) < 0 && this.days.has(day.weekday())) n += 1;
      }
    }
    return n;
  }

  /** Real sends one inbox may make on the local day of `now`; `ramp` is that inbox's own (0 before its start). */
  perInboxCap(now: Date, ramp?: Ramp | null): number {
    if (ramp) {
      if (this.localDay(now).compare(ramp.start) < 0) return 0;
      const climbed = Math.min(
        ramp.ceiling,
        ramp.from + ramp.step * this.sendDaysElapsed(now, ramp),
      );
      const warm = this.warmupOn(now, ramp);
      return warm === null ? climbed : Math.min(climbed, Math.floor(warm / this.warmupPerCold));
    }
    if (this.rampStart === null) return this.perInboxCeiling;
    const steps = Math.floor(this.sendDaysElapsed(now) / this.rampEverySendDays);
    return Math.min(this.perInboxCeiling, this.rampFrom + this.rampStep * steps);
  }

  /**
   * Warmup mails the inbox sends on the local day of `now`: `warmupStep` per
   * calendar day since `warmupStart` (Instantly warms weekends too, from 0), to
   * `warmupLimit`. null = the ramp names no warmup.
   */
  warmupOn(now: Date, ramp?: Ramp | null): number | null {
    const start = ramp?.warmupStart;
    if (!start) return null;
    const days = Math.max(0, start.daysUntil(this.localDay(now)));
    return Math.min(this.warmupLimit, this.warmupStep * days);
  }

  // ---- the gap ------------------------------------------------------

  /** A uniform draw in `[gapMin, gapMax]`, whole seconds, as milliseconds. */
  gapFor(rng: Rng): number {
    const low = Math.round(this.gapMinMs / 1000);
    const high = Math.round(this.gapMaxMs / 1000);
    return rng.int(low, high) * 1000;
  }

  /**
   * The wait after a send, so an inbox spreads its day: the rest of that
   * day's window shared by the sends it has left, ±20%, never under the
   * configured gap. A small cap spaces sends out (10 a day ≈ 40 min apart); a
   * cap past what the floor fits sends at the floor and stops at the close.
   * Seeded by the send instant, so every tick and the scheduler agree.
   */
  gapAfter(lastSent: Date, sentThatDay: number, ramp?: Ramp | null): number {
    const close = this.windowClose(lastSent);
    const left = this.perInboxCap(lastSent, ramp) - sentThatDay;
    const spread = close !== null && left > 0 ? (close.getTime() - lastSent.getTime()) / left : 0;
    const low = Math.round(Math.max(this.gapMinMs, spread * 0.8) / 1000);
    const high = Math.round(Math.max(this.gapMaxMs, spread * 1.2) / 1000);
    return seededRng(lastSent.getTime()).int(low, high) * 1000;
  }

  /**
   * The soonest an inbox that last sent at `lastSent` may send again, having
   * sent `sentThatDay` that day. `null` (never sent) yields `EPOCH`.
   */
  earliestNextSend(lastSent: Date | null, sentThatDay: number, ramp?: Ramp | null): Date {
    if (lastSent === null) return EPOCH;
    return new Date(assertInstant(lastSent).getTime() + this.gapAfter(lastSent, sentThatDay, ramp));
  }

  /** The niche's own opener brake; null = none (the fleet brake still applies). */
  nicheOpenerCap(niche: string): number | null {
    return this.nicheOpenersPerDay.get(niche) ?? null;
  }

  /** Whether the kill switch counts this niche's bounces and stops its sends. */
  killSwitchOn(niche: string): boolean {
    return !this.killSwitchOffFor.has(niche);
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
    const perNiche = [...this.nicheOpenersPerDay].map(([n, cap]) => ` ${n} ${cap}`).join(",");
    const off = this.killSwitchOffFor.size
      ? `, kill switch off for ${[...this.killSwitchOffFor].sort().join(", ")}`
      : "";
    const holidays = this.holidays.size
      ? `, off on ${[...this.holidays].join(", ")} holidays`
      : ", no holidays off";
    return (
      `${describeDays(this.days)} ` +
      `${formatClock(this.windowStart)}–${formatClock(this.windowEnd)} ${this.timezone}, ` +
      `${leadWindow}${cap}, ` +
      `gap ${minutes(this.gapMinMs)}–${minutes(this.gapMaxMs)} min, ` +
      `openers/day ${openers}${perNiche}, ` +
      `cooldown ${this.resendCooldownDays} d${holidays}${off}`
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

/** "agencies=0, recruiting=40" → niche → cap. Strict: a typo stops startup, never reads as "no cap". */
function parseNicheCaps(raw: string): Map<string, number> {
  const caps = new Map<string, number>();
  for (const part of raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^([a-z0-9_-]+)\s*=\s*(\d+)$/.exec(part);
    if (!m?.[1] || m[2] === undefined) {
      throw new Error(
        `${ENV_KEYS.nicheOpenersPerDay} must be niche=count pairs ("agencies=0,recruiting=40"), got ${JSON.stringify(part)}`,
      );
    }
    caps.set(m[1], Number(m[2]));
  }
  return caps;
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
