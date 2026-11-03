import type { LlmClient } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { ArmedLlm, armMeta, guardBy, modelFor } from "./draft-llm.js";

const fake = (name: string): LlmClient => ({
  name,
  provider: name,
  async complete() {
    throw new Error("not called");
  },
});
const base = fake("base");
const gemini = fake("gemini");
const cohere = fake("cohere");
const ARMS = [
  { model: "gateway:free", weight: 1 },
  { model: "cohere", weight: 1 },
];
const clients: Record<string, LlmClient | null> = { "gateway:free": gemini, cohere };

describe("ArmedLlm", () => {
  it("drafts an item on its arm, the same arm every time, with both arms used", async () => {
    const armed = new ArmedLlm(
      base,
      async () => ARMS,
      (m) => clients[m] ?? null,
    );
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const item = `thread:t3_${i}`;
      const a = await modelFor(armed, item);
      expect((await modelFor(armed, item)).arm).toBe(a.arm);
      expect(a.llm.name).toBe(a.arm === "cohere" ? "cohere" : "gemini");
      seen.add(a.arm ?? "none");
    }
    expect([...seen].sort()).toEqual(["cohere", "gateway:free"]);
  });

  it("skips an arm that can't be built here, and falls back to the base with none", async () => {
    const onlyCohere = new ArmedLlm(
      base,
      async () => ARMS,
      (m) => (m === "cohere" ? cohere : null),
    );
    expect(await modelFor(onlyCohere, "comment:1")).toEqual({ llm: cohere, arm: "cohere" });
    const none = new ArmedLlm(
      base,
      async () => ARMS,
      () => null,
    );
    expect(await modelFor(none, "comment:1")).toEqual({ llm: base, arm: null });
  });

  it("one saved arm is no test but still names the model", async () => {
    const one = new ArmedLlm(
      base,
      async () => [ARMS[0] as (typeof ARMS)[number]],
      (m) => clients[m] ?? null,
    );
    expect(await modelFor(one, "dm:9")).toEqual({ llm: gemini, arm: "gateway:free" });
  });

  it("leaves a plain client alone", async () => {
    const p = await modelFor(cohere, "dm:1");
    expect(p).toEqual({ llm: cohere, arm: null });
    expect(armMeta(p.arm)).toEqual({});
    expect(guardBy(p)).toBeNull();
  });
});
