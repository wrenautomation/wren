/** The brief's code checks and the outcome's spine moves, on synthetic lines only. */
import { describe, expect, it } from "vitest";
import { checkQuestions, factLine, gapQuestions, ownWords } from "./brief.js";
import { outcomeEmits } from "./outcome.js";
import { bookedCall, bookingEmit, briefPath } from "./restate.js";
import { briefSettingsOf, outcomeSettingsOf } from "./settings.js";

const FACTS = "Who: Ana at Acme\nFact: Team: 12 people (2026-09-01)";

describe("checkQuestions", () => {
  it("keeps short questions with known numbers, drops the rest", () => {
    const answer = [
      "Here are some questions:",
      "1. How is the team of 12 split today?",
      "- Did the 40 new hires start?",
      "* Is https://acme.example still current?",
      "Who owns the budget?",
      "Who owns the budget?",
      `${"Why ".repeat(45)}?`,
      "Tell me more.",
    ].join("\n");
    expect(checkQuestions(answer, FACTS, [])).toEqual([
      "How is the team of 12 split today?",
      "Who owns the budget?",
    ]);
  });

  it("skips what's already asked and stops at the cap", () => {
    const answer =
      "What changed?\nWhat do they use now?\nWhat would good look like?\nWho else decides?";
    expect(checkQuestions(answer, FACTS, ["What changed?"], 2)).toEqual([
      "What do they use now?",
      "What would good look like?",
    ]);
  });
});

describe("factLine", () => {
  it("reads a dossier fact as words, never raw JSON", () => {
    expect(
      factLine({ what: "hiring", value: { count: 14, roles: ["Recruiter", "Sourcer"] } }),
    ).toBe("Hiring: 14 open roles (Recruiter, Sourcer)");
    expect(factLine({ what: "news", value: { title: "Opened a second office" } })).toBe(
      "News: Opened a second office",
    );
    expect(factLine({ what: "hiring_check", value: { state: "no_openings", tried: [] } })).toBe(
      "Hiring check: state no_openings",
    );
    expect(factLine({ what: "email", value: "ana@acme.example" })).toBe("Email: ana@acme.example");
    expect(factLine({ what: "opener", value: { nested: { a: 1 } } })).toBeNull();
  });
});

describe("ownWords", () => {
  it("keeps what's above the quote", () => {
    expect(ownWords("Sounds good, Tuesday works.\n\nOn Mon, Ana wrote:\n> hi")).toBe(
      "Sounds good, Tuesday works.",
    );
  });
});

describe("gapQuestions", () => {
  it("asks what's missing, three at most", () => {
    const qs = gapQuestions({
      call: {
        id: 1,
        who: "Ana",
        email: null,
        title: null,
        company: null,
        domain: null,
        start: null,
        offer: null,
      },
      cameIn: [],
      thread: [],
      facts: [],
      posts: [],
      signals: [],
    });
    expect(qs.map((q) => q.text)).toEqual([
      "What company are they with, and what does it do?",
      "What made them book now?",
      "What changed for them lately?",
    ]);
    expect(qs.every((q) => q.from === "code")).toBe(true);
  });
});

describe("outcomeEmits", () => {
  const m = (id: number, outcome: "won" | "not_yet" | "no_show" | "not_fit" | null) => ({
    id,
    outcome,
    reason: outcome === "not_yet" ? "Budget" : null,
    start: "2026-10-05T14:00:00.000Z",
    email: null,
    name: "Ana",
    offer: null,
  });

  it("won leaves close and enters onboarding; not yet goes to keep warm; met calls ask for a review", () => {
    const out = outcomeEmits([
      m(1, "won"),
      m(2, "not_yet"),
      m(3, "no_show"),
      m(4, "not_fit"),
      m(5, null),
    ]);
    expect(out.map((e) => [e.workflow, e.from, e.events.map((x) => x.subject)])).toEqual([
      ["close", "outcome.won", ["call:1"]],
      ["onboarding", "in.clients", ["call:1"]],
      ["close", "outcome.later", ["call:2"]],
      ["reviews.steps", "in.customers", ["customer:call:1", "customer:call:2", "customer:call:4"]],
    ]);
    expect(out[2]?.events[0]?.data).toMatchObject({ outcome: "not_yet", reason: "Budget" });
    // Review requests enter only where the client has them live; won is its own source.
    expect(out[3]?.onlyLive).toBe(true);
    expect(out[3]?.events.map((e) => e.data.source)).toEqual(["won", "done", "done"]);
  });
});

describe("booking on the spine", () => {
  it("a booked call enters close once per start; a cancel doesn't", () => {
    const a = bookedCall(7, "2026-10-05T14:00:00.000Z");
    expect(a.subject).toBe("call:7:2026-10-05T14:00:00.000Z");
    expect(bookingEmit({ id: 7, state: "booked", start: "2026-10-05T14:00:00Z" })).toMatchObject({
      workflow: "close",
      from: "in.calls",
    });
    expect(bookingEmit({ id: 7, state: "cancelled", start: null })).toBeNull();
    expect(briefPath(null, 7)).toBe("/inbox/calls/7");
    expect(briefPath("acme", 7)).toBe("/calls/calls/7");
  });
});

describe("settings", () => {
  it("{} is valid for both parts", () => {
    expect(briefSettingsOf({})).toEqual({ leadMinutes: 60, questions: true, ping: true });
    expect(outcomeSettingsOf({}).reasons.length).toBeGreaterThan(0);
    // A bad block falls back to the defaults rather than failing the call.
    expect(briefSettingsOf({ leadMinutes: 1 }).leadMinutes).toBe(60);
  });
});
