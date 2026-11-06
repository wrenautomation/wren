/**
 * The CLI's stream-json frames (live, or a stored session's) folded into `@wren/ui` AgentThread
 * messages. One reply per turn: tool calls, thinking and words land in it in order. Partial
 * frames (`stream_event`) stream the reply; the whole `assistant` frame then only fixes a tool's
 * input. Pure, so fixtures from a real relay session test it (thread.test.ts).
 */
import { type AgentFile, type AgentMessage, type AgentPart, fileKind } from "@wren/ui";

export interface ThreadState {
  messages: AgentMessage[];
  session?: string | undefined;
  model?: string | undefined;
  /** From init's `apiKeySource`: `none` is the Claude plan. */
  plan?: boolean | undefined;
  running: boolean;
  /** Stop pressed: the turn's end reads as stopped, not failed. */
  stopping?: boolean | undefined;
  /** API message ids seen as partials: their whole frame adds nothing but tool input. */
  streamed: string[];
  /** The partial message's block index → its part's index in the reply. */
  blocks: Record<number, number>;
  /** API message ids whose usage is in a foot: a stored message repeats it on each block's line. */
  counted?: string[] | undefined;
  /** The last API call: its id and its whole size (prompt + output), to see what the next one adds. */
  last?: { id: string; size: number } | undefined;
}

export const EMPTY: ThreadState = { messages: [], running: false, streamed: [], blocks: {} };

type Frame = Record<string, unknown> & { type?: string };
type Block = Record<string, unknown> & { type?: string };

