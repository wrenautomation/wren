import { describe, expect, it } from "vitest";
import { EVENT_KINDS } from "./components.js";
import {
  aboutOf,
  bucketOf,
  casesOf,
  doorOf,
  holdOf,
  KINDS,
  LOGIC,
  logicOf,
  logicProblems,
  logicSteps,
  nextSlot,
  shareOf,
  startWith,
  triggerHears,
  untilOf,
  untilOfFacts,
  untilsFreedBy,
  untilText,
} from "./logic.js";
import type { SpineEvent, StepAt } from "./spine.js";

const at = (node: string, w: Record<string, string | number>): StepAt => ({
  client: null,
  workflow: "f",
  node,
  with: w,
});
const ev = (subject: string, data: Record<string, unknown> = {}): SpineEvent => ({
  subject,
  kind: "lead",
  data,
});

describe("logic parts", () => {
  it("knows every event kind, and each part has an id, a name and ports", () => {
    expect([...KINDS].sort()).toEqual(Object.keys(EVENT_KINDS).sort());
    expect(new Set(LOGIC.map((l) => l.id)).size).toBe(LOGIC.length);
    for (const l of LOGIC) expect(l.ports(startWith(l)).out.length).toBeGreaterThan(0);
  });

  it("gives Switch a port per case and Split its shares", () => {
    expect(casesOf("Booked, Not now, booked, other,")).toEqual([
      { id: "booked", label: "Booked" },
      { id: "not_now", label: "Not now" },
    ]);
    const sw = logicOf("logic.switch")?.ports({ cases: "Booked, Not now", kind: "reply" });
    expect(sw?.out.map((p) => [p.id, p.kind])).toEqual([
      ["booked", "reply"],
      ["not_now", "reply"],
      ["other", "reply"],
    ]);
    expect(
      logicOf("logic.split")
        ?.ports({ a: 20 })
        .out.map((p) => p.label),
    ).toEqual(["A 20%", "B 80%"]);
    expect([shareOf(0), shareOf("x"), shareOf(99)]).toEqual([50, 50, 99]);
  });

  it("says what won't run", () => {
    const n = (uses: string, w: Record<string, string | number> = {}) =>
      logicProblems("f.n", { id: "n", uses, with: w });
    expect(n("logic.if")).toEqual(["f.n: If needs a rule"]);
    expect(n("logic.if", { when: "asked about price", kind: "lead" })).toEqual([]);
    expect(n("logic.switch", { field: "stage", cases: "" })).toEqual([
      "f.n: Switch reads a field like data.stage",
      "f.n: Switch needs a case",
    ]);
    expect(n("logic.wait", { for: "soon" })).toEqual(['f.n: a wait reads like "2 days"']);
    expect(n("logic.split", { a: 120 })).toEqual(["f.n: Split's share is 1 to 99"]);
    expect(n("trigger.schedule")).toEqual([]);
    expect(n("trigger.schedule", { every: "day", at: "9am", zone: "Mars/Base" })).toEqual([
      "f.n: a time reads like 09:00",
      "f.n: Mars/Base is no time zone (like America/Chicago)",
    ]);
    expect(n("trigger.schedule", { every: "hours", hours: 0 })).toEqual([
      "f.n: every 1 to 168 hours",
    ]);
    expect(n("trigger.form", { form: "nope" })).toEqual(["f.n: no form called nope"]);
    expect(n("logic.merge", { kind: "nope" })).toEqual(["f.n: nope is no event kind"]);
    expect(n("x.part")).toEqual([]);
    expect(holdOf({ id: "w", uses: "logic.wait", with: {} })).toBe("1 day");
    expect(holdOf({ id: "w", uses: "logic.if" })).toBeUndefined();
  });

  it("waits a time, or until an event with a most", () => {
    const wait = logicOf("logic.wait");
    const until = { mode: "until", until: "reply", most: "3 days", kind: "lead" };
    expect(wait?.says({ for: "2 days" })).toBe("Wait 2 days");
    expect(wait?.says(until)).toBe("Until a reply or 3 days");
    expect(wait?.says({ ...until, until: "booking" })).toBe("Until a booking or 3 days");
    expect(wait?.ports(until).out.map((p) => [p.id, p.label])).toEqual([
      ["out", "replied"],
      ["timeout", "time ran out"],
    ]);
    expect(wait?.ports({}).out.map((p) => p.id)).toEqual(["out"]);
    const n = (w: Record<string, string | number>) => ({ id: "w", uses: "logic.wait", with: w });
    expect(holdOf(n(until))).toBeUndefined();
    expect(untilOf(n(until))).toEqual({ until: "reply", most: "3 days" });
    expect(untilOf(n({ for: "2 days" }))).toBeUndefined();
    expect(logicProblems("f.w", n(until))).toEqual([]);
    expect(logicProblems("f.w", n({ ...until, until: "rain", most: "soon" }))).toEqual([
      "f.w: a Wait can't wait until rain",
      'f.w: at most reads like "3 days"',
    ]);
    expect(logicProblems("f.w", n({ mode: "later" }))).toEqual([
      "f.w: a Wait waits a time or until something happens",
    ]);
    // Only what the mode uses shows in the panel.
    expect(
      wait?.settings.filter((s) => !s.shows || s.shows.mode === "until").map((s) => s.field),
    ).toEqual(["mode", "until", "most", "kind"]);
    expect(untilText("booking")).toBe("Waits for a booking");
    // A reply or a booking: either one lets it go, by `answered`.
    const answer = { ...until, until: "answer" };
    expect(wait?.says(answer)).toBe("Until an answer or 3 days");
    expect(wait?.ports(answer).out.map((p) => [p.id, p.label])).toEqual([
      ["out", "answered"],
      ["timeout", "time ran out"],
    ]);
    expect(logicProblems("f.w", n(answer))).toEqual([]);
    expect(untilsFreedBy("reply")).toEqual(["reply", "answer"]);
    expect(untilsFreedBy("booking")).toEqual(["booking", "answer"]);
    expect(untilsFreedBy("cancelled")).toEqual(["cancelled"]);
    expect(untilText(null)).toBeNull();
  });

  it("finds what a subject is about, as a fired event says it", () => {
    expect(aboutOf("lead:sms:42")).toBe("sms:42");
    expect(aboutOf("reply:sms:42")).toBe("sms:42");
    expect(aboutOf("lead:Sam@Example.com")).toBe("sam@example.com");
    expect(untilOfFacts({ trigger: "trigger.reply", channel: "dm" })).toBe("reply");
    expect(untilOfFacts({ trigger: "trigger.booking", change: "booked" })).toBe("booking");
    expect(untilOfFacts({ trigger: "trigger.booking", change: "cancelled" })).toBe("cancelled");
    expect(untilOfFacts({ trigger: "trigger.flag", change: "raised", side: "risk" })).toBeNull();
  });
});

