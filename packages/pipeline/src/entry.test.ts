import { describe, expect, it } from "vitest";
import { entryOf, entryStages, entryTo } from "./entry.js";
import type { FunnelBody } from "./model.js";

const body = (entries: FunnelBody["entries"]): FunnelBody => ({
  name: "Test",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [] },
    { key: "booked", label: "Booked", on: [] },
    { key: "signed", label: "Signed", sale: true, on: [] },
  ],
  entries,
});

const ENTRIES: FunnelBody["entries"] = [
  { id: "yt", kind: "organic", channel: "youtube" },
  { id: "ad_a", kind: "ads", channel: "meta", campaign: "camp-1" },
  { id: "ad_any", kind: "ads", channel: "meta" },
  { id: "list", kind: "sourced", source: "list-1" },
  { id: "seg", kind: "group", group: "q-1" },
  { id: "other", kind: "funnel", funnel: { id: "b", at: "paid" }, to: "booked" },
  { id: "loose", kind: "organic" },
];

describe("entryOf", () => {
  const b = body(ENTRIES);

  it("takes the entry the cause names", () => {
    expect(entryOf(b, { entry: "seg", channel: "youtube" }).id).toBe("seg");
  });

  it("matches the first entry by channel and campaign", () => {
    expect(entryOf(b, { channel: "YouTube" }).id).toBe("yt");
    expect(entryOf(b, { channel: "meta", campaign: "camp-1" }).id).toBe("ad_a");
    // Priority order: ad_a needs its campaign, so a bare Meta cause falls to ad_any.
    expect(entryOf(b, { channel: "meta" }).id).toBe("ad_any");
    expect(entryOf(b, { channel: "meta", campaign: "camp-2" }).id).toBe("ad_any");
  });

  it("matches a sourced, group or funnel cause", () => {
    expect(entryOf(b, { source: "list-1" }).id).toBe("list");
    expect(entryOf(b, { group: "q-1" }).id).toBe("seg");
    expect(entryOf(b, { funnel: "b", stage: "paid" }).id).toBe("other");
    expect(entryOf(b, { funnel: "b", stage: "other" }).id).toBe("manual");
  });

  it("never matches an entry with no channel and no campaign", () => {
    expect(entryOf(b, { channel: "tiktok" }).id).toBe("manual");
  });

  it("falls back to the first touch, then to manual", () => {
    expect(entryOf(b, {}, { channel: "youtube" }).id).toBe("yt");
    expect(entryOf(b, { channel: "meta" }, { channel: "youtube" }).id).toBe("ad_any");
    expect(entryOf(b, {}, null)).toEqual({ id: "manual", kind: "manual" });
    expect(entryOf(b, {}, { channel: "tiktok" })).toEqual({ id: "manual", kind: "manual" });
  });

  it("uses the body's own manual entry when it has one", () => {
    const own = body([{ id: "hand", kind: "manual", to: "booked" }]);
    expect(entryOf(own, {}).id).toBe("hand");
  });
});

describe("entryStages", () => {
  it("is each entry's stage, the first by default", () => {
    expect(entryStages(body(ENTRIES))).toEqual(["engaged", "booked"]);
    expect(entryStages(body([{ id: "x", kind: "manual", to: "signed" }]))).toEqual(["signed"]);
  });

  it("is the first stage when there are no entries", () => {
    expect(entryStages(body([]))).toEqual(["engaged"]);
  });

  it("is nothing without stages", () => {
    expect(entryStages({ ...body([]), stages: [] })).toEqual([]);
  });

  it("names where an entry opens", () => {
    const b = body(ENTRIES);
    expect(entryTo(b, ENTRIES[0] as FunnelBody["entries"][number])).toBe("engaged");
    expect(entryTo(b, ENTRIES[5] as FunnelBody["entries"][number])).toBe("booked");
  });
});
