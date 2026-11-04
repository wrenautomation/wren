/**
 * Page → CLI frames. The page may steer a session, never widen its setup: user turns, answers to
 * the CLI's own requests and a short control list pass; `initialize` is rewritten to the setup's
 * skills; every other control request gets an error answer so the SDK does not hang.
 */
import type { Setup } from "./setup.js";

export type Inbound =
  | { kind: "forward"; line: string }
  | { kind: "reply"; frame: Record<string, unknown> }
  /** A typed command refused: its answer as a turn, so the page shows why and the SDK's turn ends. */
  | { kind: "answer"; frames: Record<string, unknown>[] }
  | { kind: "drop"; why: string };

/**
 * Typed slash commands anyone may run; the owner runs every one, as in their terminal. Not here:
 * `/usage` (the whole Mac's use), `/config`, `/fast` (cost), plugin, MCP and debug commands.
 */
const COMMANDS = new Set(["compact", "context", "clear", "rename", "model", "effort", "recap"]);

/** `/name args` at the start of a user turn's text. */
export function typed(content: unknown): { name: string; args: string } | null {
  const first = Array.isArray(content)
    ? content.find((b): b is { type: "text"; text: string } => isObj(b) && b.type === "text")?.text
    : content;
  const m = typeof first === "string" ? /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(first.trim()) : null;
  return m?.[1] ? { name: m[1], args: (m[2] ?? "").trim() } : null;
}

/** Why `/name args` may not run here; null when it may. */
function commandRefusal(
  setup: Setup,
  owner: boolean,
  { name, args }: { name: string; args: string },
): string | null {
  if (name === "model" && args && !offers(setup, args))
    return `This chat offers ${offered(setup).join(", ")}, not ${args}.`;
  if (name === "effort" && args && !["auto", ...EFFORTS].includes(args))
    return `Effort is one of ${EFFORTS.join(", ")}.`;
  if (owner || COMMANDS.has(name) || setup.skills.includes(name)) return null;
  return `/${name} is not available in this chat.`;
}

/** A command a person may see in the `/` menu. */
const commandShown = (setup: Setup, owner: boolean, name: string): boolean =>
  owner || COMMANDS.has(name) || setup.skills.includes(name);

const answer = (session: unknown, text: string): Inbound => ({
  kind: "answer",
  frames: [
    {
      type: "assistant",
      session_id: session,
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 0,
      num_turns: 0,
      result: text,
      session_id: session,
    },
  ],
});

/** Reads and steering that add no tool, prompt, server or setting. */
const PASS = new Set([
  "interrupt",
  "mcp_status",
  "get_context_usage",
  "get_session_cost",
  "get_usage",
  "list_models",
  "get_binary_version",
  "rename_session",
  "set_max_thinking_tokens",
  "cancel_async_message",
  "stop_task",
  "background_tasks",
  "get_task_output",
  // answered as `applied` only (`outbound`): the full settings carry env and hooks
  "get_settings",
]);

/** Never `bypassPermissions` or `auto` for a page: it may only tighten or keep the prompts. */
const MODES = new Set(["default", "acceptEdits", "plan", "dontAsk"]);
/** The Mac's owner may also drop the prompts, as in their own terminal (Decision 11). */
const OWNER_MODES = new Set([...MODES, "bypassPermissions"]);

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** A mode this person may run `setup` in; a setup with its own mode takes only that. */
export const modeAllowed = (setup: Setup, mode: string, owner: boolean): boolean =>
  setup.mode ? mode === setup.mode : (owner ? OWNER_MODES : MODES).has(mode);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const refuse = (id: unknown, error: string): Inbound => ({
  kind: "reply",
  frame: { type: "control_response", response: { subtype: "error", request_id: id, error } },
});

