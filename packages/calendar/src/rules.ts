/**
 * A calendar's availability (designs/2026-10-06-calendar.md): weekly hours on the owner's clock,
 * then notice, buffer, length, step, a daily cap and how far ahead. It is the `calendar.booking`
 * part's settings block, so the Shop edits it: Wren's in `wren_settings`, a client's in its
 * `clients.products`. Every field has a default, so `{}` is a calendar open Mon to Fri, 10 to 5.
 */
import { canonicalZone } from "@wren/core/time";
import { z } from "zod";

export const CALENDAR = "calendar.booking";

/** Days as the settings name them, Sunday first, as `getUTCDay` counts. */
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

/** One open stretch of a day, in minutes after midnight on the owner's clock. */
export interface Stretch {
  from: number;
  to: number;
}

const CLOCK = /^([01]?\d|2[0-4]):([0-5]\d)$/;
const minutesOf = (s: string): number | null => {
  const m = CLOCK.exec(s.trim());
  if (!m) return null;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return at <= 24 * 60 ? at : null;
};

/**
 * "10:00-12:00, 13:00-17:00" as stretches, in order and apart; blank is closed. Null when it
 * doesn't read: a bad clock, an end before its start, or two that overlap.
 */
export function parseHours(text: string): Stretch[] | null {
  const out: Stretch[] = [];
  for (const part of text.split(",")) {
    if (!part.trim()) continue;
    const [a, b, ...rest] = part.split("-");
    if (a === undefined || b === undefined || rest.length) return null;
    const from = minutesOf(a);
    const to = minutesOf(b);
    if (from === null || to === null || to <= from) return null;
    out.push({ from, to });
  }
  out.sort((x, y) => x.from - y.from);
  for (let i = 1; i < out.length; i++)
    if ((out[i] as Stretch).from < (out[i - 1] as Stretch).to) return null;
  return out;
}

const hours = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .refine((s) => parseHours(s) !== null, "hours read like 10:00-12:00, 13:00-17:00")
    .describe("Open hours on your clock, like 10:00-12:00, 13:00-17:00; blank is closed");

const minutes = (fallback: number, max: number, says: string) =>
  z.number().int().min(0).max(max).default(fallback).describe(says);

export const calendarSettingsSchema = z
  .object({
    account: z
      .string()
      .optional()
      .describe("The Google account whose calendar it reads busy times from and writes calls to"),
    zone: z
      .string()
      .default("America/Toronto")
      .refine((name) => canonicalZone(name) !== null, "an IANA time zone, like America/Toronto")
      .describe("Your time zone; the hours are on its clock"),
    title: z.string().min(1).max(120).default("Intro call").describe("The call's name"),
    hours: z
      .object({
        mon: hours("10:00-17:00"),
        tue: hours("10:00-17:00"),
        wed: hours("10:00-17:00"),
        thu: hours("10:00-17:00"),
        fri: hours("10:00-17:00"),
        sat: hours(""),
        sun: hours(""),
      })
      .prefault({}),
    length: z
      .number()
      .int()
      .min(10)
      .max(240)
      .default(30)
      .describe("How long a call is, in minutes"),
    step: z.number().int().min(5).max(240).default(30).describe("Minutes between start times"),
    notice: minutes(120, 7 * 24 * 60, "The least time before a call it can be booked, in minutes"),
    buffer: minutes(10, 120, "Minutes kept free before and after each call"),
    perDay: z.number().int().min(1).max(48).default(6).describe("The most calls in one day"),
    days: z.number().int().min(1).max(90).default(21).describe("How many days ahead it books"),
  })
  .strict();
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

/** The settings as the slot maths reads them: hours parsed per weekday, the zone canonical. */
export interface Rules {
  zone: string;
  /** Index 0 is Sunday. */
  week: readonly (readonly Stretch[])[];
  length: number;
  step: number;
  notice: number;
  buffer: number;
  perDay: number;
  days: number;
}

/** A settings block (`{}` and missing fields take defaults) as rules. Throws on one that won't parse. */
export function rulesOf(settings: unknown): Rules & { account: string | null; title: string } {
  const s = calendarSettingsSchema.parse(settings ?? {});
  return {
    account: s.account?.trim().toLowerCase() || null,
    title: s.title,
    zone: canonicalZone(s.zone) ?? s.zone,
    week: DAYS.map((d) => parseHours(s.hours[d]) ?? []),
    length: s.length,
    step: s.step,
    notice: s.notice,
    buffer: s.buffer,
    perDay: s.perDay,
    days: s.days,
  };
}
