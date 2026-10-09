/**
 * `/api/agent`: Wren for AI tools, by a CLI and a skill (designs/2026-10-09-ai-tools.md). Plain
 * HTTP: `GET /api/agent` lists the tools, `POST /api/agent/<tool>` runs one with a JSON body. A
 * `wren_` token is read through `Tokens/check`, then each tool forwards to the console's own route
 * as that person, so the portal's guard decides everything. A refusal is a 4xx with `{error}` in
 * the guard's words, so the agent reads why. The CLI and the skill are static, under `/agent/`.
 */
import { readBody } from "@wren/core/http";
import { forward, json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { rawKeyRefusal } from "./keys.js";

export const AGENT_PATH = "/api/agent";
const MAX_BODY = 64 * 1024;
const LIST_MAX = 50;

type Viewer = { email: string; operator?: true };
type Who = { viewer: Viewer; pin: { client?: string; asClient?: true }; origin: object };
type Args = Record<string, unknown>;

/** Each tool, its CLI command and what it takes. The CLI's help reads this. */
export const TOOLS = [
  {
    name: "types",
    description:
      "Every record type this login can read: id, name, fields, saved views. Start here.",
    args: {},
    read: true,
  },
  {
    name: "list",
    description: "One record type's rows, a page at a time. Pass `next` back as `cursor`.",
    args: {
      record: "a type's id, from types",
      view: "a saved view's id",
      q: "search words",
      where: "field filters, as the type names its fields",
      sort: 'a sortable field, "-" first for descending',
      cursor: "`next` from the page before",
      limit: `1 to ${LIST_MAX}`,
    },
    read: true,
  },
  {
    name: "get",
    description: "One row with its detail, related counts and activity.",
    args: { record: "a type's id", id: "the row's id" },
    read: true,
  },
  {
    name: "handlers",
    description: "Wren's team only: the handlers `call` runs, and whether each has an effect.",
    args: { q: "search words" },
    read: true,
  },
  {
    name: "describe",
    description: "Wren's team only: one handler's input schema, by `Service/handler`.",
    args: { id: "Service/handler" },
    read: true,
  },
  {
    name: "call",
    description:
      "Runs one handler as this login. One with an effect runs only with `confirm` set to the handler's name. Ask the person first.",
    args: {
      service: "the service",
      handler: "the handler",
      key: "the object's or workflow's key",
      input: "the handler's input, as describe gives its schema",
      confirm: "the handler's name, for one with an effect",
    },
    read: false,
  },
] as const;

/** Who the bearer token acts as, or the 401 that sends the agent back for a token. */
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

/** One console route as this person: its answer, or the guard's words with its status. */
async function consoleCall(env: Env, who: Who, route: string, input: Args): Promise<Response> {
  const refused = rawKeyRefusal(`console/${route}`, input);
  if (refused) return refused;
  const res = await forward(
    env,
    `ConsolePortal/${route}`,
    JSON.stringify({ ...input, ...who.pin, viewer: who.viewer, origin: who.origin }),
  );
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok)
    return json({ error: body?.message ?? body?.error ?? `Refused (${res.status}).` }, res.status);
  return json(body);
}

const pick = (a: Args, keys: readonly string[]): Args =>
  Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));

function runTool(env: Env, who: Who, name: string, a: Args): Promise<Response> | Response | null {
  const team = () => (who.viewer.operator ? null : json({ error: "Wren's team only." }, 403));
  switch (name) {
    case "types":
      return consoleCall(env, who, "recordsTypes", {});
    case "list": {
      const limit = Math.min(Math.max(Number(a.limit) || 20, 1), LIST_MAX);
      return consoleCall(env, who, "recordsList", {
        ...pick(a, ["record", "view", "q", "where", "sort", "cursor"]),
        limit,
      });
    }
    case "get":
      return consoleCall(env, who, "recordsGet", pick(a, ["record", "id"]));
    case "handlers":
      return (
        team() ??
        consoleCall(env, who, "recordsList", {
          record: "console.handler",
          ...pick(a, ["q"]),
          limit: 200,
        })
      );
    case "describe":
      return team() ?? consoleCall(env, who, "recordsGet", { record: "console.handler", id: a.id });
    case "call":
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

export async function agentRoute(req: Request, env: Env, site: Site): Promise<Response> {
  if (site.kind === "demo") return json({ error: "Not on the demo." }, 404);
  const { pathname } = new URL(req.url);
  if (pathname === AGENT_PATH) {
    if (req.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
    return json({ tools: TOOLS });
  }
  const name = pathname.slice(AGENT_PATH.length + 1);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const who = await whoOf(req, env, site);
  if (who instanceof Response) return who;
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return json({ error: "Too large." }, 413);
  let args: unknown;
  try {
    args = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "Not JSON." }, 400);
  }
  if (!args || typeof args !== "object" || Array.isArray(args))
    return json({ error: "Send one JSON object." }, 400);
  return (await runTool(env, who, name, args as Args)) ?? json({ error: `No tool ${name}.` }, 404);
}
