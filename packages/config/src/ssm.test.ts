import type { GetParameterCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it } from "vitest";
import { applyEnv, loadSsmEnv, paramNames, type SsmReader } from "./ssm.js";

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

/** A fake SSM: parameters by name, and each decrypting read counted as KMS would bill it. */
function fakeSsm(params: Record<string, Record<string, string>>) {
  const kms = { decrypts: 0 };
  const ssm: SsmReader = {
    async send(cmd: GetParameterCommand) {
      const name = cmd.input.Name ?? "";
      const p = params[name];
      if (!p) throw Object.assign(new Error(`${name} not found`), { name: "ParameterNotFound" });
      if (cmd.input.WithDecryption) kms.decrypts++;
      return { Parameter: { Value: JSON.stringify(p) } };
    },
  };
  return { ssm, kms };
}

describe("loadSsmEnv", () => {
  it("reads a comma list in order: the function's own value, then the first parameter wins", async () => {
    const { ssm, kms } = fakeSsm({
      "/wren/test/env": { A: "1", B: "1" },
      "/wren/test/env-2": { B: "2", C: "2" },
    });
    const env: NodeJS.ProcessEnv = { A: "own" };
    const applied = await loadSsmEnv(" /wren/test/env, /wren/test/env-2 ", { ssm, env });
    expect(applied).toEqual(["B", "C"]);
    expect(env).toEqual({ A: "own", B: "1", C: "2" });
    expect(kms.decrypts).toBe(2);
  });

  it("one name works as before; none loads nothing", async () => {
    const { ssm } = fakeSsm({ "/wren/test/env": { A: "1" } });
    const env: NodeJS.ProcessEnv = {};
    expect(await loadSsmEnv("/wren/test/env", { ssm, env })).toEqual(["A"]);
    expect(await loadSsmEnv(undefined, { ssm, env })).toEqual([]);
    expect(paramNames(",,")).toEqual([]);
  });

  it("skips a later parameter that isn't there yet; the first must be", async () => {
    const { ssm } = fakeSsm({ "/wren/test/env": { A: "1" } });
    const logged: string[] = [];
    const env: NodeJS.ProcessEnv = {};
    await loadSsmEnv("/wren/test/env,/wren/test/env-2", { ssm, env, log: (l) => logged.push(l) });
    expect(env).toEqual({ A: "1" });
    expect(logged).toEqual(["ssm env: /wren/test/env-2 not found, skipped"]);
    await expect(loadSsmEnv("/wren/test/nope,/wren/test/env", { ssm, env: {} })).rejects.toThrow(
      "not found",
    );
  });

  it("the key store costs one more decrypt per cold start; its key reads touch no SSM", async () => {
    const { ssm, kms } = fakeSsm({
      "/wren/test/env": { A: "1" },
      "/wren/test/keystore": { WREN_KEYSTORE_KEY: "k1:synthetic" },
    });
    const env: NodeJS.ProcessEnv = {};
    await loadSsmEnv("/wren/test/env,/wren/test/keystore", { ssm, env });
    expect(kms.decrypts).toBe(2);
    expect(env.WREN_KEYSTORE_KEY).toBe("k1:synthetic");
  });
});
