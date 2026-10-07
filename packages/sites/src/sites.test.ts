import { OFFERS } from "@wren/offers";
import { describe, expect, it } from "vitest";
import { pageApprovalId, parsePageApprovalId } from "./console.js";
import { draftCopy, jsonIn } from "./draft.js";
import { KIT_JS, kitTag } from "./kit.js";
import { channelOf, SLUG, slugOf } from "./model.js";
import { goneHtml, renderPage } from "./render.js";
import {
  ContentProblem,
  checkContent,
  safeHref,
  TEMPLATE_IDS,
  templateOf,
} from "./templates/index.js";

const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
if (!offer) throw new Error("no offer registered");

describe("slugs and sources", () => {
  it("makes a slug from words", () => {
    expect(slugOf("Café Owners: 3x more calls!")).toBe("cafe-owners-3x-more-calls");
    expect(SLUG.test(slugOf("x".repeat(200)))).toBe(true);
  });

  it("reads a visit's channel off its utm", () => {
    expect(channelOf({ medium: "paid" })).toBe("ads");
    expect(channelOf({ medium: "cpc" })).toBe("ads");
    expect(channelOf({ medium: "outreach" })).toBe("outreach");
    expect(channelOf({ medium: "organic" })).toBe("organic");
    expect(channelOf({ source: "newsletter" })).toBe("other");
    expect(channelOf({ ref: "https://example.com" })).toBe("referral");
    expect(channelOf({})).toBe("direct");
  });

  it("round-trips a To approve id", () => {
    const id = "0b5c2a59-9a3e-4c47-9a35-0f1f2b6c1d11";
    expect(parsePageApprovalId(pageApprovalId(id, 3))).toEqual({ id, number: 3 });
    expect(parsePageApprovalId("template:1:2")).toBeNull();
    expect(parsePageApprovalId(`page:${id}:x`)).toBeNull();
  });
});

describe("templates", () => {
  for (const id of TEMPLATE_IDS) {
    it(`${id}: fills from an offer and passes its own check`, () => {
      const t = templateOf(id);
      const c = t.fill(offer, { angle: "speed", audience: null });
      expect(checkContent(t, c)).toEqual(c);
      const html = renderPage(t, c, { page: "p1", base: "", track: true });
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("data-wren-form");
      expect(html).toContain(kitTag("p1", "").slice(0, 20));
    });
  }

  it("drops unknown fields, refuses wrong kinds and copy past its limit", () => {
    const t = templateOf("lander");
    const c = t.fill(offer, {});
    expect(checkContent(t, { ...c, extra: "x" })).not.toHaveProperty("extra");
    expect(() => checkContent(t, { ...c, book_url: "javascript:alert(1)" })).toThrow(
      ContentProblem,
    );
    expect(() => checkContent(t, { ...c, headline: ["a"] })).toThrow(ContentProblem);
    expect(() => checkContent(t, { ...c, headline: "x".repeat(1000) })).toThrow(ContentProblem);
    expect(() => checkContent(t, { ...c, headline: "" })).toThrow(ContentProblem);
  });

  it("escapes copy and drops unsafe links", () => {
    const t = templateOf("lander");
    const c = {
      ...t.fill(offer, {}),
      headline: '<script>alert("x")</script>',
      book_url: "javascript:alert(1)",
    };
    // Past the check too: the renderer escapes and drops on its own.
    const html = renderPage(t, c, { page: "p1", base: "", track: false });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("__kit.js");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/book")).toBe("/book");
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
  });

  it("marks a preview and answers gone pages", () => {
    const t = templateOf("listicle");
    const html = renderPage(t, t.fill(offer, {}), {
      page: "p",
      base: "",
      track: false,
      banner: "Draft",
    });
    expect(html).toContain("Draft");
    expect(goneHtml(410)).toContain("taken down");
  });

  it("ships a kit that posts as text, so no CORS preflight", () => {
    expect(KIT_JS).toContain("sendBeacon");
    expect(KIT_JS).toContain("text/plain");
  });
});

describe("Claude's draft", () => {
  const t = templateOf("lander");
  const start = t.fill(offer, {});

  it("finds the JSON in an answer", () => {
    expect(jsonIn('Here:\n{"a":1}\nDone')).toEqual({ a: 1 });
    expect(() => jsonIn("no json")).toThrow(ContentProblem);
  });

  it("keeps a clean draft and never lets the model pick a link", async () => {
    const g = await draftCopy(
      async () =>
        JSON.stringify({
          headline: "Fill your calendar without cold calls",
          book_url: "https://evil.example",
        }),
      t,
      offer,
      { facts: [], start },
    );
    expect(g.text).not.toBeNull();
    expect(g.result.headline).toBe("Fill your calendar without cold calls");
    expect(g.result.book_url).toBe(start.book_url ?? "");
  });

  it("drops a draft that claims made-up numbers twice", async () => {
    const g = await draftCopy(
      async () => JSON.stringify({ headline: "We booked 937 calls last year for our clients" }),
      t,
      offer,
      { facts: [], start },
    );
    expect(g.text).toBeNull();
    expect(g.outcome).not.toBe("clean");
  });
});