describe("logic steps", () => {
  const steps = logicSteps(async (when) => when === "yes please");

  it("If asks the rule; Switch reads its field", async () => {
    expect(
      (await steps["logic.if"]?.("in", ev("a"), at("n", { when: "yes please" })))?.[0]?.port,
    ).toBe("yes");
    expect((await steps["logic.if"]?.("in", ev("a"), at("n", { when: "no" })))?.[0]?.port).toBe(
      "no",
    );
    const sw = at("n", { field: "data.stage", cases: "Booked, Not now" });
    expect(
      (await steps["logic.switch"]?.("in", ev("a", { stage: "not now" }), sw))?.[0]?.port,
    ).toBe("not_now");
    expect((await steps["logic.switch"]?.("in", ev("a", { stage: "lost" }), sw))?.[0]?.port).toBe(
      "other",
    );
  });

  it("If asks the rule as the node's client, whose model share answers it", async () => {
    const asked: (string | null | undefined)[] = [];
    const mine = logicSteps(async (_when, _e, client) => {
      asked.push(client);
      return true;
    });
    await mine["logic.if"]?.("in", ev("a"), { ...at("n", { when: "w" }), client: "acme" });
    await mine["logic.if"]?.("in", ev("a"), at("n", { when: "w" }));
    expect(asked).toEqual(["acme", null]);
  });

  it("Split sends a subject the same way every time, near its share", async () => {
    expect(bucketOf("lead:1", "ab")).toBe(bucketOf("lead:1", "ab"));
    let a = 0;
    for (let i = 0; i < 1000; i++) {
      const out = await steps["logic.split"]?.("in", ev(`lead:${i}`), at("ab", { a: 30 }));
      if (out?.[0]?.port === "a") a++;
    }
    expect(a).toBeGreaterThan(240);
    expect(a).toBeLessThan(360);
  });
});

