/**
 * `wren calendar`: our own booking calendar (designs/2026-10-06-calendar.md). Its settings are Wren's
 * `calendar.booking` block, the same one the Shop part's Configure writes; its calls are in the
 * portal's Calendar app.
 */
import { CALENDAR, calendarSettingsSchema } from "@wren/calendar";
import { bookings } from "@wren/calendar/schema";
import { settingsFor, setWrenSettings } from "@wren/core/clients";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { and, asc, eq, gte } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const int = (v: string) => Number.parseInt(v, 10);

export function registerCalendar(program: Command, withDb: WithDb): void {
  const calendar = program.command("calendar").description("Wren's booking calendar");

  calendar
    .command("settings")
    .description("Wren's open hours and call rules; flags change them (checked before saving)")
    .option("--account <email>", "the Google account whose calendar it reads and writes")
    .option("--zone <iana>", "the hours' time zone")
    .option("--title <text>", "the call's name; {name} is the booker's")
    .option("--hours <day=spans...>", 'per weekday, like mon=10:00-12:00,13:00-17:00 or sat=""')
    .option("--length <min>", "call length", int)
    .option("--step <min>", "minutes between start times", int)
    .option("--notice <min>", "least notice", int)
    .option("--buffer <min>", "kept free around each call", int)
    .option("--per-day <n>", "most calls a day", int)
    .option("--days <n>", "days ahead it books", int)
    .action(
      (o: {
        account?: string;
        zone?: string;
        title?: string;
        hours?: string[];
        length?: number;
        step?: number;
        notice?: number;
        buffer?: number;
        perDay?: number;
        days?: number;
      }) =>
        withDb(async (db) => {
          const was = ((await settingsFor(db, null))[CALENDAR] ?? {}) as Record<string, unknown>;
          const { hours: spans, ...flat } = o;
          const patch = Object.fromEntries(Object.entries(flat).filter(([, v]) => v !== undefined));
          const hours = { ...((was.hours as Record<string, string>) ?? {}) };
          for (const h of spans ?? []) {
            const [day, spec = ""] = h.split("=");
            if (day) hours[day.trim().toLowerCase()] = spec.replace(/^"|"$/g, "");
          }
          const next = { ...was, ...patch, ...(spans?.length ? { hours } : {}) };
          if (Object.keys(patch).length || spans?.length) {
            const checked = calendarSettingsSchema.safeParse(next);
            if (!checked.success)
              throw new Error(checked.error.issues.map((i) => i.message).join("; "));
            await setWrenSettings(db, CALENDAR, next, "cli");
          }
          json(calendarSettingsSchema.parse(next));
        }),
    );

  calendar
    .command("calls")
    .description("Booked calls from now on, soonest first")
    .action(() =>
      withDb(async (db) =>
        json(
          await db
            .select({
              id: bookings.id,
              start: bookings.start,
              name: bookings.name,
              email: bookings.email,
              offer: bookings.offer,
              meet: bookings.meetUrl,
            })
            .from(bookings)
            .where(and(eq(bookings.state, "booked"), gte(bookings.start, new Date())))
            .orderBy(asc(bookings.start)),
        ),
      ),
    );
}
