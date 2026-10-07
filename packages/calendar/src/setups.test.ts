import type { AccountRow } from "@wren/core/setup-schema";
import { describe, expect, it } from "vitest";
import type { CalendarHost } from "./google.js";
import { calendarChecks } from "./setups.js";

const calendar = (ref: string) =>
  ({ id: 1, client: "acme", site: "google_calendar", ref }) as AccountRow;
const now = new Date("2026-01-05T12:00:00Z");

function host(busy: CalendarHost["busy"]): CalendarHost {
  const no = async () => {
    throw new Error("a check only reads");
  };
  return { name: "fake", busy, create: no, move: no, remove: no };
}

describe("google_calendar.access", () => {
  it("passes on one free/busy read for the next hour, as the calendar's address", async () => {
    const asked: [string, Date, Date][] = [];
    const c = calendarChecks(
      host(async (a, from, to) => {
        asked.push([a, from, to]);
        return [];
      }),
    );
    expect(
      await c["google_calendar.access"]?.({ account: calendar("ops@acme.test"), now }),
    ).toEqual({ ok: true, why: "Wren's service account reads the calendar" });
    expect(asked).toEqual([["ops@acme.test", now, new Date("2026-01-05T13:00:00Z")]]);
  });

  it("waits on the delegation when Google refuses the token, and says other faults", async () => {
    const refused = calendarChecks(
      host(async () => {
        throw new Error(
          "token exchange refused (HTTP 401) for ops@acme.test: unauthorized_client: Client is unauthorized",
        );
      }),
    );
    expect(
      await refused["google_calendar.access"]?.({ account: calendar("ops@acme.test"), now }),
    ).toEqual({ ok: false, why: "Wren's service account isn't allowed on this calendar yet" });
    // An address Google doesn't know under the delegation: the same wait.
    const unknown = calendarChecks(
      host(async () => {
        throw new Error(
          "token exchange refused (HTTP 400): invalid_grant: Invalid email or User ID",
        );
      }),
    );
    expect(
      await unknown["google_calendar.access"]?.({ account: calendar("ops@acme.test"), now }),
    ).toEqual({ ok: false, why: "Wren's service account isn't allowed on this calendar yet" });
    const down = calendarChecks(
      host(async () => {
        throw new Error("fetch failed");
      }),
    );
    expect(
      await down["google_calendar.access"]?.({ account: calendar("ops@acme.test"), now }),
    ).toEqual({ ok: false, why: "Couldn't read the calendar: fetch failed" });
  });
});
