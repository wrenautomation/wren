import { describe, expect, it } from "vitest";
import { type PruneRow, pruneAction } from "./template-prune.js";

const niches = new Set(["acme"]);
const files = new Set(["acme/a/opener"]);
const row = (o: Partial<PruneRow>): PruneRow => ({
  id: 1,
  system: "acme",
  name: "b/opener",
  folder: "acme/b",
  live: true,
  draft: false,
  waiting: false,
  followsDefault: true,
  messages: 0,
  ...o,
});

describe("pruneAction", () => {
  it("keeps a row its file backs, and one outside a niche", () => {
    expect(pruneAction(row({ name: "a/opener" }), niches, files)).toBe("keep");
    expect(pruneAction(row({ system: "follow" }), niches, files)).toBe("keep");
  });

  it("deletes one never sent, retires one sent, and leaves a retired one be", () => {
    expect(pruneAction(row({}), niches, files)).toBe("delete");
    expect(pruneAction(row({ messages: 3 }), niches, files)).toBe("retire");
    const done = row({
      messages: 3,
      folder: "retired/acme/b",
      live: false,
      followsDefault: false,
    });
    expect(pruneAction(done, niches, files)).toBe("keep");
    expect(pruneAction({ ...done, draft: true }, niches, files)).toBe("retire");
  });
});
