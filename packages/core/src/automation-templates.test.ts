import { describe, expect, it } from "vitest";
import { AUTOMATION_TEMPLATES, templateOf } from "./automation-templates.js";
import { dryWalk } from "./dry.js";
import { logicProblems } from "./logic.js";
import { flowsWith, madeBase } from "./workflows.js";

const made = (id: string) => {
  const t = templateOf(id);
  if (!t) throw new Error(`no template ${id}`);
  const m = { name: t.name, blurb: t.blurb, for: "wren" as const };
  const wid = `made.${id}`;
  const got = flowsWith(
    [madeBase(wid, m)],
    { [wid]: { wires: t.wires, steps: t.nodes, made: m } },
    [],
  );
  return { t, wid, got };
};
const problems = (id: string) =>
  (templateOf(id)?.nodes ?? []).flatMap((n) => logicProblems(n.id, n));

describe("automation templates", () => {
  it("every graph wires up as a made workflow; segment waits on its segment and subject", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const { got, wid } = made(t.id);
      const broken = got.broken[wid] ?? [];
      if (t.id === "segment_message")
        expect(broken).toEqual(problems(t.id).map((p) => `${wid}.${p}`));
      else expect(broken, t.id).toEqual([]);
      expect(got.flows.find((f) => f.id === wid)?.nodes.length).toBe(
        broken.length ? 0 : t.nodes.length,
      );
    }
  });

  it("lead and booking publish as they are; segment asks for its segment and subject", () => {
    expect(problems("lead_follow_up")).toEqual([]);
    expect(problems("booking_confirm")).toEqual([]);
    expect(problems("segment_message").join(" ")).toMatch(/segment's number/);
    expect(problems("segment_message").join(" ")).toMatch(/needs a subject/);
  });

  it("a dry run pings, waits out the answer, then would email: nothing sends", async () => {
    const { got, wid } = made("lead_follow_up");
    const r = await dryWalk({
      flows: new Map(got.flows.map((f) => [f.id, f])),
      parts: new Map(),
      workflow: wid,
      from: "form.out",
      client: null,
      events: [
        {
          subject: "lead:door:sam@example.com",
          kind: "form",
          data: { lead: { name: "Sam Test", email: "sam@example.com" } },
        },
      ],
    });
    const would = r.steps.map((s) => s.would).filter(Boolean);
    expect(would[0]).toBe('Would ping the team: "New lead: Sam Test sam@example.com"');
    expect(would[1]).toMatch(/^Would email sam@example.com on newsletter/);
    expect(r.steps.find((s) => s.node === "wait")?.until).toBe("answer");
  });
});
