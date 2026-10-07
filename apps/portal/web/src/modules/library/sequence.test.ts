// A sequence drawn on the graph kit, and its picks in words (sequenceGraph, picksText).
import { describe, expect, it } from "vitest";
import { picksText, replyRate, type SeqStep, sequenceGraph } from "./sequence.js";

const step = (n: number, more: Partial<SeqStep> = {}): SeqStep => ({
  node: `s${n}`,
  step: n,
  wait: n === 1 ? null : "3 days",
  touch: "email.touch",
  kind: "email",
  system: "demo",
  template: `plain/step-${n}`,
  templateId: String(n),
  liveVersion: 3,
  sends: 40,
  replies: 3,
  booked: 1,
  variants: [],
  ...more,
});

describe("sequenceGraph", () => {
  it("draws leads in, then each step, the wait on the wire before it", () => {
    const g = sequenceGraph(
      [step(1, { variants: [{ picks: { s: 1 }, sends: 20, replies: 2 }] }), step(2)],
      (s) => `/t/${s.templateId}`,
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["in", "s1", "s2"]);
    expect(g.edges).toEqual([
      { from: "in", to: "s1", label: "right away", wait: undefined },
      { from: "s1", to: "s2", label: undefined, wait: "3 days" },
    ]);
    expect(g.nodes[1]).toMatchObject({
      href: "/t/1",
      number: { value: 40, label: "sent" },
      more: { value: 3, label: "replied, 7.5% · 1 booked" },
      lines: [{ text: "s: option 2: 10% replied" }],
    });
  });

  it("dims a step with nothing live", () => {
    const g = sequenceGraph([step(1, { liveVersion: null, sends: 0 })], () => undefined);
    expect(g.nodes[1]).toMatchObject({ dim: true, more: undefined });
    expect(g.nodes[1]?.note).toContain("nothing live");
  });
});

describe("picksText", () => {
  it("reads picks from jsonb or text", () => {
    expect(picksText({ s: 0, cta: 2 })).toBe("s: option 1, cta: option 3");
    expect(picksText('{"s": 1}')).toBe("s: option 2");
    expect(picksText({})).toBe("One version");
    expect(replyRate(0, 0)).toBe("");
  });
});
