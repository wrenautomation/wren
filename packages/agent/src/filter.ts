/**
 * Page → CLI frames. The page may steer a session, never widen its setup: user turns, answers to
 * the CLI's own requests and a short control list pass; `initialize` is rewritten to the setup's
 * skills; every other control request gets an error answer so the SDK does not hang.
 */
import type { Setup } from "./setup.js";

export type Inbound =
  | { kind: "forward"; line: string }
  | { kind: "reply"; frame: Record<string, unknown> }
  | { kind: "drop"; why: string };

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
]);

/** Never `bypassPermissions` or `auto`: a page may only tighten or keep the prompts. */
const MODES = new Set(["default", "acceptEdits", "plan", "dontAsk"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const refuse = (id: unknown, error: string): Inbound => ({
  kind: "reply",
  frame: { type: "control_response", response: { subtype: "error", request_id: id, error } },
});

export function inbound(line: string, setup: Setup): Inbound {
  let m: unknown;
  try {
    m = JSON.parse(line);
  } catch {
    return { kind: "drop", why: "not JSON" };
  }
  if (!isObj(m)) return { kind: "drop", why: "not an object" };

  switch (m.type) {
    case "user":
      return isObj(m.message) && m.message.role === "user"
        ? { kind: "forward", line: JSON.stringify(m) }
        : { kind: "drop", why: "user frame without a user message" };
    case "control_response":
      return { kind: "forward", line: JSON.stringify(m) };
    case "control_request":
      return control(m, setup);
    default:
      return { kind: "drop", why: `type ${String(m.type)}` };
  }
}

function control(m: Obj, setup: Setup): Inbound {
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
    return (setup.mode ? r.mode === setup.mode : MODES.has(String(r.mode)))
      ? { kind: "forward", line: JSON.stringify(m) }
      : refuse(id, `permission mode ${String(r.mode)} is not allowed here`);
  if (PASS.has(sub)) return { kind: "forward", line: JSON.stringify(m) };
  return refuse(id, `${sub} is not allowed in setup ${setup.name}`);
}

/** An alias the setup lists (`sonnet`), or that alias's full id (`claude-sonnet-5-5`, as the CLI's model list gives it). */
function offers(setup: Setup, model: string): boolean {
  return [setup.model, ...(setup.models ?? [])].some(
    (a) => model === a || model.startsWith(`claude-${a}-`),
  );
}
