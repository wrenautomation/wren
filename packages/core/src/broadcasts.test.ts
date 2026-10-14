/** A broadcast's words and times: merge fields, STOP, subjects, and each person's local time. */
import { describe, expect, it } from "vitest";
import { checkWords, dueFor, factsOf, renderFor, startOf, TEXT_MOST } from "./broadcasts.js";

const at = (iso: string) => new Date(iso);

describe("checkWords", () => {
  it("takes plain text with merge fields and a fallback", () => {
    expect(
      checkWords("email", " Hello {first_name|there} ", "Hi {first_name|there},\n\nNews."),
    ).toEqual({
      subject: "Hello {first_name|there}",
      body: "Hi {first_name|there},\n\nNews.",
    });
  });

  it("refuses what can't go: no subject, a field we don't have, a text without STOP or too long", () => {
    expect(() => checkWords("email", "", "Hi.")).toThrow(/subject/);
    expect(() => checkWords("email", "Hi", "Hi {company}.")).toThrow(/company/);
    expect(() => checkWords("sms", null, "Hi {first_name|there}, news.")).toThrow(/STOP/);
    expect(() => checkWords("sms", null, `${"x".repeat(TEXT_MOST)} Reply STOP to stop.`)).toThrow(
      /at most/,
    );
    expect(
      checkWords("sms", "ignored", "Hi {first_name|there}. Reply STOP to stop.").subject,
    ).toBeNull();
  });
});

describe("one person's copy", () => {
  it("reads a usable first name, else the fallback", () => {
    expect(factsOf("ann lee")).toEqual({ first_name: "Ann", name: "ann lee" });
    expect(factsOf("#12")).toEqual({ first_name: null, name: "#12" });
    expect(factsOf(null)).toEqual({ first_name: null, name: null });
    const b = {
      id: 1,
      channel: "email" as const,
      subject: "For {first_name|you}",
      body: "Hi {first_name|there}.",
    };
    expect(renderFor(b, factsOf("ann lee"), "1")).toEqual({ subject: "For Ann", body: "Hi Ann." });
    expect(renderFor(b, factsOf(null), "2")).toEqual({ subject: "For you", body: "Hi there." });
  });

  it("says what is missing when a field has no value and no fallback", () => {
    const b = {
      id: 1,
      channel: "sms" as const,
      subject: null,
      body: "Hi {first_name}. Reply STOP to stop.",
    };
    expect(renderFor(b, factsOf(null), "1")).toHaveProperty("missing");
  });
});

describe("times", () => {
  const now = at("2026-10-14T12:00:00Z");
  const sendAt = at("2026-10-20T14:00:00Z"); // 10:00 in New York (EDT)

  it("sends now with no time, at the time otherwise, never before now", () => {
    const b = { sendAt: null, local: false, zone: "America/New_York" };
    expect(dueFor(b, null, now)).toEqual(now);
    expect(startOf(b, now)).toEqual(now);
    expect(dueFor({ ...b, sendAt }, "Asia/Tokyo", now)).toEqual(sendAt);
    expect(dueFor({ ...b, sendAt: at("2026-10-01T00:00:00Z") }, null, now)).toEqual(now);
  });

  it("with local time: the same wall clock in each person's zone, the broadcast's when unknown", () => {
    const b = { sendAt, local: true, zone: "America/New_York" };
    expect(dueFor(b, "America/Los_Angeles", now)).toEqual(at("2026-10-20T17:00:00Z"));
    expect(dueFor(b, "Europe/London", now)).toEqual(at("2026-10-20T09:00:00Z"));
    expect(dueFor(b, null, now)).toEqual(sendAt);
    expect(dueFor(b, "Not/AZone", now)).toEqual(sendAt);
    // It starts when the first zone on earth (UTC+14) reaches 10:00.
    expect(startOf(b, now)).toEqual(at("2026-10-19T20:00:00Z"));
  });
});
