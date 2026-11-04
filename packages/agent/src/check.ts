/**
 * `wren agent check`: one session through a running relay, as a page would open it. Reports what the
 * CLI loaded (credential source, tools, skills, plugins, MCP) and each turn's tokens. Denies every
 * permission prompt: a check never runs an unapproved tool.
 */
import WebSocket from "ws";

export interface TurnReport {
  text: string;
  inputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  usd: number;
}

export interface CheckReport {
  session: string | null;
  apiKeySource: string | null;
  model: string | null;
  tools: string[];
  skills: string[];
  plugins: string[];
  mcp: string[];
  turns: TurnReport[];
  denied: string[];
  closed: { code: number; reason: string } | null;
}

// biome-ignore lint/suspicious/noExplicitAny: wire frames, read loosely
type Frame = Record<string, any>;

export function checkSession(o: {
  port: number;
  token: string;
  setup: string;
  prompts: readonly string[];
  resume?: string | undefined;
  timeoutMs?: number;
}): Promise<CheckReport> {
  const r: CheckReport = {
    session: null,
    apiKeySource: null,
    model: null,
    tools: [],
    skills: [],
    plugins: [],
    mcp: [],
    turns: [],
    denied: [],
    closed: null,
  };
  const q = o.resume ? `?resume=${encodeURIComponent(o.resume)}` : "";
  const ws = new WebSocket(`ws://127.0.0.1:${o.port}/s/${o.setup}${q}`);
  const send = (f: Frame) => ws.send(`${JSON.stringify(f)}\n`);
  const user = (content: string) =>
    send({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: "",
    });
  let next = 0;

  return new Promise((res) => {
    const timer = setTimeout(() => ws.close(), o.timeoutMs ?? 180_000);
    ws.on("open", () => {
      send({ type: "auth", credential: { type: "oauth", token: o.token } });
      send({ type: "control_request", request_id: "init", request: { subtype: "initialize" } });
      user(o.prompts[next++] ?? "Reply OK only.");
    });
    ws.on("message", (d) => {
      for (const line of String(d).split("\n")) {
        if (!line.trim()) continue;
        const f = JSON.parse(line) as Frame;
        if (f.type === "system" && f.subtype === "init") {
          r.session = f.session_id ?? null;
          r.apiKeySource = f.apiKeySource ?? null;
          r.model = f.model ?? null;
          r.tools = f.tools ?? [];
          r.skills = f.skills ?? [];
          r.plugins = (f.plugins ?? []).map((p: Frame) => p.name);
          r.mcp = (f.mcp_servers ?? []).map((m: Frame) => m.name);
        }
        if (f.type === "control_request" && f.request?.subtype === "can_use_tool") {
          r.denied.push(`${f.request.tool_name} ${JSON.stringify(f.request.input).slice(0, 120)}`);
          send({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: f.request_id,
              response: { behavior: "deny", message: "wren agent check denies every prompt" },
            },
          });
        }
        if (f.type === "result") {
          const u = f.usage ?? {};
          r.turns.push({
            text: String(f.result ?? f.subtype),
            inputTokens: u.input_tokens ?? 0,
            cacheCreate: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            usd: f.total_cost_usd ?? 0,
          });
          if (next < o.prompts.length) user(o.prompts[next++] as string);
          else ws.close();
        }
      }
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      r.closed = { code, reason: String(reason) };
      res(r);
    });
    ws.on("error", (e) => {
      r.closed = { code: -1, reason: e.message };
    });
  });
}