describe("triggers", () => {
  it("are all ready", () => {
    expect(LOGIC.filter((l) => !l.ready).map((l) => l.id)).toEqual([]);
  });

  it("set a day's slot in its zone, across a DST change", () => {
    const w = { every: "day", at: "09:00", zone: "America/New_York" };
    // 13:00Z is 09:00 in New York on summer time.
    expect(nextSlot(w, new Date("2026-10-07T12:00:00Z"))?.toISOString()).toBe(
      "2026-10-07T13:00:00.000Z",
    );
    expect(nextSlot(w, new Date("2026-10-07T13:00:00Z"))?.toISOString()).toBe(
      "2026-10-08T13:00:00.000Z",
    );
    // Clocks go back on 2026-11-01: 09:00 is 14:00Z after.
    expect(nextSlot(w, new Date("2026-10-31T13:30:00Z"))?.toISOString()).toBe(
      "2026-11-01T14:00:00.000Z",
    );
    expect(nextSlot({ ...w, zone: "Mars/Base" }, new Date())).toBeNull();
  });

  it("set every few hours on the hour", () => {
    const w = { every: "hours", hours: 4 };
    expect(nextSlot(w, new Date("2026-10-07T05:30:00Z"))?.toISOString()).toBe(
      "2026-10-07T08:00:00.000Z",
    );
    expect(nextSlot(w, new Date("2026-10-07T08:00:00Z"))?.toISOString()).toBe(
      "2026-10-07T12:00:00.000Z",
    );
    expect(nextSlot({ every: "hours" }, new Date())).toBeNull();
  });

  it("hear a reply or booking by their settings", () => {
    const reply = (channel?: string) => ({
      id: "r",
      uses: "trigger.reply",
      with: channel ? { channel } : {},
    });
    const sms = { trigger: "trigger.reply", channel: "sms" } as const;
    expect(triggerHears(reply(), sms)).toBe(true);
    expect(triggerHears(reply("sms"), sms)).toBe(true);
    expect(triggerHears(reply("email"), sms)).toBe(false);
    const booking = (on?: string) => ({ id: "b", uses: "trigger.booking", with: on ? { on } : {} });
    const cancelled = { trigger: "trigger.booking", change: "cancelled" } as const;
    expect(triggerHears(booking(), cancelled)).toBe(false);
    expect(triggerHears(booking("cancelled"), cancelled)).toBe(true);
    expect(triggerHears(booking("any"), cancelled)).toBe(true);
    expect(triggerHears(reply(), cancelled)).toBe(false);
    const flag = (w: Record<string, string> = {}) => ({ id: "f", uses: "trigger.flag", with: w });
    const raised = { trigger: "trigger.flag", change: "raised", side: "risk" } as const;
    const cleared = { ...raised, change: "cleared" } as const;
    expect(triggerHears(flag(), raised)).toBe(true);
    expect(triggerHears(flag(), cleared)).toBe(false);
    expect(triggerHears(flag({ on: "any", side: "opportunity" }), cleared)).toBe(false);
    expect(triggerHears(flag({ on: "cleared", side: "risk" }), cleared)).toBe(true);
    expect(logicOf("trigger.flag")?.says({ on: "any", side: "risk" })).toBe(
      "A risk raised or cleared",
    );
  });

  it("give a Form its door: a known form's shape, else by email and its map", () => {
    expect(doorOf({ id: "f", uses: "trigger.form", with: { form: "site" } })).toMatchObject({
      subject: "id",
      fields: { consent: "sms_consent" },
    });
    expect(
      doorOf({ id: "f", uses: "trigger.form", with: { form: "any", "map.email": "contact.mail" } }),
    ).toEqual({ subject: "contact.mail", fields: { email: "contact.mail" } });
  });
});
