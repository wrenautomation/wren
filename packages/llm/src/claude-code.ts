/**
 * Claude Code as the model: `claude -p` headless, one process per call, on the
 * person's own subscription. No API key. The same seam autobrowse's `claude-code`
 * provider uses (its src/llm/claude-code.ts). Tools, MCP servers, skills and
 * settings are off, and the call runs in a scratch cwd, so nothing on disk is
 * touched and the operator's setup never leaks into the answer. ~2s to start
 * per call: right for a few big calls (a study), wrong for thousands of rows.
 */
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { type CompleteOptions, type LlmClient, LlmError, type LlmResponse } from "./client.js";

export const DEFAULT_CLAUDE_CODE_MODEL = "sonnet";

/** Kept short: the prompt carries the task and the output shape. */
const SYSTEM = "Do exactly what the message asks. Reply with only the answer, no preamble.";

export type ClaudeRun = (args: string[], stdin: string, timeoutMs: number) => Promise<string>;

/** What `claude -p --output-format json` prints; only what we read. */
interface HeadlessResult {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

/**
 * The subscription pays: an ANTHROPIC_API_KEY in this process would take
 * precedence over the Claude Code login, so the child never sees one.
 */
export function claudeChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _drop, ...rest } = env;
  return rest;
}

function spawnClaude(bin: string): ClaudeRun {
  return (args, stdin, timeoutMs) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        bin,
        args,
        { cwd: tmpdir(), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: claudeChildEnv() },
        (err, stdout, stderr) => {
          // A failed call still prints its JSON (is_error, why) on stdout: let the parser say it.
          if (!err || (!err.killed && stdout.trim().startsWith("{"))) return resolve(stdout);
          const why = err.killed ? `killed after ${timeoutMs}ms` : `exit ${err.code ?? "?"}`;
          reject(new Error(`${why}: ${(stderr || stdout).slice(0, 400)}`.trim()));
        },
      );
      child.stdin?.end(stdin);
    });
}

export class ClaudeCodeLlm implements LlmClient {
  readonly provider = "claude-code";
  readonly name: string;
  private readonly run: ClaudeRun;
  private readonly timeoutMs: number;
  constructor(
    readonly modelId: string = DEFAULT_CLAUDE_CODE_MODEL,
    opts: { bin?: string; timeoutMs?: number; run?: ClaudeRun } = {},
  ) {
    this.name = `claude-code:${modelId}`;
    this.run = opts.run ?? spawnClaude(opts.bin ?? "claude");
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  /** `maxTokens` has no flag in headless mode; the prompt bounds the answer. `system` replaces SYSTEM. */
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<LlmResponse> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.modelId,
      "--system-prompt",
      opts.system ?? SYSTEM,
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ];
    const started = performance.now();
    let out: string;
    try {
      out = await this.run(args, prompt, this.timeoutMs);
    } catch (err) {
      throw new LlmError(`claude -p: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    const latencyMs = Math.round(performance.now() - started);
    let parsed: HeadlessResult;
    try {
      parsed = JSON.parse(out) as HeadlessResult;
    } catch {
      throw new LlmError(`claude -p: not JSON: ${out.slice(0, 200)}`);
    }
    if (parsed.is_error || typeof parsed.result !== "string" || !parsed.result) {
      throw new LlmError(
        `claude -p: ${parsed.subtype ?? "error"}: ${(parsed.result ?? "").slice(0, 300)}`,
      );
    }
    const raw: Record<string, unknown> = {
      provider: this.provider,
      model: this.modelId,
      stop_reason: parsed.subtype ?? null,
      usage: {
        input_tokens: parsed.usage?.input_tokens ?? null,
        output_tokens: parsed.usage?.output_tokens ?? null,
        cache_read_tokens: parsed.usage?.cache_read_input_tokens ?? null,
      },
      /** What the call would cost on the API; the subscription pays it. */
      total_cost_usd: parsed.total_cost_usd ?? null,
      response: { id: parsed.session_id ?? null },
    };
    return { text: parsed.result, raw, latencyMs };
  }
}