export function inbound(line: string, setup: Setup, owner = false): Inbound {
  let m: unknown;
  try {
    m = JSON.parse(line);
  } catch {
    return { kind: "drop", why: "not JSON" };
  }
  if (!isObj(m)) return { kind: "drop", why: "not an object" };

  switch (m.type) {
    case "user": {
      if (!isObj(m.message) || m.message.role !== "user")
        return { kind: "drop", why: "user frame without a user message" };
      const c = typed(m.message.content);
      const no = c && commandRefusal(setup, owner, c);
      return no ? answer(m.session_id, no) : { kind: "forward", line: JSON.stringify(m) };
    }
    case "control_response":
      return { kind: "forward", line: JSON.stringify(m) };
    case "control_request":
      return control(m, setup, owner);
    default:
      return { kind: "drop", why: `type ${String(m.type)}` };
  }
}

function control(m: Obj, setup: Setup, owner: boolean): Inbound {
  const id = m.request_id;
  if (!isObj(m.request)) return refuse(id, "no request");
  const r = m.request;
  const sub = String(r.subtype);

  if (sub === "initialize") {
    // hooks run in the page: they observe and narrow, they add no tool
    const request: Obj = { subtype: "initialize", skills: [...setup.skills] };
    if (isObj(r.hooks)) request.hooks = r.hooks;
    return { kind: "forward", line: JSON.stringify({ ...m, request }) };
  }
  if (sub === "set_model") {
    const ok = r.model == null || r.model === "default" || offers(setup, String(r.model));
    return ok
      ? { kind: "forward", line: JSON.stringify(m) }
      : refuse(id, `setup ${setup.name} does not offer model ${String(r.model)}`);
  }
  if (sub === "set_permission_mode")
    return modeAllowed(setup, String(r.mode), owner)
      ? { kind: "forward", line: JSON.stringify(m) }
      : refuse(id, `permission mode ${String(r.mode)} is not allowed here`);
  if (sub === "apply_flag_settings") {
    // effort only: the same request carries permissions, hooks and models, which widen a setup
    const s = r.settings;
    const keys = isObj(s) ? Object.keys(s) : [];
    const level = isObj(s) ? s.effortLevel : undefined;
    const ok =
      keys.length === 1 &&
      keys[0] === "effortLevel" &&
      (level === null || EFFORTS.includes(level as (typeof EFFORTS)[number]));
    return ok
      ? { kind: "forward", line: JSON.stringify(m) }
      : refuse(id, "only the effort may change here");
  }
  if (PASS.has(sub)) return { kind: "forward", line: JSON.stringify(m) };
  return refuse(id, `${sub} is not allowed in setup ${setup.name}`);
}

/**
 * CLI → page: a settings answer keeps only `applied` (model, effort), never env, hooks or sources;
 * a command list keeps only what this person may run.
 */
export function outbound(frame: unknown, setup: Setup, owner: boolean): unknown {
  if (!isObj(frame)) return frame;
  const mine = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((c) => isObj(c) && commandShown(setup, owner, String(c.name)))
      : list;
  if (frame.type === "system" && frame.subtype === "commands_changed")
    return { ...frame, commands: mine(frame.commands) };
  if (frame.type !== "control_response" || !isObj(frame.response)) return frame;
  const body = frame.response.response;
  if (!isObj(body)) return frame;
  if ("applied" in body && "effective" in body)
    return { ...frame, response: { ...frame.response, response: { applied: body.applied } } };
  if (Array.isArray(body.commands))
    return {
      ...frame,
      response: { ...frame.response, response: { ...body, commands: mine(body.commands) } },
    };
  return frame;
}

/** An alias the setup lists (`sonnet`), or that alias's full id (`claude-sonnet-5-5`, as the CLI's model list gives it). */
const offered = (setup: Setup) => [...new Set([setup.model, ...(setup.models ?? [])])];

function offers(setup: Setup, model: string): boolean {
  return offered(setup).some((a) => model === a || model.startsWith(`claude-${a}-`));
}
