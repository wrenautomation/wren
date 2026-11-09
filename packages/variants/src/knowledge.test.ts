import type { GuideRow } from "@wrenautomation/vireo";
import { describe, expect, it } from "vitest";
import { type KeptRow, keptVerdict, lockedVerdict, verdictChanges } from "./knowledge.js";

const KEPT = new Date("2026-11-01T10:00:00.000Z");
const kept = (over: Partial<KeptRow["sample"]> = {}): KeptRow => ({
  sample: {
    id: 4,
    batchId: 2,
    subjectId: 1,
    position: 0,
    body: "3x replies in a week",
    media: null,
    poster: null,
    source: null,
    name: null,
    guides: [1],
    change: "number first",
    agent: "agent-a",
    score: 9,
    verdict: "amazing",
    keptAt: KEPT,
    createdAt: KEPT,
    ...over,
  } as KeptRow["sample"],
  subject: { slug: "hero", name: "Hero line", kind: "text" },
  batch: { n: 3, title: "Openers", why: "number vs story", note: null },
  parents: [{ id: 1, took: "the number" }],
  notes: [],
});
const guide = {
  id: 1,
  text: "Lead with one number",
  source: "person",
  ref: null,
  subjectId: 1,
  kind: null,
  state: "locked",
  by: "ana",
  decidedAt: KEPT,
  createdAt: KEPT,
  effect: { with: 0.8, without: 0.3 },
} as unknown as GuideRow & { effect: unknown };

describe("Vireo verdicts", () => {
  it("adds a keep and a lock, edits a changed score, reruns as a no-op, retires an un-keep", () => {
    const want = [keptVerdict(kept()), lockedVerdict(guide, "hero")];
    const adds = verdictChanges(new Map(), want);
    expect(adds).toMatchObject([
      { op: "add", type: "verdict", from: "vireo", ref: "hero:3", sample: 4, score: 9 },
      { op: "add", type: "verdict", from: "vireo", ref: "guide:1", scope: "hero" },
    ]);
    expect(adds[0]).toMatchObject({ title: "Hero line: 3x replies in a week" });

    const have = new Map(
      adds.map((c) => {
        const { op: _op, body, ...fm } = c as Record<string, unknown>;
        return [fm.id as string, { fm: { ...fm, status: "live" }, body: body as string }];
      }),
    );
    expect(verdictChanges(have, want)).toEqual([]);

    const rescored = [keptVerdict(kept({ score: 10 })), want[1]] as typeof want;
    const [edit] = verdictChanges(have, rescored);
    expect(edit).toEqual({ op: "edit", id: adds[0]?.id, score: 10 });

    expect(verdictChanges(have, [want[1]] as typeof want)).toEqual([
      { op: "retire", id: adds[0]?.id },
    ]);
  });

  it("makes a re-keep a new record beside the retired one", () => {
    const first = verdictChanges(new Map(), [keptVerdict(kept())]);
    const id = first[0]?.id as string;
    const have = new Map([
      [
        id,
        {
          fm: {
            id,
            type: "verdict",
            from: "vireo",
            sample: 4,
            keptAt: KEPT.toISOString(),
            status: "retired",
          },
          body: "",
        },
      ],
    ]);
    const again = verdictChanges(have, [
      keptVerdict(kept({ keptAt: new Date("2026-11-05T00:00:00.000Z") })),
    ]);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ op: "add" });
    expect(again[0]?.id).not.toBe(id);
  });
});
