/** Templates are pure data, render is a pure function, absence is structural. */
import { describe, expect, it } from "vitest";
import { rule, rulePick } from "./pickers.js";
import {
  type Block,
  field,
  group,
  MissingFactError,
  template as makeTemplate,
  render,
  text,
  variants,
} from "./templates.js";

const FACTS = { first_name: "Jane", "agency.services": "PPC, SEO" };
const template = (body: Block[], subject: Block[] | null = null, name = "opener") =>
  makeTemplate(name, subject, body);
const pick = (t: ReturnType<typeof template>, seed: string, v: string) =>
  render(t, {}, seed).provenance.picks[v];

describe("render", () => {
  it("joins text and field blocks", () => {
    const t = template(
      [text("Hi "), field("first_name"), text(",\n\nI build automations.")],
      [text("Quick question, "), field("first_name")],
    );
    const out = render(t, FACTS, "person:1");
    expect(out.subject).toBe("Quick question, Jane");
    expect(out.body).toBe("Hi Jane,\n\nI build automations.");
    expect(out.provenance.fields).toEqual(["first_name"]);
    expect(out.provenance.template).toBe("opener");
    expect(out.provenance.version).toBe(t.version);
  });
  it("refuses the draft when a required field is missing", () => {
    const t = template([text("Hi "), field("first_name"), text(",")]);
    expect(() => render(t, {}, "person:1")).toThrow(MissingFactError);
    expect(() => render(t, {}, "person:1")).toThrow(/first_name/);
  });
  it("fills and records a fallback", () => {
    const t = template([text("Hi "), field("first_name", "there"), text(",")]);
    const out = render(t, {}, "person:1");
    expect(out.body).toBe("Hi there,");
    expect(out.provenance.fallbacks).toEqual(["first_name"]);
    expect(out.provenance.fields).toEqual([]);
  });
  it("treats a blank fact as absent", () => {
    const t = template([text("Hi "), field("first_name", "there"), text(",")]);
    expect(render(t, { first_name: "   " }, "s").body).toBe("Hi there,");
  });
  it("drops the whole group when a fact is missing, with a clean seam", () => {
    const t = template([
      text("Hi"),
      group([text(" — saw your "), field("agency.services"), text(" work")]),
      text("."),
    ]);
    expect(render(t, FACTS, "s").body).toBe("Hi — saw your PPC, SEO work.");
    expect(render(t, { first_name: "Jane" }, "s").body).toBe("Hi.");
  });
  it("leaves no provenance for a dropped group", () => {
    const t = template([
      text("Hi."),
      group([variants("praise", ["nice work", "great work"]), field("missing_fact")]),
    ]);
    const out = render(t, {}, "s");
    expect(out.body).toBe("Hi.");
    expect(out.provenance.picks).toEqual({});
  });
  it("leaves no orphan comma", () => {
    const t = template([
      text("We help with onboarding, "),
      group([text("and "), field("x"), text(" reporting")]),
      text("."),
    ]);
    expect(render(t, { x: "custom" }, "s").body).toBe(
      "We help with onboarding, and custom reporting.",
    );
    expect(render(t, {}, "s").body).toBe("We help with onboarding.");
  });
  it("leaves no leading orphan period", () => {
    const t = template([group([text("Blah "), field("x")]), text(". Next.")]);
    expect(render(t, { x: "there" }, "s").body).toBe("Blah there. Next.");
    expect(render(t, {}, "s").body).toBe("Next.");
  });
  it("tidy preserves authored indentation", () => {
    const t = template([text("1. Onboarding\n   - intake forms\n   - contracts")]);
    expect(render(t, {}, "s").body).toBe("1. Onboarding\n   - intake forms\n   - contracts");
  });
  it("tidy preserves authored ellipsis and punctuation combos", () => {
    expect(render(template([text("Really...\n\nOr is it!?")]), {}, "s").body).toBe(
      "Really...\n\nOr is it!?",
    );
  });
  it("tidy collapses a fact's own period into the author's", () => {
    const t = template([text("the ADV for "), field("company_name"), text(". Next.")]);
    expect(render(t, { company_name: "Nucleo Capital Ltda." }, "s").body).toBe(
      "the ADV for Nucleo Capital Ltda. Next.",
    );
    expect(render(t, { company_name: "BCWM" }, "s").body).toBe("the ADV for BCWM. Next.");
    expect(render(template([text("Well... fine..")]), {}, "s").body).toBe("Well... fine.");
  });
  it("hash pick is deterministic and spreads", () => {
    const t = template([variants("greet", ["Hey", "Hello", "Hi"]), text(" there.")]);
    expect(render(t, {}, "person:1").body).toBe(render(t, {}, "person:1").body);
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pick(t, `person:${i}`, "greet")));
    expect(picks).toEqual(new Set([0, 1, 2]));
  });
  it("an option needing a missing fact is ineligible", () => {
    const t = template([
      variants("open", [
        [text("Saw you focus on "), field("agency.services")],
        "Came across your studio",
      ]),
      text("."),
    ]);
    for (let i = 0; i < 10; i++) {
      const out = render(t, {}, `person:${i}`);
      expect(out.body).toBe("Came across your studio.");
      expect(out.provenance.picks.open).toBe(1);
    }
  });
  it("a variant with no eligible option refuses", () => {
    const t = template([variants("open", [[text("Rated "), field("agency.rating")]])]);
    expect(() => render(t, {}, "s")).toThrow(MissingFactError);
    expect(() => render(t, {}, "s")).toThrow(/open/);
  });
  it("rule pick routes on facts and falls back to hash", () => {
    const v = variants(
      "pitch",
      ["the paid-media phrasing", "the generic phrasing"],
      rulePick([rule("agency.services", "\\bppc\\b|paid media", 0)]),
    );
    const t = template([v, text(".")]);
    for (let i = 0; i < 5; i++) {
      expect(render(t, FACTS, `p${i}`).body).toBe("the paid-media phrasing.");
    }
    const fallback = new Set(Array.from({ length: 30 }, (_, i) => pick(t, `p${i}`, "pitch")));
    expect(fallback).toEqual(new Set([0, 1]));
  });
  it("a rule targeting a nonexistent option refuses at construction", () => {
    expect(() => variants("pitch", ["a", "b"], rulePick([rule("x", "y", 5)]))).toThrow(/option 5/);
  });
  it("an invalid rule regex refuses at construction", () => {
    expect(() => rule("agency.services", "(", 0)).toThrow(/pattern/);
  });
  it("duplicate variant names are refused", () => {
    expect(() => template([variants("greet", ["Hey"]), variants("greet", ["Hi"])])).toThrow(
      /greet/,
    );
  });
  it("a subjectless template rides the thread", () => {
    expect(render(template([text("Bumping this.")]), {}, "s").subject).toBeNull();
  });
  it("requires a seed", () => {
    expect(() => render(template([text("Hi.")]), {}, "")).toThrow(/seed/);
  });
  it("refuses a pure-text group at construction", () => {
    expect(() => group([text("always present")])).toThrow(/inline/);
  });
});

