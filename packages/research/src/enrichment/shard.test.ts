import { describe, expect, it } from "vitest";
import { Shard } from "./shard.js";

describe("Shard.parse", () => {
  it("accepts i/n with 0 <= i < n", () => {
    const s = Shard.parse("1/4");
    expect([s.index, s.count]).toEqual([1, 4]);
    expect(String(s)).toBe("1/4");
    expect(String(Shard.parse("0/1"))).toBe("0/1");
  });
  it.each(["4/4", "-1/4", "0/0", "a/b", "3", "1/2/3x", ""])("rejects %s", (text) => {
    expect(() => Shard.parse(text)).toThrow(/shard/);
  });
});
