/**
 * The Calendar setup's check (designs/2026-10-07-setup-and-vendors.md): may Wren's service account
 * act as the calendar's address? One free/busy read for the next hour, a free read.
 */
import type { SetupCheck } from "@wren/core/setup";
import type { CalendarHost } from "./google.js";

const HOUR = 3_600_000;

export function calendarChecks(host: CalendarHost): Record<string, SetupCheck> {
  return {
    "google_calendar.access": async ({ account, now }) => {
      try {
        await host.busy(account.ref, now, new Date(now.getTime() + HOUR));
        return { ok: true, why: "Wren's service account reads the calendar" };
      } catch (err) {
        const m = (err as Error).message;
        // Google answers a missing delegation at the token: unauthorized_client.
        return /unauthorized_client|invalid_grant|access_denied|no calendar for|\b40[13]\b/.test(m)
          ? { ok: false, why: "Wren's service account isn't allowed on this calendar yet" }
          : { ok: false, why: `Couldn't read the calendar: ${m.slice(0, 200)}` };
      }
    },
  };
}
