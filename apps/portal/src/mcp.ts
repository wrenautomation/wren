/**
 * `POST /api/mcp`: Wren for AI tools, over MCP's Streamable HTTP (designs/2026-10-09-mcp.md).
 * Stateless: one JSON-RPC message in, one JSON answer out, no SSE and no session. A `wren_`
 * token is read through `Tokens/check`, then each tool forwards to the console's own route as
 * that person, so the portal's guard decides everything. A refusal comes back as a tool result
 * with `isError`, in the guard's words, so the model reads why.
 */
import { readBody } from "@wren/core/http";
import { forward, json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { rawKeyRefusal } from "./keys.js";

export const MCP_PATH = "/api/mcp";
const MAX_BODY = 64 * 1024;
/** The newest first; an older client gets its own back when we speak it. */
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIST_MAX = 50;

type Viewer = { email: string; operator?: true };
type Who = { viewer: Viewer; pin: { client?: string; asClient?: true }; origin: object };
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Args = Record<string, unknown>;

const obj = { type: "object" } as const;
const str = (description: string) => ({ type: "string", description });
const READ = { readOnlyHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "list_record_types",
    title: "Record types",
    description:
      "Every record type this login can read: its id, name, fields and saved views. Start here.",
    inputSchema: { ...obj, properties: {} },
    annotations: READ,
  },
  {
    name: "list_records",
    title: "List records",
    description:
      "One record type's rows, a page at a time. Pass `next` back as `cursor` for the next page.",
    inputSchema: {
      ...obj,
      properties: {
        record: str("A record type's id, from list_record_types."),
        view: str("A saved view's id; absent, every row."),
        q: str("Search words."),
        where: { ...obj, description: "Field filters, as the type's fields name them." },
        sort: str('A sortable field; "-" first for descending.'),
        cursor: str("`next` from the page before."),
        limit: { type: "integer", minimum: 1, maximum: LIST_MAX },
      },
      required: ["record"],
    },
    annotations: READ,
  },
  {
    name: "get_record",
    title: "Get a record",
    description: "One row with its detail, related counts and activity.",
    inputSchema: {
      ...obj,
      properties: { record: str("A record type's id."), id: { type: ["string", "number"] } },
      required: ["record", "id"],
    },
    annotations: READ,
  },
  {
    name: "list_handlers",
    title: "List handlers",
    description:
      "Wren's team only: the handlers call_handler can run, with whether each has an effect.",
    inputSchema: { ...obj, properties: { q: str("Search words.") } },
    annotations: READ,
  },
  {
    name: "describe_handler",
    title: "Describe a handler",
    description: "Wren's team only: one handler's input schema, by its `Service/handler` id.",
    inputSchema: { ...obj, properties: { id: str("`Service/handler`.") }, required: ["id"] },
    annotations: READ,
  },
  {
    name: "call_handler",
    title: "Call a handler",
    description:
      "Runs one handler as this login. One with an effect runs only with `confirm` set to the handler's name. Ask the person first.",
    inputSchema: {
      ...obj,
      properties: {
        service: str("The service."),
        handler: str("The handler."),
        key: str("The object's or workflow's key; a plain service takes none."),
        input: { description: "The handler's input, as describe_handler gives its schema." },
        confirm: str("The handler's name, for one with an effect."),
      },
      required: ["service", "handler"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
] as const;

const INSTRUCTIONS =
  "Wren's records and handlers, as the person who made this token sees them. Read with list_record_types, list_records and get_record. A handler with an effect changes something real: ask before calling it.";

const rpc = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
const text = (v: unknown, isError = false) => ({
  content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }],
  ...(isError ? { isError: true } : {}),
});

/** Who the bearer token acts as, or the 401 that sends the client to sign in again. */
async function whoOf(req: Request, env: Env, site: Site): Promise<Who | Response> {
  const unauthorized = (why: string) =>
    new Response(JSON.stringify({ error: why }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "www-authenticate": `Bearer realm="wren", error="invalid_token"`,
      },
    });
  const m = /^Bearer\s+(wren_[A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return unauthorized("Send a Wren access token: Authorization: Bearer wren_…");
  const res = await forward(env, "Tokens/check", JSON.stringify({ token: m[1] }));
  if (!res.ok) return json({ error: "Couldn't check the token." }, 502);
  const t = (await res.json().catch(() => null)) as {
    email?: string;
    operator?: boolean;
    client?: string | null;
  } | null;
  if (!t?.email) return unauthorized("This token is unknown, removed or expired.");
  const viewer: Viewer = t.operator ? { email: t.email, operator: true } : { email: t.email };
  let client = t.client ?? undefined;
  if (site.kind === "client") {
    if (client && client !== site.client)
      return unauthorized("This token is for another workspace.");
    client = site.client;
  }
  const origin = { ip: req.headers.get("cf-connecting-ip"), agent: req.headers.get("user-agent") };
  return { viewer, pin: client ? { client, asClient: true } : {}, origin };
}

/** One console route as this person: its answer, or the guard's words as an error result. */
async function consoleCall(env: Env, who: Who, route: string, input: Args) {
  const refused = rawKeyRefusal(`console/${route}`, input);
  if (refused) return text(((await refused.json()) as { error: string }).error, true);
  const res = await forward(
    env,
    `ConsolePortal/${route}`,
    JSON.stringify({ ...input, ...who.pin, viewer: who.viewer, origin: who.origin }),
  );
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) return text(body?.message ?? body?.error ?? `Refused (${res.status}).`, true);
  return text(body);
}

const pick = (a: Args, keys: readonly string[]): Args =>
  Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));

