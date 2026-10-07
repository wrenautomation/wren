/**
 * The brain on `@wren/llm`: any model the repo already swaps between (Claude Code at $0 in tests,
 * the gateway, a vendor). The model answers in one JSON object: what to say, and at most one tool.
 * `complete` doesn't stream yet, so the whole reply comes at once and is cut into sentences here;
 * a streaming method on the client is the setup step that makes first-token time real.
 */
import type { LlmClient } from "@wren/llm";
import type { Brain, BrainInput, LeadContext, Line, Thought } from "./types.js";

const FORMAT = [
  "Answer with one JSON object and nothing else:",
  '{"say": "what you say next, short, spoken", "tool": "a tool name, or null", "args": {}}',
  "Say a few words before a tool (they play while it runs). After a tool, you'll see its result",
  "and answer again. Never invent times, names or emails: use the tools.",
].join("\n");

const leadText = (lead: LeadContext | null) =>
  lead
    ? [
        lead.name && `Name: ${lead.name}`,
        lead.company && `Company: ${lead.company}`,
        lead.email && `Email: ${lead.email}`,
        lead.notes && `Notes: ${lead.notes}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "Unknown caller.";

const lineText = (l: Line) =>
  l.who === "tool"
    ? `[${l.tool} result] ${l.text}`
    : `${l.who === "caller" ? "Caller" : "You"}: ${l.text}`;

/** The prompt for one step: the lead, the tools, the call so far. */
export function promptOf(input: BrainInput): { system: string; prompt: string } {
  const tools = input.tools
    .map((t) => {
      const args = Object.entries(t.args).map(([k, v]) => `${k}: ${v}`);
      return `- ${t.name}: ${t.says}${args.length ? ` Args: ${args.join("; ")}.` : ""}`;
    })
    .join("\n");
  return {
    system: `${input.system}\n\nTools:\n${tools}\n\n${FORMAT}`,
    prompt: `Who's on the line:\n${leadText(input.lead)}\n\nThe call so far:\n${
      input.transcript.map(lineText).join("\n") || "(nothing yet)"
    }`,
  };
}

/** The model's answer as thoughts; anything unreadable is said as is. */
export function thoughtsOf(text: string): Thought[] {
  const body = /\{[\s\S]*\}/.exec(text)?.[0];
  try {
    const j = JSON.parse(body ?? "") as { say?: unknown; tool?: unknown; args?: unknown };
    const out: Thought[] = [];
    if (typeof j.say === "string" && j.say.trim()) out.push({ kind: "text", text: j.say.trim() });
    if (typeof j.tool === "string" && j.tool.trim())
      out.push({
        kind: "tool",
        name: j.tool.trim(),
        args: j.args && typeof j.args === "object" ? (j.args as Record<string, unknown>) : {},
      });
    if (out.length) return out;
  } catch {
    // Spoken as is below.
  }
  const said = text.trim();
  return said ? [{ kind: "text", text: said }] : [];
}

export class LlmBrain implements Brain {
  readonly name: string;
  constructor(
    private readonly llm: LlmClient,
    private readonly o: { maxTokens?: number } = {},
  ) {
    this.name = `llm:${llm.name}`;
  }

  async *think(input: BrainInput, signal: AbortSignal): AsyncIterable<Thought> {
    const { system, prompt } = promptOf(input);
    const res = await this.llm.complete(prompt, { system, maxTokens: this.o.maxTokens ?? 300 });
    if (signal.aborted) return;
    yield* thoughtsOf(res.text);
  }
}
