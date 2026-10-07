import { describe, expect, it } from "vitest";
import { bookOrReload, bookPath, byDay, looksLikeEmail, Refused, TAKEN } from "./book-path.js";

describe("a booking page's path", () => {
  it("reads the client's own host and the app host's /c/<client>", () => {
    expect(bookPath("/book")).toEqual({ base: "", kind: "book", tag: null });
    expect(bookPath("/book/consult/")).toEqual({ base: "", kind: "book", tag: "consult" });
    expect(bookPath("/c/acme/book")).toEqual({ base: "/c/acme", kind: "book", tag: null });
    expect(bookPath("/c/acme/booking/12.ab-c")).toEqual({
      base: "/c/acme",
      kind: "booking",
      token: "12.ab-c",
    });
  });

  it("refuses anything else", () => {
    for (const p of ["/", "/books", "/c/Acme/book", "/c/acme/x/book", "/booking/", "/book/a/b"])
      expect(bookPath(p), p).toBeNull();
  });
});

describe("open times", () => {
  it("group by day on the visitor's clock", () => {
    const slots = ["2026-10-08T03:00:00Z", "2026-10-08T15:00:00Z", "2026-10-09T15:00:00Z"];
    expect([...byDay(slots, "UTC").keys()]).toEqual(["2026-10-08", "2026-10-09"]);
    // 03:00 UTC is the evening before in Toronto.
    expect([...byDay(slots, "America/Toronto").entries()].map(([d, l]) => [d, l.length])).toEqual([
      ["2026-10-07", 1],
      ["2026-10-08", 1],
      ["2026-10-09", 1],
    ]);
  });

  it("take a plain email only", () => {
    expect(looksLikeEmail(" ana@firm.example ")).toBe(true);
    expect(looksLikeEmail("ana@firm")).toBe(false);
  });
});

describe("booking a time someone just took", () => {
  it("says so and reloads the open times", async () => {
    let reloads = 0;
    const got = await bookOrReload(
      async () => {
        throw new Refused("that time was just taken; pick another", 409);
      },
      async () => {
        reloads++;
        return { slots: ["2026-10-08T15:00:00Z"] };
      },
    );
    expect(got).toEqual({ error: TAKEN, slots: { slots: ["2026-10-08T15:00:00Z"] } });
    expect(reloads).toBe(1);
  });

  it("books, or passes any other refusal through without a reload", async () => {
    const reload = async () => {
      throw new Error("no reload");
    };
    expect(await bookOrReload(async () => ({ id: 1 }), reload)).toEqual({ booked: { id: 1 } });
    expect(
      await bookOrReload(async () => {
        throw new Refused("Add your name.", 400);
      }, reload),
    ).toEqual({ error: "Add your name.", slots: null });
  });
});