async function callTool(env: Env, who: Who, name: string, a: Args) {
  const team = () => (who.viewer.operator ? null : text("Wren's team only.", true));
  switch (name) {
    case "list_record_types":
      return consoleCall(env, who, "recordsTypes", {});
    case "list_records": {
      const limit = Math.min(Math.max(Number(a.limit) || 20, 1), LIST_MAX);
      return consoleCall(env, who, "recordsList", {
        ...pick(a, ["record", "view", "q", "where", "sort", "cursor"]),
        limit,
      });
    }
    case "get_record":
      return consoleCall(env, who, "recordsGet", pick(a, ["record", "id"]));
    case "list_handlers":
      return (
        team() ??
        consoleCall(env, who, "recordsList", {
          record: "console.handler",
          ...pick(a, ["q"]),
          limit: 200,
        })
      );
    case "describe_handler":
      return team() ?? consoleCall(env, who, "recordsGet", { record: "console.handler", id: a.id });
    case "call_handler":
      return consoleCall(
        env,
        who,
        "call",
        pick(a, ["service", "handler", "key", "input", "confirm"]),
      );
    default:
      return null;
  }
}

export async function mcpRoute(req: Request, env: Env, site: Site): Promise<Response> {
  if (site.kind === "demo") return json({ error: "Not on the demo." }, 404);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const who = await whoOf(req, env, site);
  if (who instanceof Response) return who;
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return rpcError(null, -32600, "Too large.", 413);
  let msg: Rpc;
  try {
    msg = JSON.parse(raw) as Rpc;
  } catch {
    return rpcError(null, -32700, "Not JSON.", 400);
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string")
    return rpcError(msg?.id, -32600, "One JSON-RPC request per POST.", 400);
  // A notification or a response wants no answer.
  if (msg.id === undefined) return new Response(null, { status: 202 });
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Args;
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return rpc(msg.id, {
        protocolVersion: VERSIONS.includes(asked as string) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "wren", title: "Wren", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpc(msg.id, {});
    case "tools/list":
      return rpc(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (
        params.arguments && typeof params.arguments === "object" ? params.arguments : {}
      ) as Args;
      const out = await callTool(env, who, name, args);
      return out ? rpc(msg.id, out) : rpcError(msg.id, -32602, `No tool ${name}.`);
    }
    default:
      return rpcError(msg.id, -32601, `No method ${msg.method}.`);
  }
}