describe("version", () => {
  it("tracks the authored words", () => {
    const a = template([variants("greet", ["Hey", "Hi"]), text(" there.")]);
    const b = template([variants("greet", ["Hey", "Hi there"]), text(" there.")]);
    expect(a.version).toBe(template([variants("greet", ["Hey", "Hi"]), text(" there.")]).version);
    expect(a.version).not.toBe(b.version);
  });
  it("is unaffected by renaming a variant point", () => {
    const a = template([variants("v1", ["Hey", "Hi"]), text(" there.")]);
    const b = template([variants("bank", ["Hey", "Hi"]), text(" there.")]);
    expect(a.version).toBe(b.version);
  });
  it("excludes the template name", () => {
    const body = [text("Hi there.")];
    expect(template(body, null, "opener").version).toBe(template(body, null, "followup").version);
  });
  it("changes when group structure changes", () => {
    const a = template([text("Hi"), group([text(" — "), field("first_name")]), text(".")]);
    const b = template([text("Hi"), text(" — "), field("first_name"), text(".")]);
    expect(a.version).not.toBe(b.version);
  });
  it("is 12 hex characters", () => {
    expect(template([text("Hi.")]).version).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("hash pick scope", () => {
  it("is scoped per template", () => {
    const a = template([variants("v1", ["A", "B", "C"]), text(".")], null, "opener");
    const b = template([variants("v1", ["A", "B", "C"]), text(".")], null, "followup");
    const pairs = Array.from({ length: 50 }, (_, i) => [
      pick(a, `person:${i}`, "v1"),
      pick(b, `person:${i}`, "v1"),
    ]);
    expect(pairs.some(([p1, p2]) => p1 !== p2)).toBe(true);
    expect(pick(a, "person:0", "v1")).toBe(pairs[0]?.[0]);
    expect(pick(b, "person:0", "v1")).toBe(pairs[0]?.[1]);
  });
});
