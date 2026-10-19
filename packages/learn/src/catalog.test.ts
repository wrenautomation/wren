import { describe, expect, it } from "vitest";
import { type CatalogRead, catalogSummary } from "./catalog.js";

const read = (id: number, o: Partial<CatalogRead> = {}): CatalogRead => ({
  id,
  read: "read",
  verdict: "hold",
  why: null,
  seconds: 60,
  ...o,
});

describe("catalogSummary", () => {
  it("counts what the pass did, by read and by verdict", () => {
    const reads = [
      read(1, { verdict: "show" }),
      read(2),
      read(3, { verdict: "drop" }),
      read(4, { verdict: null, why: "score: model down" }),
      read(5, { read: "failed", verdict: null, why: "yt-dlp timed out after 300s" }),
      read(6, { read: "waits", verdict: null }),
    ];
    expect(catalogSummary(reads, 412, null)).toEqual({
      read: 4,
      failed: 1,
      waits: 1,
      unscored: 1,
      show: 1,
      hold: 1,
      drop: 1,
      seconds: 412,
      stopped: null,
    });
  });

  it("says why a pass stopped, and counts an empty one", () => {
    expect(catalogSummary([], 3, "3 reads failed in a row")).toMatchObject({
      read: 0,
      failed: 0,
      stopped: "3 reads failed in a row",
    });
  });
});
