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
const RELAY =
  (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("agent")) ??
  "ws://127.0.0.1:4748";

/** The relay's HTTP side, same port: setups, and the asker's own past sessions. */
const HTTP = RELAY.replace(/^ws/, "http");

/** A setup as the relay lists it (`GET /setups`). */
export interface SetupInfo {
  name: string;
  title: string;
  app: string;
  model: string;
  models: string[];
  tools: string[];
  skills: string[];
  /** A fixed permission mode: the page offers no other. */
  mode?: string;
}

/** A past session of the asker's (`GET /s/<setup>/sessions`), newest first. */
export interface SessionRow {
  session: string;
  at: string;
  title?: string | undefined;
}

async function relayGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${HTTP}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }).catch(() => {
    throw new Error("WebSocket connection error");
  });
  if (!res.ok)
    throw new Error(`relay ${res.status}: code ${res.status === 401 ? 4401 : res.status}`);
  return (await res.json()) as T;
}

/** A file to the relay's Mac; a refusal comes back as its sentence. */
export async function relayPost<T>(path: string, token: string, body: Blob): Promise<T> {
  const res = await fetch(`${HTTP}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
    body,
  }).catch(() => {
    throw new Error("The agent on this Mac didn't take the file. Is it running?");
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const why = json.error ?? `the agent answered ${res.status}`;
    throw new Error(why.charAt(0).toUpperCase() + why.slice(1));
  }
  return json as T;
}

export const relaySetups = () => relayGet<SetupInfo[]>("/setups");
/** The person's own name for one of their chats. */
export async function relayRename(
  setup: string,
  session: string,
  token: string,
  title: string,
): Promise<void> {
  const res = await fetch(
    `${HTTP}/s/${encodeURIComponent(setup)}/sessions/${encodeURIComponent(session)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title }),
    },
  ).catch(() => {
    throw new Error("The agent on this Mac didn't answer. Is it running?");
  });
  if (!res.ok) {
    const why = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(
      why ? why.charAt(0).toUpperCase() + why.slice(1) : `The agent answered ${res.status}`,
    );
  }
}
export const relaySessions = (setup: string, token: string) =>
  relayGet<SessionRow[]>(`/s/${encodeURIComponent(setup)}/sessions`, token);
/** A stored session's frames, to fold with `history` (thread.ts). */
export const relayHistory = (setup: string, session: string, token: string) =>
  relayGet<Record<string, unknown>[]>(
    `/s/${encodeURIComponent(setup)}/sessions/${encodeURIComponent(session)}`,
    token,
  );

/** The page's turns as the SDK's prompt stream: `say` queues one, `end` closes the session. */
export function turns(): {
  stream: AsyncIterable<SDKUserMessage>;
  say: (content: SDKUserMessage["message"]["content"]) => void;
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
    say: (content) => {
      queue.push({
        type: "user",
        message: { role: "user", content },
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
  /** The page's sign-in token ("dev" on a local run); `wren agent token` for a local process. */
  token: string;
  prompt: AsyncIterable<SDKUserMessage>;
  canUseTool: CanUseTool;
  resume?: string;
  /** One of the setup's models; the relay starts the CLI on it. */
  model?: string;
  /** low … max; the relay checks it. */
  effort?: string;
  /** A permission mode; bypass only for the Mac's owner (Decision 11). */
  mode?: string;
  abortController?: AbortController;
}

/**
 * The SDK's browser build reads `process.env`, `.argv`, `.platform` unguarded (0.3.318): an empty
 * stand-in, set only when absent. Its guarded reads (`typeof process.cwd`) still see no Node.
 */
function nodeStub(): void {
  const g = globalThis as { process?: unknown };
  g.process ??= { env: {}, argv: [], platform: "browser", versions: {} };
}

/** One session; iterate the result for every SDKMessage, call `.interrupt()` to stop a turn. */
export async function openSetup(o: OpenOptions): Promise<Query> {
  nodeStub();
  const { query } = await import("@anthropic-ai/claude-agent-sdk/browser");
  const p = new URLSearchParams();
  if (o.resume) p.set("resume", o.resume);
  if (o.model) p.set("model", o.model);
  if (o.effort) p.set("effort", o.effort);
  if (o.mode) p.set("mode", o.mode);
  const q = p.size ? `?${p}` : "";
  return query({
    prompt: o.prompt,
    canUseTool: o.canUseTool,
    ...(o.abortController ? { abortController: o.abortController } : {}),
    websocket: {
      url: `${RELAY}/s/${encodeURIComponent(o.setup)}${q}`,
      // the auth frame carries the page's sign-in token (Decision 5), never a Claude credential
      authMessage: { type: "auth", credential: { type: "oauth", token: o.token } },
    },
  });
}
