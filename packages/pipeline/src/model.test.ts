import { describe, expect, it } from "vitest";
import { checkFunnel, type FunnelBody, type FunnelContext } from "./model.js";

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Test",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.touch" }] },
    {
      key: "booked",
      label: "Booked",
      on: [{ trigger: "trigger.booking", with: { change: "booked" } }],
    },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [{ id: "web", kind: "organic", channel: "web" }],
  ...over,
});

const ctx = (over: Partial<FunnelContext> = {}): FunnelContext => ({
  id: "main",
  triggers: new Set(["trigger.touch", "trigger.booking", "trigger.document"]),
  funnel: (id) => (id === "other" ? { stages: ["a", "b"], sale: "b" } : undefined),
  group: (id) => (id === "7" ? { active: true } : id === "8" ? { active: false } : undefined),
  feeds: {},
  ...over,
});

describe("checkFunnel", () => {
  it("accepts a good first version and an append", () => {
    expect(checkFunnel(null, body(), ctx())).toEqual([]);
    const next = body({
      stages: [...body().stages, { key: "paying", label: "Paying", on: [] }],
    });
    expect(checkFunnel(body(), next, ctx())).toEqual([]);
  });

  it("lets labels and rules change but not keys", () => {
    const next = body();
    next.stages[0] = { key: "engaged", label: "New label", on: [] };
    expect(checkFunnel(body(), next, ctx())).toEqual([]);
  });

  it("refuses a removed, moved or renamed stage", () => {
    const removed = body({ stages: body().stages.slice(1) });
    expect(checkFunnel(body(), removed, ctx()).join("\n")).toMatch(/Stage 1 must stay "engaged"/);
    const renamed = body();
    renamed.stages[1] = { key: "booked2", label: "Booked", on: [] };
    expect(checkFunnel(body(), renamed, ctx()).join("\n")).toMatch(/must stay "booked"/);
    const shorter = body({ stages: body().stages.slice(0, 2) });
    expect(checkFunnel(body(), shorter, ctx()).join("\n")).toMatch(
      /Stage "signed" cannot be removed/,
    );
  });

  it("needs exactly one sale stage", () => {
    const none = body();
    none.stages[2] = { key: "signed", label: "Signed", on: [] };
    expect(checkFunnel(null, none, ctx())).toEqual([
      "The funnel needs exactly one sale stage, not 0.",
    ]);
    const two = body();
    two.stages[0] = { key: "engaged", label: "Engaged", sale: true, on: [] };
    expect(checkFunnel(null, two, ctx())).toEqual([
      "The funnel needs exactly one sale stage, not 2.",
    ]);
  });

  it("refuses a bad or repeated key", () => {
    const bad = body();
    bad.stages[0] = { key: "Engaged-1", label: "x", on: [] };
    expect(checkFunnel(null, bad, ctx()).join("\n")).toMatch(/"Engaged-1" must be lowercase/);
    const twice = body();
    twice.stages[1] = { key: "engaged", label: "x", on: [] };
    expect(checkFunnel(null, twice, ctx()).join("\n")).toMatch(/"engaged" is used twice/);
  });

  it("keeps the key dropped for drops", () => {
    const next = body();
    next.stages[0] = { key: "dropped", label: "x", on: [] };
    expect(checkFunnel(null, next, ctx()).join("\n")).toMatch(/"dropped" is reserved/);
  });

  it("refuses an offer change", () => {
    expect(checkFunnel(body(), body({ offer: "offer-b" }), ctx()).join("\n")).toMatch(
      /offer cannot change/,
    );
  });

  it("refuses an unknown trigger", () => {
    const next = body();
    next.stages[0] = { key: "engaged", label: "x", on: [{ trigger: "trigger.nope" }] };
    expect(checkFunnel(null, next, ctx())).toEqual([
      'Stage "engaged" uses "trigger.nope", which is not a known trigger.',
    ]);
  });

  it("checks funnel entries", () => {
    const ok = body({
      entries: [
        { id: "from_other", kind: "funnel", funnel: { id: "other", at: "b" }, to: "booked" },
      ],
    });
    expect(checkFunnel(null, ok, ctx())).toEqual([]);
    const noFunnel = body({
      entries: [{ id: "x", kind: "funnel", funnel: { id: "gone", at: "b" } }],
    });
    expect(checkFunnel(null, noFunnel, ctx()).join("\n")).toMatch(
      /funnel "gone", which does not exist/,
    );
    const noStage = body({
      entries: [{ id: "x", kind: "funnel", funnel: { id: "other", at: "zzz" } }],
    });
    expect(checkFunnel(null, noStage, ctx()).join("\n")).toMatch(
      /stage "zzz", which "other" does not have/,
    );
    const noTarget = body({ entries: [{ id: "x", kind: "funnel" }] });
    expect(checkFunnel(null, noTarget, ctx()).join("\n")).toMatch(/names no funnel/);
    const badTo = body({ entries: [{ id: "x", kind: "manual", to: "zzz" }] });
    expect(checkFunnel(null, badTo, ctx()).join("\n")).toMatch(/opens at "zzz"/);
  });

  it("checks sourced and group entries and research", () => {
    const ok = body({
      entries: [
        { id: "list", kind: "sourced", source: "list-1" },
        { id: "seg", kind: "group", group: "7" },
      ],
    });
    ok.stages[0] = { ...ok.stages[0], research: "light" } as FunnelBody["stages"][number];
    expect(checkFunnel(null, ok, ctx())).toEqual([]);
    const noSource = body({ entries: [{ id: "list", kind: "sourced" }] });
    expect(checkFunnel(null, noSource, ctx()).join("\n")).toMatch(
      /kind sourced but names no source/,
    );
    const noGroup = body({ entries: [{ id: "seg", kind: "group" }] });
    expect(checkFunnel(null, noGroup, ctx()).join("\n")).toMatch(/kind group but names no group/);
    const bad = body();
    bad.stages[1] = {
      ...bad.stages[1],
      research: "deep",
    } as unknown as FunnelBody["stages"][number];
    expect(checkFunnel(null, bad, ctx()).join("\n")).toMatch(/research "deep"/);
  });

  it("refuses a group entry whose group is unknown, archived or not a number", () => {
    const entry = (group: string) => body({ entries: [{ id: "seg", kind: "group", group }] });
    expect(checkFunnel(null, entry("9"), ctx()).join("\n")).toMatch(
      /group 9, which does not exist/,
    );
    expect(checkFunnel(null, entry("8"), ctx()).join("\n")).toMatch(/group 8, which is archived/);
    expect(checkFunnel(null, entry("q-1"), ctx()).join("\n")).toMatch(/not a group's number/);
    expect(checkFunnel(null, entry("7"), ctx())).toEqual([]);
  });

  it("refuses a loop of funnels", () => {
    const self = body({
      entries: [{ id: "x", kind: "funnel", funnel: { id: "main", at: "signed" } }],
    });
    expect(checkFunnel(null, self, ctx()).join("\n")).toMatch(/main -> main/);
    // other already takes entries from main; main now takes entries from other.
    const loop = body({ entries: [{ id: "x", kind: "funnel", funnel: { id: "other", at: "b" } }] });
    expect(checkFunnel(null, loop, ctx({ feeds: { other: ["main"] } })).join("\n")).toMatch(
      /main -> other -> main/,
    );
    // A chain with no loop is fine.
    expect(checkFunnel(null, loop, ctx({ feeds: { other: [] } }))).toEqual([]);
  });
});
