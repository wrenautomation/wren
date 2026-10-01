import { describe, expect, it } from "vitest";
import { CalcomCalendar, calcomEvent } from "./calendar.js";

describe("calcomEvent", () => {
  it("reads a cal.com booking page, nothing else", () => {
    expect(calcomEvent("https://cal.com/wrenautomation/call")).toEqual({
      username: "wrenautomation",
      slug: "call",
    });
    expect(calcomEvent("https://cal.com/wrenautomation")).toBeNull();
    expect(calcomEvent("https://example.com/a/b")).toBeNull();
    expect(calcomEvent("not a url")).toBeNull();
  });
});

describe("CalcomCalendar", () => {
  const event = { username: "wrenautomation", slug: "call" };
  const answering = (data: unknown, seen: Request[] = [], status = 200) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response(JSON.stringify({ status: "success", data }), { status });
    }) as typeof fetch;

  it("lists open slots in range, ascending", async () => {
    const seen: Request[] = [];
    const cal = new CalcomCalendar(
      "k",
      event,
      answering(
        {
          "2026-10-07": [{ start: "2026-10-07T18:00:00.000Z" }],
          "2026-10-06": [{ start: "2026-10-06T14:00:00.000Z" }, { start: "bad" }],
        },
        seen,
      ),
    );
    const open = await cal.open(new Date("2026-10-06T00:00Z"), new Date("2026-10-08T00:00Z"));
    expect(open.map((d) => d.toISOString())).toEqual([
      "2026-10-06T14:00:00.000Z",
      "2026-10-07T18:00:00.000Z",
    ]);
    const url = new URL(seen[0]?.url ?? "");
    expect(url.pathname).toBe("/v2/slots");
    expect(url.searchParams.get("eventTypeSlug")).toBe("call");
    expect(seen[0]?.headers.get("cal-api-version")).toBe("2024-09-04");
  });

  it("books and returns the uid; a refusal throws", async () => {
    const seen: Request[] = [];
    const cal = new CalcomCalendar("k", event, answering({ uid: "abc" }, seen));
    const attendee = { name: "Jane", email: "jane@oak.example", timeZone: "America/New_York" };
    expect(await cal.book(new Date("2026-10-07T18:00Z"), attendee)).toBe("abc");
    const body = (await seen[0]?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      start: "2026-10-07T18:00:00.000Z",
      eventTypeSlug: "call",
      attendee,
    });

    const refused = new CalcomCalendar("k", event, answering(null, [], 400));
    await expect(refused.book(new Date(), attendee)).rejects.toThrow("cal.com answered 400");
  });

  it("knows whether an email holds an upcoming booking", async () => {
    expect(await new CalcomCalendar("k", event, answering([{ uid: "x" }])).booked("a@b.c")).toBe(
      true,
    );
    expect(await new CalcomCalendar("k", event, answering([])).booked("a@b.c")).toBe(false);
  });
});
