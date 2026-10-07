import { describe, expect, it } from "vitest";
import { mailFor } from "./mail.js";
import type { CalendarBooking } from "./schema.js";

const b = {
  id: 7,
  email: "ana@example.com",
  name: "Ana Example",
  zone: "Europe/Paris",
  start: new Date("2026-10-12T20:30:00Z"),
  meetUrl: "https://meet.google.com/abc-defg-hij",
} as CalendarBooking;
const o = { title: "Call with {name}", manage: "https://site.example/booking/7.sig", rebook: null };

describe("booker mail", () => {
  it("confirms on the booker's clock with the Meet link and signed move and cancel links", () => {
    const m = mailFor("booked", b, o);
    expect(m.to).toBe("ana@example.com");
    expect(m.subject).toBe("Booked: Call with Ana Example, Monday, October 12 at 10:30 PM GMT+2");
    expect(m.text).toContain("Join: https://meet.google.com/abc-defg-hij");
    expect(m.text).toContain("Reschedule: https://site.example/booking/7.sig?do=move");
    expect(m.text).toContain("Cancel: https://site.example/booking/7.sig?do=cancel");
  });

  it("drops the links once the call is cancelled", () => {
    expect(mailFor("cancelled", b, o).text).not.toContain("/booking/");
  });
});
