/** Platform marks and tints: one rule for every screen (designs/2026-10-07-visual-cues.md). */
import { cued, MARKS, markOf, markOfHost, type State, tintOf } from "@wren/core/records";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { breaks, Cue, cueOf } from "./fields.js";
import { PlatformMark, tintColor } from "./marks.js";

describe("marks", () => {
  it("draws every mark, brand or own, as inline svg", () => {
    for (const m of MARKS) {
      const html = renderToStaticMarkup(createElement(PlatformMark, { mark: m }));
      expect(html, m).toMatch(/^<svg[^>]*data-mark="[a-z]+"[^>]*><path d="M/);
      expect(html).not.toMatch(/<img|https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it("reads the keys records use", () => {
    expect(markOf("sms")).toBe("text");
    expect(markOf("Twitter")).toBe("x");
    expect(markOf("reach")).toBeUndefined();
    expect(markOfHost("https://www.reddit.com/r/sales")).toBe("reddit");
    expect(markOfHost("youtube")).toBe("youtube");
    expect(markOfHost("harbortalent1.example.com")).toBeUndefined();
  });

  it("hides a mark next to its name, names one that stands alone", () => {
    expect(renderToStaticMarkup(createElement(PlatformMark, { mark: "x" }))).toContain(
      'aria-hidden="true"',
    );
    const alone = renderToStaticMarkup(createElement(PlatformMark, { mark: "x", label: "On X" }));
    expect(alone).toContain('aria-label="On X"');
    expect(alone).not.toContain("aria-hidden");
  });
});

describe("cues", () => {
  const states = cued({
    youtube: { label: "YouTube", tone: "neutral" },
    sms: { label: "Texts", tone: "neutral" },
    niche_a: { label: "Agencies", tone: "neutral" },
  });

  it("gives a platform its mark and any other kind a stable tint", () => {
    expect(states.youtube).toEqual({ label: "YouTube", tone: "neutral", mark: "youtube" });
    expect(states.sms?.mark).toBe("text");
    expect(states.niche_a?.tint).toBe(tintOf("niche_a"));
    expect(tintOf("niche_a")).toBe(tintOf("niche_a"));
    expect(tintColor(tintOf("niche_a"))).toMatch(/^var\(--ui-cue-[1-8]\)$/);
  });

  it("draws the cue in place of the tone's dot", () => {
    const f = { key: "p", kind: "status", label: "Platform", states } as never;
    const drawn = (v: string) =>
      renderToStaticMarkup(createElement(Cue, { state: cueOf(f, v) as State }));
    expect(drawn("youtube")).toContain('data-mark="youtube"');
    expect(drawn("niche_a")).toContain("--ui-cue-");
    expect(cueOf(f, "nope")).toBeNull();
  });
});

describe("breaks", () => {
  const html = (s: string) =>
    renderToStaticMarkup(createElement("p", null, breaks(s))).replace(/^<p>|<\/p>$/g, "");

  it("lets a domain, url or email break only after a dot, slash or at", () => {
    expect(html("harbortalent1.example.com")).toBe("harbortalent1.<wbr/>example.<wbr/>com");
    expect(html("ops@acme.io")).toBe("ops@<wbr/>acme.<wbr/>io");
    expect(html("Plain words. Here")).toBe("Plain words. Here");
  });
});
