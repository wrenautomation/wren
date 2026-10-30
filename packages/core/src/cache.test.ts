import { describe, expect, it, vi } from "vitest";
import { type Cache, invalidate, memoryCache, readThrough } from "./cache.js";
import { encode, parse, RespError } from "./resp.js";

describe("resp", () => {
  it("encodes commands as arrays of bulk strings", () => {
    expect(encode(["SET", "k", "é"]).toString()).toBe("*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n");
  });
  it("parses each reply type, and waits on a partial one", () => {
    const b = (s: string) => Buffer.from(s);
    expect(parse(b("+OK\r\n"), 0)).toEqual({ value: "OK", next: 5 });
    expect(parse(b(":3\r\n"), 0)?.value).toBe(3);
    expect(parse(b("$-1\r\n"), 0)?.value).toBeNull();
    expect(parse(b("$2\r\nhi\r\n"), 0)).toEqual({ value: "hi", next: 8 });
    expect(parse(b("*2\r\n$1\r\na\r\n:1\r\n"), 0)?.value).toEqual(["a", 1]);
    expect(parse(b("-WRONGPASS no\r\n"), 0)?.value).toBeInstanceOf(RespError);
    expect(parse(b("$5\r\nhel"), 0)).toBeUndefined();
    expect(parse(b("*2\r\n$1\r\na\r\n"), 0)).toBeUndefined();
  });
});

describe("memoryCache", () => {
  it("expires by TTL and drops the least recently used past its size", async () => {
    let t = 0;
    const c = memoryCache(() => t, 2);
    await c.set("a", "1", 100);
    await c.set("b", "2", 100);
    expect(await c.get("a")).toBe("1"); // a is now the newest
    await c.set("c", "3", 100);
    expect(await c.get("b")).toBeNull();
    t = 100;
    expect(await c.get("a")).toBeNull();
  });
});

describe("readThrough", () => {
  it("loads once per key at a time, keeps the value, and keeps no failure", async () => {
    const c = memoryCache();
    const load = vi.fn(async () => ({ n: 1 }));
    const [x, y] = await Promise.all([
      readThrough(c, "k", 1000, load),
      readThrough(c, "k", 1000, load),
    ]);
    expect(x).toEqual({ n: 1 });
    expect(y).toEqual({ n: 1 });
    expect(await readThrough(c, "k", 1000, load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);

    await expect(
      readThrough(c, "bad", 1000, () => Promise.reject(new Error("no"))),
    ).rejects.toThrow("no");
    expect(await c.get("bad")).toBeNull();

    await invalidate(c, "k");
    expect(await c.get("k")).toBeNull();
  });

  it("a cache that fails is a miss: the read goes to the truth", async () => {
    const down: Cache = {
      name: "redis",
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
      del: () => Promise.reject(new Error("down")),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readThrough(down, "k", 1000, async () => 7)).toBe(7);
    await invalidate(down, "k");
    warn.mockRestore();
  });
});
