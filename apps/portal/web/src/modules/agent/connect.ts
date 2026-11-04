/**
 * A Claude setup in any portal page: the Agent SDK's `./browser` `query()` over the local relay
 * (`wren agent serve`, packages/agent; designs/2026-11-04-multi-user-runtime.md, Decision 2). The
 * page holds the whole SDK: multi-turn, interrupt, `canUseTool` prompts, resume. The SDK loads
 * on first open only (about 900 KB). CSP connect-src names ws://127.0.0.1:4748 (public/_headers).
 * Panels say "Claude agent", never "Claude Code" (Anthropic's SDK branding rule).
 */
import type {
  CanUseTool,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk/browser";

export type { CanUseTool, Query, SDKMessage };

/** `?agent=` for another relay. */
export const RELAY =
  (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("agent")) ??
  "ws://127.0.0.1:4748";

/** `wren agent token` on the Mac; the page keeps it in this browser only. */
const TOKEN_KEY = "wren.agent.token";
export const agentToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setAgentToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t.trim());

/** The page's turns as the SDK's prompt stream: `say` queues one, `end` closes the session. */
export function turns(): {
  stream: AsyncIterable<SDKUserMessage>;
  say: (text: string) => void;
  end: () => void;
} {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const stream = (async function* () {
    while (!done || queue.length) {
      const next = queue.shift();
      if (next) yield next;
      else await new Promise<void>((r) => (wake = r));
    }
  })();
  const poke = () => {
    wake?.();
    wake = null;
  };
  return {
    stream,
    say: (text) => {
      queue.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: "",
      } as SDKUserMessage);
      poke();
    },
    end: () => {
      done = true;
      poke();
    },
  };
}

export interface OpenOptions {
  /** A setup's name (`wren agent setups`). */
  setup: string;
  token: string;
  prompt: AsyncIterable<SDKUserMessage>;
  canUseTool: CanUseTool;
  resume?: string;
  abortController?: AbortController;
}

/** One session; iterate the result for every SDKMessage, call `.interrupt()` to stop a turn. */
export async function openSetup(o: OpenOptions): Promise<Query> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk/browser");
  const q = o.resume ? `?resume=${encodeURIComponent(o.resume)}` : "";
  return query({
    prompt: o.prompt,
    canUseTool: o.canUseTool,
    ...(o.abortController ? { abortController: o.abortController } : {}),
    websocket: {
      url: `${RELAY}/s/${encodeURIComponent(o.setup)}${q}`,
      // the SDK's auth frame carries our local relay token, never a Claude credential
      authMessage: { type: "auth", credential: { type: "oauth", token: o.token } },
    },
  });
}
