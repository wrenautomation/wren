/**
 * The CLI's stream-json frames (live, or a stored session's) folded into `@wren/ui` AgentThread
 * messages. One reply per turn: tool calls, thinking and words land in it in order. Partial
 * frames (`stream_event`) stream the reply; the whole `assistant` frame then only fixes a tool's
 * input. Pure, so fixtures from a real relay session test it (thread.test.ts).
 */
import type { AgentMessage, AgentPart } from "@wren/ui";

export interface ThreadState {
  messages: AgentMessage[];
  session?: string | undefined;
  model?: string | undefined;
  running: boolean;
  /** Stop pressed: the turn's end reads as stopped, not failed. */
  stopping?: boolean | undefined;
  /** API message ids seen as partials: their whole frame adds nothing but tool input. */
  streamed: string[];
  /** The partial message's block index → its part's index in the reply. */
  blocks: Record<number, number>;
}

export const EMPTY: ThreadState = { messages: [], running: false, streamed: [], blocks: {} };

type Frame = Record<string, unknown> & { type?: string };
type Block = Record<string, unknown> & { type?: string };

const INTERRUPTED = /^\[Request interrupted/;
let minted = 0;
const mint = (k: string) => `${k}-${Date.now().toString(36)}-${(minted++).toString(36)}`;

/** The person sends a turn: their message, then an empty live reply. */
export function said(s: ThreadState, text: string, at = new Date().toISOString()): ThreadState {
  return {
    ...s,
    running: true,
    stopping: false,
    messages: [
      ...s.messages,
      { id: mint("you"), role: "user", parts: [{ type: "text", text }], at },
      { id: mint("reply"), role: "assistant", parts: [], state: "live", at },
    ],
  };
}

/** The open reply, copied for change; one is made when frames come without a turn (a resume). */
function reply(s: ThreadState): { s: ThreadState; m: AgentMessage } {
  const last = s.messages.at(-1);
  if (last?.role === "assistant") {
    const m = { ...last, parts: [...last.parts] };
    return { s: { ...s, messages: [...s.messages.slice(0, -1), m] }, m };
  }
  const m: AgentMessage = { id: mint("reply"), role: "assistant", parts: [], state: "done" };
  return { s: { ...s, messages: [...s.messages, m] }, m };
}

function setPart(m: AgentMessage, i: number, p: AgentPart): void {
  m.parts[i] = p;
}

function toolAt(m: AgentMessage, id: string): number {
  return m.parts.findIndex((p) => p.type === "tool" && p.id === id);
}

function partOf(b: Block): AgentPart | null {
  if (b.type === "text") return { type: "text", text: String(b.text ?? "") };
  if (b.type === "thinking") return { type: "thinking", text: String(b.thinking ?? "") };
  if (b.type === "tool_use")
    return {
      type: "tool",
      id: String(b.id),
      name: String(b.name),
      input: (b.input as Record<string, unknown>) ?? {},
    };
  return null;
}

const resultText = (c: unknown): string =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((b: Block) => (b.type === "text" ? String(b.text ?? "") : "")).join("\n")
      : "";

function parsed(text: string | undefined): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One frame in. Unknown frames (status, rate limits, hooks) change nothing. */
export function fold(s: ThreadState, f: Frame): ThreadState {
  switch (f.type) {
    case "system":
      return f.subtype === "init"
        ? { ...s, session: String(f.session_id), model: String(f.model ?? s.model ?? "") }
        : s;
    case "stream_event":
      return partial(s, f.event as Frame);
    case "assistant":
      return whole(s, (f.message ?? {}) as { id?: string; content?: Block[] });
    case "user":
      return userFrame(s, f);
    case "result":
      return ended(s, f);
    default:
      return s;
  }
}

function partial(s0: ThreadState, e: Frame): ThreadState {
  if (e.type === "message_start") {
    const id = String((e.message as { id?: string })?.id ?? "");
    return { ...s0, streamed: [...s0.streamed.slice(-20), id], blocks: {} };
  }
  const index = Number(e.index);
  if (e.type === "content_block_start") {
    const p = partOf(e.content_block as Block);
    if (!p) return s0;
    const { s, m } = reply(s0);
    if (p.type === "tool") p.inputText = "";
    m.parts.push(p);
    m.state = "live";
    return { ...s, running: true, blocks: { ...s.blocks, [index]: m.parts.length - 1 } };
  }
  const at = s0.blocks[index];
  if (at === undefined) return s0;
  const { s, m } = reply(s0);
  const p = m.parts[at];
  if (!p) return s0;
  if (e.type === "content_block_delta") {
    const d = e.delta as Block;
    if (d.type === "text_delta" && p.type === "text")
      setPart(m, at, { ...p, text: p.text + String(d.text ?? "") });
    else if (d.type === "thinking_delta" && p.type === "thinking")
      setPart(m, at, { ...p, text: p.text + String(d.thinking ?? "") });
    else if (d.type === "input_json_delta" && p.type === "tool")
      setPart(m, at, { ...p, inputText: (p.inputText ?? "") + String(d.partial_json ?? "") });
    else return s0;
    return s;
  }
  if (e.type === "content_block_stop" && p.type === "tool") {
    setPart(m, at, { ...p, input: parsed(p.inputText) ?? p.input, inputText: undefined });
    return s;
  }
  return s0;
}

function whole(s0: ThreadState, msg: { id?: string; content?: Block[] }): ThreadState {
  const blocks = msg.content ?? [];
  const { s, m } = reply(s0);
  if (msg.id && s0.streamed.includes(msg.id)) {
    for (const b of blocks) {
      if (b.type !== "tool_use") continue;
      const at = toolAt(m, String(b.id));
      const p = m.parts[at];
      if (p?.type === "tool")
        setPart(m, at, { ...p, input: (b.input as Record<string, unknown>) ?? p.input });
    }
    return s;
  }
  for (const b of blocks) {
    const p = partOf(b);
    if (p && !(p.type === "thinking" && !p.text)) m.parts.push(p);
  }
  return s;
}

/** The CLI's own command echo (`setModel` → `/model`): not a person's turn. */
const ECHO = /^<(local-command-(stdout|stderr)|command-(name|message|args))>/;

function userFrame(s0: ThreadState, f: Frame): ThreadState {
  const content = (f.message as { content?: unknown })?.content;
  if (f.isMeta || f.isSynthetic) return s0;
  if (Array.isArray(content) && content.some((b: Block) => b.type === "tool_result")) {
    const { s, m } = reply(s0);
    for (const b of content as Block[]) {
      if (b.type !== "tool_result") continue;
      const at = toolAt(m, String(b.tool_use_id));
      const p = m.parts[at];
      if (p?.type === "tool")
        setPart(m, at, { ...p, result: resultText(b.content), failed: !!b.is_error });
    }
    return s;
  }
  const text = resultText(content).trim();
  if (!text || ECHO.test(text)) return s0;
  if (INTERRUPTED.test(text)) {
    const { s, m } = reply(s0);
    m.state = "stopped";
    return s;
  }
  // a stored session's own turn; live turns come from `said`, the CLI does not echo them
  const at = typeof f.timestamp === "string" ? f.timestamp : undefined;
  return {
    ...s0,
    messages: [
      ...s0.messages,
      { id: String(f.uuid ?? mint("you")), role: "user", parts: [{ type: "text", text }], at },
      { id: mint("reply"), role: "assistant", parts: [], state: "done", at },
    ],
  };
}

function ended(s0: ThreadState, f: Frame): ThreadState {
  const { s, m } = reply(s0);
  const u = (f.usage ?? {}) as Record<string, number | undefined>;
  const tokens =
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.output_tokens ?? 0);
  const stopped = m.state === "stopped" || s0.stopping || f.terminal_reason === "aborted_streaming";
  m.state = stopped ? "stopped" : f.is_error ? "failed" : "done";
  m.foot = {
    ms: typeof f.duration_ms === "number" ? f.duration_ms : undefined,
    tokens: tokens || undefined,
    cost: typeof f.total_cost_usd === "number" ? f.total_cost_usd : undefined,
    model: s0.model || undefined,
  };
  // an ask left open ends with the turn
  m.parts = m.parts.map((p) =>
    p.type === "tool" && p.ask && p.ask.allowed === undefined
      ? { ...p, ask: { ...p.ask, allowed: false } }
      : p,
  );
  return { ...s, running: false, stopping: false, blocks: {} };
}

