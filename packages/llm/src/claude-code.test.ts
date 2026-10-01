import { describe, expect, it } from "vitest";
import { ClaudeCodeLlm, type ClaudeRun, claudeChildEnv } from "./claude-code.js";
import { LlmError, makeLlm } from "./client.js";

const answer =
  (body: Record<string, unknown>): ClaudeRun =>
  async () =>
    JSON.stringify(body);

describe("ClaudeCodeLlm", () => {
  it("sends the prompt on stdin with tools off and returns the result", async () => {
    let seen: { args: string[]; stdin: string } | null = null;
    const llm = new ClaudeCodeLlm("opus", {
      run: async (args, stdin) => {
        seen = { args, stdin };
        return JSON.stringify({
          subtype: "success",
          result: '{"ok": true}',
          session_id: "s1",
          total_cost_usd: 0.12,
          usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 10 },
        });
      },
    });
    const out = await llm.complete("hello");
    expect(out.text).toBe('{"ok": true}');
    expect(out.raw).toMatchObject({
      provider: "claude-code",
      model: "opus",
      usage: { input_tokens: 900, output_tokens: 40, cache_read_tokens: 10 },
      total_cost_usd: 0.12,
      response: { id: "s1" },
    });
    expect(seen).not.toBeNull();
    const { args, stdin } = seen as unknown as { args: string[]; stdin: string };
    expect(stdin).toBe("hello");
    expect(args.slice(0, 5)).toEqual(["-p", "--output-format", "json", "--model", "opus"]);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
  });

  it("turns an error result, a non-JSON reply and a failed run into LlmError", async () => {
    const cases: ClaudeRun[] = [
      answer({ subtype: "error_max_turns", is_error: true, result: "nope" }),
      answer({ subtype: "success", result: "" }),
      async () => "not json",
      async () => {
        throw new Error("spawn claude ENOENT");
      },
    ];
    for (const run of cases) {
      await expect(new ClaudeCodeLlm("sonnet", { run }).complete("x")).rejects.toBeInstanceOf(
        LlmError,
      );
    }
  });

  it("never hands the child an API key: the subscription pays", () => {
    expect(claudeChildEnv({ ANTHROPIC_API_KEY: "k", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });

  it("is what makeLlm builds for claude-code[:model], sonnet by default", () => {
    expect(makeLlm("claude-code", {}).name).toBe("claude-code:sonnet");
    expect(makeLlm("claude-code:opus", {}).name).toBe("claude-code:opus");
  });
});