const INTERRUPTED = /^\[Request interrupted/;
let minted = 0;
const mint = (k: string) => `${k}-${Date.now().toString(36)}-${(minted++).toString(36)}`;

/** What a turn carries beside its words. */
export interface TurnExtra {
  files?: readonly AgentFile[] | undefined;
  page?: string | undefined;
}

/** The person sends a turn: their message, then an empty live reply. */
export function said(
  s: ThreadState,
  text: string,
  more: TurnExtra = {},
  at = new Date().toISOString(),
): ThreadState {
  const parts: AgentPart[] = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(more.files ?? []).map((file) => ({ type: "file" as const, file })),
  ];
  return {
    ...s,
    running: true,
    stopping: false,
    messages: [
      ...s.messages,
      { id: mint("you"), role: "user", parts, at, ...(more.page ? { page: more.page } : {}) },
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

/** A subagent's own count, on the Agent call's result. */
function agentUse(r: unknown): { tokens?: number; uses?: number } {
  const o = (r ?? {}) as { totalTokens?: unknown; totalToolUseCount?: unknown };
  return typeof o.totalTokens === "number"
    ? {
        tokens: o.totalTokens,
        ...(typeof o.totalToolUseCount === "number" ? { uses: o.totalToolUseCount } : {}),
      }
    : {};
}

const resultText = (c: unknown): string =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((b: Block) => (b.type === "text" ? String(b.text ?? "") : "")).join("\n")
      : "";

/** A product's CLI names a card on a line of its own: `::view research.run {"run":"…"}`
 * (designs/2026-11-05-research-web.md, Log 11-05). A file read numbers its lines. */
const VIEW = /^(?:\s*\d+\t)?::view ([a-z][\w.-]*) (\{.*\})\s*$/gm;

/** The cards a tool's output names. One card a ref in a reply: a later line moves it down. */
function lift(s: ThreadState, m: AgentMessage, text: string): void {
  for (const [, name, json] of text.matchAll(VIEW)) {
    const data = parsed(json);
    if (!name || !data) continue;
    const id = `view:${name}:${JSON.stringify(data)}`;
    const was = m.parts.findIndex((p) => p.type === "view" && p.id === id);
    if (was >= 0) {
      m.parts.splice(was, 1);
      // a live stream's blocks point at parts by place
      s.blocks = Object.fromEntries(
        Object.entries(s.blocks).map(([k, at]) => [k, at > was ? at - 1 : at]),
      );
    }
    m.parts.push({ type: "view", id, name, data });
  }
}

function parsed(text: string | undefined): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One frame in. Unknown frames (status, rate limits, hooks) change nothing. `now` times a live
 * frame; a stored one carries its own `timestamp`. */
export function fold(s: ThreadState, f: Frame, now = Date.now()): ThreadState {
  const t = typeof f.timestamp === "string" ? Date.parse(f.timestamp) || now : now;
  switch (f.type) {
    case "system":
      return f.subtype === "init"
        ? {
            ...s,
            session: String(f.session_id),
            model: String(f.model ?? s.model ?? ""),
            plan: f.apiKeySource === undefined ? s.plan : f.apiKeySource === "none",
          }
        : s;
    case "stream_event":
      return partial(s, f.event as Frame, t);
    case "assistant":
      return whole(s, (f.message ?? {}) as Parameters<typeof whole>[1], t);
    case "user":
      return userFrame(s, f, t);
    case "result":
      return ended(s, f);
    default:
      return s;
  }
}

function partial(s0: ThreadState, e: Frame, t: number): ThreadState {
  if (e.type === "message_start") {
    const id = String((e.message as { id?: string })?.id ?? "");
    return { ...s0, streamed: [...s0.streamed.slice(-20), id], blocks: {} };
  }
  const index = Number(e.index);
  if (e.type === "content_block_start") {
    const p = partOf(e.content_block as Block);
    if (!p) return s0;
    const { s, m } = reply(s0);
    if (p.type === "tool") {
      p.inputText = "";
      p.startedAt = t;
    }
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

const STOPPED = /^No response requested\.?$/;

function whole(
  s0: ThreadState,
  msg: { id?: string; model?: string; content?: Block[]; usage?: Record<string, unknown> },
  t: number,
): ThreadState {
  const blocks = msg.content ?? [];
  // the CLI's own lines: a typed command's answer shows; its line after a stop doesn't; no usage
  const cli = msg.model === "<synthetic>";
  if (cli && !blocks.some((b) => b.type === "text" && b.text && !STOPPED.test(String(b.text))))
    return s0;
  const { s: s1, m } = reply(s0);
  const s = cli ? s1 : grew(used(s1, m, msg), m, msg);
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
    if (p?.type === "tool") p.startedAt = t;
    if (p && !(p.type === "thinking" && !p.text)) m.parts.push(p);
  }
  return s;
}

/** The CLI's own command echo (`setModel` → `/model`): not a person's turn. */
const ECHO = /^<(local-command-(stdout|stderr)|command-(name|message|args))>/;
/** A typed command as the CLI stores it: shown as typed (`/model sonnet`). */
const COMMAND =
  /^<command-name>(\/[^<]+)<\/command-name>[\s\S]*?(?:<command-args>([\s\S]*?)<\/command-args>)?\s*$/;

function userFrame(s0: ThreadState, f: Frame, t: number): ThreadState {
  const content = (f.message as { content?: unknown })?.content;
  if (f.isMeta || f.isSynthetic) return s0;
  if (Array.isArray(content) && content.some((b: Block) => b.type === "tool_result")) {
    const { s, m } = reply(s0);
    for (const b of content as Block[]) {
      if (b.type !== "tool_result") continue;
      const at = toolAt(m, String(b.tool_use_id));
      const p = m.parts[at];
      if (p?.type !== "tool") continue;
      const result = resultText(b.content);
      setPart(m, at, {
        ...p,
        result,
        failed: !!b.is_error,
        completedAt: t,
        ...agentUse(f.tool_use_result),
      });
      lift(s, m, result);
    }
    return s;
  }
  const cmd = typeof content === "string" ? COMMAND.exec(content) : null;
  const turn = storedTurn(cmd ? `${cmd[1]}${cmd[2]?.trim() ? ` ${cmd[2].trim()}` : ""}` : content);
  if (!turn.parts.length || ECHO.test(turn.words)) return s0;
  if (INTERRUPTED.test(turn.words)) {
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
      {
        id: String(f.uuid ?? mint("you")),
        role: "user",
        parts: turn.parts,
        at,
        ...(turn.page ? { page: turn.page } : {}),
      },
      { id: mint("reply"), role: "assistant", parts: [], state: "done", at },
    ],
  };
}

const PAGE_LINE = /^\[Page: (.+)\]$/;
const FILE_LINE = /^\[Attached: (.+)\]$/;
const baseName = (p: string) => p.split("/").pop() || p;

/**
 * A person's stored turn: the words, the page line, and each `[Attached: …]` line with the image
 * or document block after it, as file parts (`turnContent` in files.ts writes them).
 */
export function storedTurn(content: unknown): { parts: AgentPart[]; words: string; page?: string } {
  if (typeof content === "string") {
    const words = content.trim();
    return { parts: words ? [{ type: "text", text: words }] : [], words };
  }
  const blocks = Array.isArray(content) ? (content as Block[]) : [];
  const words: string[] = [];
  const files: AgentFile[] = [];
  let page: string | undefined;
  // a line's file waits for the block after it: an inline image or PDF is that line's
  let open: AgentFile | null = null;
  for (const b of blocks) {
    if (b.type === "text") {
      const t = String(b.text ?? "").trim();
      const pg = PAGE_LINE.exec(t);
      const fl = FILE_LINE.exec(t);
      open = null;
      if (pg) page = pg[1];
      else if (fl) {
        const name = baseName(fl[1] ?? "");
        open = { name, kind: fileKind("", name) };
        files.push(open);
      } else if (t) words.push(t);
      continue;
    }
    if (b.type !== "image" && b.type !== "document") continue;
    const f: AgentFile = open ?? { name: b.type === "image" ? "Image" : "Document", kind: "file" };
    if (!open) files.push(f);
    open = null;
    const src = b.source as { type?: string; media_type?: string; data?: string } | undefined;
    if (b.type === "image") {
      f.kind = "image";
      if (src?.type === "base64" && src.data) f.src = `data:${src.media_type};base64,${src.data}`;
    } else f.kind = "pdf";
  }
  const text = words.join("\n");
  return {
    parts: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...files.map((file) => ({ type: "file" as const, file })),
    ],
    words: text,
    ...(page ? { page } : {}),
  };
}

/**
 * A skill loads its body into the context: no event says how big. What the next API call's prompt
 * grew by, past the last call's prompt and output, is the closest count the stream gives.
 */
function grew(
  s: ThreadState,
  m: AgentMessage,
  msg: { id?: string; usage?: Record<string, unknown> },
): ThreadState {
  const u = msg.usage;
  if (!u || !msg.id || s.last?.id === msg.id) return s;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  const prompt =
    n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
  const added = s.last ? prompt - s.last.size : 0;
  if (added > 0)
    m.parts.forEach((p, i) => {
      if (p.type === "tool" && p.name === "Skill" && p.result !== undefined && !p.tokens)
        setPart(m, i, { ...p, tokens: added });
    });
  return { ...s, last: { id: msg.id, size: prompt + n("output_tokens") } };
}

/**
 * A stored session keeps no result line: its foot sums each API reply's usage, once per id.
 * Live, the result line replaces it (`ended`).
 */
function used(
  s: ThreadState,
  m: AgentMessage,
  msg: { id?: string; model?: string; usage?: Record<string, unknown> },
): ThreadState {
  const u = msg.usage;
  if (!u || !msg.id || s.counted?.includes(msg.id)) return s;
  const add = (a: number | undefined, k: string) => {
    const v = u[k];
    return typeof v === "number" && v > 0 ? (a ?? 0) + v : a;
  };
  const f = m.foot ?? {};
  m.foot = {
    ...f,
    input: add(f.input, "input_tokens"),
    output: add(f.output, "output_tokens"),
    cacheRead: add(f.cacheRead, "cache_read_input_tokens"),
    cacheWrite: add(f.cacheWrite, "cache_creation_input_tokens"),
    model: msg.model ?? f.model,
    plan: f.plan ?? s.plan,
  };
  return { ...s, counted: [...(s.counted ?? []).slice(-50), msg.id] };
}

function ended(s0: ThreadState, f: Frame): ThreadState {
  const { s, m } = reply(s0);
  const u = (f.usage ?? {}) as Record<string, number | undefined>;
  const n = (v: number | undefined) => (typeof v === "number" && v > 0 ? v : undefined);
  const stopped = m.state === "stopped" || s0.stopping || f.terminal_reason === "aborted_streaming";
  m.state = stopped ? "stopped" : f.is_error ? "failed" : "done";
  m.foot = {
    ms: typeof f.duration_ms === "number" ? f.duration_ms : undefined,
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    cost: typeof f.total_cost_usd === "number" ? f.total_cost_usd : undefined,
    model: s0.model || undefined,
    plan: s0.plan,
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
export const history = (frames: readonly Frame[]): ThreadState =>
  frames.reduce((s, f) => fold(s, f), EMPTY);

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

/** An ask answered; AskUserQuestion's picks stay on its card. */
export function answered(
  s0: ThreadState,
  id: string,
  allow: boolean,
  answers?: Record<string, string>,
): ThreadState {
  const { s, m } = reply(s0);
  const at = toolAt(m, id);
  const p = m.parts[at];
  if (p?.type !== "tool" || !p.ask) return s0;
  setPart(m, at, { ...p, ask: { ...p.ask, allowed: allow }, ...(answers ? { answers } : {}) });
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
      text: "The agent isn't running on this Mac. Start its relay, then retry.",
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
