/**
 * What a portal command meant, for autotrack (the recorder in wren_automation/autotrack). `call` in
 * `api.ts` is the one place every user command goes out to the API, so it tells autotrack there: a
 * `window.postMessage({autotrack:{v:1, action, detail}})` per command, which the recorder's browser
 * extension forwards and joins to the click that caused it. `action` is the command's name,
 * `detail` is `{ids?, ok, error?}`: the record ids it named and whether the API said yes. Never a
 * field value, a message body, a token or the server's own error text. Reads (lists, counts, the
 * hourly waiting poll) say nothing. With no extension, nobody listens.
 * Not covered: the signed PUT in `uploadFile`, dictation audio, live notes (a socket), the public
 * booking page's `fetch`, sign-in and View as (navigation).
 */
const MAX_IDS = 10;
const MAX_STR = 80;
const ID_KEY = /^(id|ids|client|record)$|[a-z]Ids?$/;
/** A handler that only reads: `list…`, `get…`, `records{List,Get,Stats,Types,Counts,Export}`, or a named view. */
const READ_WORD =
  /^(get|list|find|read|load|fetch|count|search|browse|preview|peek|poll|check)([A-Z]|$)/;
const READ_RECORDS = /^records(List|Get|Stats|Types|Counts|Export)$/;
const READ_NAMES = new Set([
  "me",
  "home",
  "overview",
  "now",
  "status",
  "today",
  "rail",
  "board",
  "range",
  "detail",
  "item",
  "reports",
  "usage",
  "vendors",
  "accounts",
  "connectors",
  "social",
  "mail",
  "work",
  "dictation",
  "dictated",
  "linkTargets",
  "templates",
  "webhooks",
  "domains",
  "tokens",
  "loops",
  "agents",
  "snippets",
  "surveysDue",
  "workflowsMade",
  "workflowDoors",
  "templateInstalls",
  "templatePlan",
  "replay",
]);

const readOnly = (name: string) =>
  READ_WORD.test(name) || READ_RECORDS.test(name) || READ_NAMES.has(name);

/**
 * The command's name, or null for a read. A generic `console/call` names its service and handler
 * (`console/call:ContentDesk.approve`); any other path is its own name (`marketing/approveDraft`).
 */
export function commandOf(path: string, body: Record<string, unknown>): string | null {
  const handler = path.slice(path.lastIndexOf("/") + 1);
  if (path === "console/call") {
    const { service, handler: h } = body;
    if (typeof h !== "string" || typeof service !== "string") return path;
    return readOnly(h) ? null : `${path}:${service}.${h}`.slice(0, 96);
  }
  return readOnly(handler) ? null : path.slice(0, 96);
}

type Plain = string | number;
const plain = (x: unknown): x is Plain => typeof x === "string" || typeof x === "number";
const clip = (x: Plain): Plain => (typeof x === "string" ? x.slice(0, MAX_STR) : x);

/** The record ids a call names: `id`, `ids`, `client`, `record`, `*Id`, `*Ids`; also one level into `input`. */
export function callIds(body: Record<string, unknown>): Record<string, unknown> | null {
  const ids: Record<string, unknown> = {};
  const take = (from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      if (!ID_KEY.test(k) || k in ids) continue;
      if (plain(v)) ids[k] = clip(v);
      else if (Array.isArray(v)) ids[k] = v.filter(plain).slice(0, MAX_IDS).map(clip);
    }
  };
  take(body);
  const input = body.input;
  if (input && typeof input === "object" && !Array.isArray(input))
    take(input as Record<string, unknown>);
  return Object.keys(ids).length ? ids : null;
}

/** A short code for how a call failed: never the server's message. */
export const errorCode = (status: number) => (status === 0 ? "offline" : `http_${status}`);

/** Tell autotrack a command finished. `status` 0 = never reached the API. */
export function tellAutotrack(path: string, body: Record<string, unknown>, status: number) {
  const action = commandOf(path, body);
  if (!action) return;
  const ids = callIds(body);
  const ok = status >= 200 && status < 300;
  try {
    postMessage(
      {
        autotrack: {
          v: 1,
          action,
          detail: { ...(ids && { ids }), ok, ...(!ok && { error: errorCode(status) }) },
        },
      },
      location.origin,
    );
  } catch {
    // No window (a test): nobody to tell.
  }
}
