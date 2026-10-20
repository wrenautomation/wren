import { describe, expect, it, vi } from "vitest";
import { FakeLlm, type LlmClient, type LlmResponse } from "./client.js";
import { observeUsage, type UsageReport, withPart } from "./usage.js";

/** A client that answers with a fixed Anthropic-shaped body. */
function claude(raw: Record<string, unknown>): LlmClient {
  return {
    name: "claude-test",
    provider: "anthropic",
    complete: async (): Promise<LlmResponse> => ({ text: "ok", raw, latencyMs: 1 }),
  };
}

const BODY = {
  usage: { input_tokens: 100, output_tokens: 8, cache_read_tokens: 60, cache_write_tokens: 10 },
};

describe("observeUsage", () => {
  it("reports each response's tokens under the call's part, else the default", async () => {
    const seen: UsageReport[] = [];
    const llm = observeUsage(claude(BODY), { part: "watch", record: (r) => void seen.push(r) });
    await llm.complete("a");
    await llm.complete("b", { part: "watch.triage" });
    expect(seen.map((r) => r.part)).toEqual(["watch", "watch.triage"]);
    expect(seen[0]).toMatchObject({
      model: "claude-test",
      provider: "anthropic",
      usage: { input: 100, output: 8, cache_read: 60, cache_write: 10 },
    });
  });

  it("keeps the client's name and provider", () => {
    const llm = observeUsage(claude(BODY), { part: "x", record: () => {} });
    expect([llm.name, llm.provider]).toEqual(["claude-test", "anthropic"]);
  });

  it("reports nothing for a response with no usage", async () => {
    const record = vi.fn();
    await observeUsage(new FakeLlm(), { part: "x", record }).complete("a");
    expect(record).not.toHaveBeenCalled();
  });

  it("never fails the call when the recorder throws or rejects", async () => {
    const warn = vi.fn();
    const sync = observeUsage(claude(BODY), {
      part: "x",
      record: () => {
        throw new Error("db down");
      },
      warn,
    });
    expect((await sync.complete("a")).text).toBe("ok");
    const async = observeUsage(claude(BODY), {
      part: "x",
      record: () => Promise.reject(new Error("db down")),
      warn,
    });
    expect((await async.complete("a")).text).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("db down");
  });

  it("does not report a failed call", async () => {
    const record = vi.fn();
    const failing: LlmClient = {
      name: "claude-test",
      provider: "anthropic",
      complete: () => Promise.reject(new Error("429")),
    };
    await expect(observeUsage(failing, { part: "x", record }).complete("a")).rejects.toThrow("429");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("withPart", () => {
  it("names a part on calls that name none, and keeps a call's own", async () => {
    const seen: (string | undefined)[] = [];
    const inner: LlmClient = {
      name: "n",
      provider: "p",
      complete: async (_p, o) => {
        seen.push(o?.part);
        return { text: "ok", raw: {}, latencyMs: null };
      },
    };
    const llm = withPart(inner, "drafts");
    await llm.complete("a");
    await llm.complete("b", { part: "other", maxTokens: 5 });
    expect(seen).toEqual(["drafts", "other"]);
    expect(llm.name).toBe("n");
  });

  it("composes under observeUsage", async () => {
    const seen: string[] = [];
    const base = observeUsage(claude(BODY), {
      part: "watch",
      record: (r) => void seen.push(r.part),
    });
    await withPart(base, "drafts").complete("a");
    expect(seen).toEqual(["drafts"]);
  });
});
