// Play's walk, waits and filled copy (walkOf, beatOf, dayOf, fill, sideOf).
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import { beatOf, dayOf, fill, sideOf, waitOf, walkOf } from "./play.js";

const node = (id: string, uses = `x.${id}`) => ({
  id,
  uses,
  name: id,
  note: null,
  ready: "ready" as const,
});
const w: Drawn = {
  id: "out",
  name: "Outbound",
  in: [{ id: "leads", label: "leads", kind: "lead" }] as Drawn["in"],
  out: [{ id: "booked", label: "Booked call", kind: "call" }] as Drawn["out"],
  nodes: [node("mail", "email.sequence"), node("text", "sms.sequence"), node("reply", "replies")],
  wires: [
    { from: "in.leads", to: "mail.leads", via: "code", label: "leads" },
    { from: "mail.quiet", to: "mail.leads", via: "code", label: "never replied", wait: "3 days" },
    { from: "mail.quiet", to: "text.leads", via: "code", label: "quiet", wait: "4 days" },
    { from: "mail.replied", to: "reply.in", via: "code", label: "replied" },
    { from: "text.replied", to: "reply.in", via: "code", label: "replied", wait: "2 hours" },
    { from: "reply.booked", to: "out.booked", via: "events", label: "booked" },
  ] as Drawn["wires"],
};

describe("walkOf", () => {
  const steps = walkOf(w);

  it("takes the longest way in to out, skipping loops back to a card", () => {
    expect(steps.map((s) => s.box)).toEqual(["in.leads", "mail", "text", "reply", "out.booked"]);
  });

  it("names each step, its wire and wait", () => {
    expect(steps[2]).toMatchObject({ edge: "mail>text", wait: "4 days", uses: "sms.sequence" });
    expect(steps[0]).toMatchObject({ label: "leads", edge: null, wait: null });
    expect(steps.at(-1)?.label).toBe("Booked call");
  });

  it("walks nothing when nothing is wired", () => {
    expect(walkOf({ ...w, wires: [] }).map((s) => s.box)).toEqual(["in.leads"]);
  });
});

describe("waits", () => {
  it("reads written waits and cuts them to seconds", () => {
    expect(waitOf("3 days")).toBe(3 * 24 * 3_600_000);
    expect(waitOf("2h")).toBe(2 * 3_600_000);
    expect(waitOf("when they reply")).toBeNull();
    expect(beatOf(null)).toBe(1400);
    expect(beatOf("3 days")).toBeGreaterThan(beatOf("2 hours"));
    expect(beatOf("52 weeks")).toBeLessThanOrEqual(3600);
  });

  it("counts days from the start", () => {
    expect(dayOf([null, "3 days", "4 days", "2 hours"])).toBe("Day 7");
  });
});

describe("fill", () => {
  it("puts the made-up lead in, with fallbacks", () => {
    expect(fill("Hi {first_name|there}, {company_short} and {nope|you}.")).toBe(
      "Hi Sam, Northwind and you.",
    );
    expect(fill("«first name» at «company»")).toBe("Sam at Northwind Staffing");
  });
});

describe("sideOf", () => {
  it("reads the lead's own side off what a step uses", () => {
    expect(sideOf("email.replies", "Replies")).toBe("reply");
    expect(sideOf(null, "Booked call")).toBe("booking");
    expect(sideOf("email.sequence", "mail")).toBeNull();
  });
});
