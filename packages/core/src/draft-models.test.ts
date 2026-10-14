import { describe, expect, it } from "vitest";
import {
  type ArmRow,
  armLabel,
  armOf,
  DEFAULT_ARMS,
  draftModelsSchema,
  editChars,
  MIN_DECIDED_PER_ARM,
  type ScoredDraft,
  scoreArms,
  verdict,
} from "./draft-models.js";

const ids = Array.from({ length: 2000 }, (_, i) => `thread:t3_${i.toString(36)}`);

describe("armOf", () => {
  it("gives an item the same arm every time", () => {
    for (const id of ids.slice(0, 50))
      expect(armOf(id, DEFAULT_ARMS)).toBe(armOf(id, DEFAULT_ARMS));
  });

  it("splits near the weights", () => {
    const n = ids.filter((id) => armOf(id, DEFAULT_ARMS).model === "cohere").length;
    expect(n).toBeGreaterThan(900);
    expect(n).toBeLessThan(1100);
    const skew = ids.filter(
      (id) =>
        armOf(id, [
          { model: "a", weight: 1 },
          { model: "b", weight: 3 },
        ]).model === "a",
    ).length;
    expect(skew).toBeGreaterThan(400);
    expect(skew).toBeLessThan(600);
  });

  it("with one arm always picks it", () => {
    expect(armOf("x", [{ model: "only", weight: 1 }]).model).toBe("only");
  });
});

describe("draftModelsSchema", () => {
  it("takes one to four distinct models", () => {
    expect(draftModelsSchema.safeParse({ arms: DEFAULT_ARMS }).success).toBe(true);
    expect(draftModelsSchema.safeParse({ arms: [] }).success).toBe(false);
    const twice = [
      { model: "cohere", weight: 1 },
      { model: "cohere", weight: 1 },
    ];
    expect(draftModelsSchema.safeParse({ arms: twice }).success).toBe(false);
    expect(draftModelsSchema.safeParse({ arms: [{ model: "a", weight: 0 }] }).success).toBe(false);
  });
});

describe("armLabel", () => {
  it("names the two default arms the way William reads them", () => {
    expect(armLabel("gateway:free")).toBe("Gemini 3.8 Flash");
    expect(armLabel("cohere:command-a-03-2025")).toBe("Command A");
  });
});

describe("editChars", () => {
  it("counts characters changed", () => {
    expect(editChars("same", " same ")).toBe(0);
    expect(editChars("cat", "cut")).toBe(1);
    expect(editChars("", "abc")).toBe(3);
    expect(editChars("kitten", "sitting")).toBe(3);
  });
});

const draft = (
  by: string,
  end: ScoredDraft["end"],
  extra: Partial<ScoredDraft> = {},
): ScoredDraft => ({
  item: "comment:1",
  by,
  armed: true,
  written: "Ask which step they drop at.",
  end,
  ...extra,
});
const same = { is: "approved", text: "Ask which step they drop at." } as const;

describe("scoreArms", () => {
  it("counts each arm's endings", () => {
    const rows = scoreArms(
      [
        draft("a", same, { proof: "live", replies: 1 }),
        draft(
          "a",
          { is: "approved", text: "Ask which step they drop off at." },
          { proof: "hidden" },
        ),
        draft("a", { is: "rejected" }),
        draft("a", { is: "open" }),
        draft("b", same, { replies: 0 }),
      ],
      [
        { by: "a", outcome: "dropped" },
        { by: "b", outcome: "redrafted" },
      ],
    );
    const a = rows.find((r) => r.by === "a");
    expect(a).toMatchObject({
      generated: 4,
      approvedUnedited: 1,
      approvedEdited: 1,
      rejected: 1,
      open: 1,
      dropped: 1,
      decided: 3,
      proof: { live: 1, hidden: 1, missing: 0 },
      replied: 1,
      repliable: 1,
    });
    expect(a?.uneditedRate).toBeCloseTo(1 / 3);
    expect(a?.editChars).toBe(4);
    expect(rows.find((r) => r.by === "b")).toMatchObject({
      generated: 1,
      redrafted: 1,
      repliable: 1,
      replied: 0,
    });
  });

  it("keeps drafts outside the test apart", () => {
    const rows = scoreArms([draft("a", same), draft("a", same, { armed: false })]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => !r.armed)?.label).toContain("outside the test");
  });
});

const row = (by: string, decided: number, unedited: number, armed = true): ArmRow => ({
  by,
  armed,
  label: by,
  generated: decided,
  approvedUnedited: unedited,
  approvedEdited: decided - unedited,
  rejected: 0,
  open: 0,
  dropped: 0,
  redrafted: 0,
  editChars: null,
  editShare: null,
  proof: { live: 0, hidden: 0, missing: 0 },
  replied: 0,
  repliable: 0,
  uneditedRate: decided ? unedited / decided : null,
  decided,
});

describe("verdict", () => {
  const N = MIN_DECIDED_PER_ARM;
  it("waits for two arms", () => {
    expect(verdict([row("a", N, 30)]).winner).toBeNull();
  });
  it("waits for enough decided drafts on each", () => {
    const v = verdict([row("a", N, 30), row("b", N - 1, 5)]);
    expect(v.winner).toBeNull();
    expect(v.says).toContain("Too early");
  });
  it("names a winner at a 10 point gap", () => {
    expect(verdict([row("a", 50, 30), row("b", 50, 20)]).winner).toBe("a");
    expect(verdict([row("a", 50, 20), row("b", 50, 30)]).winner).toBe("b");
  });
  it("calls a smaller gap no clear winner", () => {
    const v = verdict([row("a", 50, 30), row("b", 50, 26)]);
    expect(v.winner).toBeNull();
    expect(v.says).toContain("No clear winner");
  });
  it("ignores drafts outside the test", () => {
    expect(verdict([row("a", 50, 30), row("b", 50, 10, false)]).winner).toBeNull();
  });
});
