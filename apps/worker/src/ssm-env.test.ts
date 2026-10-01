import { describe, expect, it } from "vitest";
import { applyEnv } from "./ssm-env.js";

describe("applyEnv", () => {
  it("sets names the process lacks and keeps ones it has", () => {
    const env: NodeJS.ProcessEnv = { WREN_LLM: "fake" };
    const applied = applyEnv(
      JSON.stringify({ WREN_LLM: "anthropic", ANTHROPIC_API_KEY: "k" }),
      env,
    );
    expect(applied).toEqual(["ANTHROPIC_API_KEY"]);
    expect(env).toEqual({ WREN_LLM: "fake", ANTHROPIC_API_KEY: "k" });
  });

  it("refuses anything but an object of strings", () => {
    expect(() => applyEnv("[1]", {})).toThrow(/JSON object/);
    expect(() => applyEnv('{"A": 1}', {})).toThrow(/SSM env A/);
  });
});