/** A stored session (the relay's `/s/<setup>/sessions/<id>`) as a thread. */
export const history = (frames: readonly Frame[]): ThreadState => frames.reduce(fold, EMPTY);

/** The agent asks before a tool runs (`canUseTool`): the ask goes on that tool's card. */
export function asked(
  s0: ThreadState,
  a: { id: string; name: string; input: Record<string, unknown>; why?: string | undefined },
): ThreadState {
  const { s, m } = reply(s0);
  const at = toolAt(m, a.id);
  const p = m.parts[at];
  if (p?.type === "tool") setPart(m, at, { ...p, input: a.input, ask: { why: a.why } });
  else m.parts.push({ type: "tool", id: a.id, name: a.name, input: a.input, ask: { why: a.why } });
  return s;
}

export function answered(s0: ThreadState, id: string, allow: boolean): ThreadState {
  const { s, m } = reply(s0);
  const at = toolAt(m, id);
  const p = m.parts[at];
  if (p?.type !== "tool" || !p.ask) return s0;
  setPart(m, at, { ...p, ask: { ...p.ask, allowed: allow } });
  return s;
}

/** The session closed under a live turn: that reply ends where it got to. */
export function cut(s0: ThreadState): ThreadState {
  const last = s0.messages.at(-1);
  if (!s0.running || last?.role !== "assistant") return { ...s0, running: false };
  const { s, m } = reply(s0);
  m.state = s0.stopping ? "stopped" : "failed";
  return { ...s, running: false, stopping: false };
}

/** Why a session ended, as one sentence, and whether Retry can help. Codes: relay.ts CLOSE. */
export function closeText(e: unknown): { text: string; retry: boolean } {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /code (\d+)(?::\s*(.*))?/.exec(msg);
  const code = m ? Number(m[1]) : null;
  const why = m?.[2]?.trim() ?? "";
  if (code === null && /connection error|ECONNREFUSED|failed to connect/i.test(msg))
    return {
      text: "The agent isn't running on this Mac. Start it with wren agent serve, then retry.",
      retry: true,
    };
  switch (code) {
    case 4401:
      return /not your session/.test(why)
        ? { text: "This chat belongs to someone else.", retry: false }
        : { text: "You don't have access to this agent.", retry: false };
    case 4403:
      return {
        text: "The agent stopped: it was about to show a credential. Start a new chat.",
        retry: false,
      };
    case 4404:
      return { text: "This agent setup doesn't exist on this Mac.", retry: false };
    case 4400:
      return { text: `This setup can't start${why ? `: ${why}` : "."}`, retry: false };
    case 404:
      return { text: "This chat isn't on this Mac anymore.", retry: false };
    case 4429:
      return { text: "Too many chats are open on this Mac. Close one, then retry.", retry: true };
    case 4500:
      return { text: "The agent stopped unexpectedly.", retry: true };
    default:
      return { text: "The connection to the agent closed.", retry: true };
  }
}
