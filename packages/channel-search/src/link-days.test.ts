import type { SiteApplication, SiteHit } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { linkOf, rollupLinks } from "./link-days.js";

let id = 0;
const hit = (ts: string, visitor: string | null, page: string, o: Partial<SiteHit> = {}) =>
  ({
    id: ++id,
    ts: `${ts}T12:00:00.000Z`,
    visitor,
    page,
    secs: 5,
    cta: 0,
    touched: 0,
    r: "",
    ...o,
  }) satisfies SiteHit;
const post = {
  utm_source: "linkedin",
  utm_medium: "organic",
  utm_campaign: "trust",
  utm_content: "ab12cd34",
};
const video = { utm_source: "youtube", utm_medium: "organic", utm_campaign: "3-why-crms-fail" };
const app = (ts: string, email: string, first: object | null, last: object | null) =>
  ({
    id: ++id,
    ts: `${ts}T12:00:00.000Z`,
    visitor: null,
    offer: "demo",
    fit: 1,
    r: "",
    email,
    first_touch: first ? JSON.stringify(first) : null,
    last_touch: last ? JSON.stringify(last) : null,
  }) satisfies SiteApplication;

describe("link days", () => {
  it("a click is a visitor per link per day; a YouTube hop counts apart", () => {
    const rows = rollupLinks(
      [
        hit("2026-10-01", "v1", "/", post),
        hit("2026-10-01", "v1", "/", post),
        hit("2026-10-01", "v2", "/", post),
        hit("2026-10-02", "v1", "/", post),
        hit("2026-10-01", "v3", "youtube:abcdefghijk", { ...post, utm_content: "ff00ff00" }),
        hit("2026-10-01", "v4", "/pricing"),
        hit("2026-10-01", "v5", "/", { r: "code1", utm_source: "email" }),
      ],
      [],
    );
    expect(rows.map((r) => [r.day, r.content, r.clicks, r.hops])).toEqual([
      ["2026-10-01", "ab12cd34", 2, 0],
      ["2026-10-01", "ff00ff00", 0, 1],
      ["2026-10-02", "ab12cd34", 1, 0],
    ]);
  });

  it("forms, calls and won count under first and last touch; revenue in cents", () => {
    const rows = rollupLinks(
      [],
      [
        app("2026-10-03", "Ana@Firm.example", video, post),
        app("2026-10-03", "bo@firm.example", post, null),
      ],
      [
        { day: "2026-10-04", code: null, email: "ana@firm.example" },
        { day: "2026-10-04", code: "code1", email: "bo@firm.example" },
      ],
      [{ emails: ["someone@else.example", "ana@firm.example"], day: "2026-10-09", cents: 150000 }],
    );
    const at = (day: string, campaign: string) =>
      rows.find((r) => r.day === day && r.campaign === campaign);
    expect(at("2026-10-03", "3-why-crms-fail")).toMatchObject({ formsFirst: 1, formsLast: 0 });
    // Bo's last touch is his first: one form both ways.
    expect(at("2026-10-03", "trust")).toMatchObject({ formsFirst: 1, formsLast: 2 });
    // A call booked from an email code is email's, not a post's.
    expect(at("2026-10-04", "3-why-crms-fail")).toMatchObject({ callsFirst: 1, callsLast: 0 });
    expect(at("2026-10-04", "trust")).toMatchObject({ callsFirst: 0, callsLast: 1 });
    expect(at("2026-10-09", "3-why-crms-fail")).toMatchObject({
      wonFirst: 1,
      revenueFirst: 150000,
    });
    expect(at("2026-10-09", "trust")).toMatchObject({ wonLast: 1, revenueLast: 150000 });
  });

  it("a touch with no link, or an email code, is no link", () => {
    expect(linkOf(null)).toBeNull();
    expect(linkOf({ ref: "https://google.com" })).toBeNull();
    expect(linkOf({ utm_source: "email", r: "abc" })).toBeNull();
    expect(linkOf({ utm_source: " YouTube ", utm_campaign: "X" })).toEqual({
      source: "youtube",
      campaign: "x",
      content: "",
    });
  });
});
