/**
 * Test helper: a fake `fetch` that keeps every call as the shape that matters on the wire. Tests
 * pin what a client sends (URL, method, headers, form fields) and what it makes of the answer, so
 * a refactor of the client proves it sends the same bytes. Field order in a form or a query never
 * counts; every map is sorted. Synthetic data only: the helper prints whatever it is given.
 */

export interface Wire {
  method: string;
  /** Origin and path, no query. */
  url: string;
  /** The query as a map; absent when the URL has none. */
  query?: Record<string, string>;
  /** Lower-cased names. */
  headers: Record<string, string>;
  /** A form-urlencoded body as a map. */
  form?: Record<string, string>;
  /** A JSON body. */
  json?: unknown;
  /** Any other string body. */
  text?: string;
}

const sorted = (entries: Iterable<[string, string]>) =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** One request as a `Wire`. */
export function wireOf(url: string, init?: RequestInit): Wire {
  const u = new URL(url);
  const headers = sorted(new Headers(init?.headers).entries());
  const wire: Wire = {
    method: (init?.method ?? "GET").toUpperCase(),
    url: u.origin + u.pathname,
    headers,
  };
  if ([...u.searchParams.keys()].length) wire.query = sorted(u.searchParams.entries());
  const body = init?.body;
  if (typeof body === "string") {
    const type = headers["content-type"] ?? "";
    if (type.includes("application/x-www-form-urlencoded"))
      wire.form = sorted(new URLSearchParams(body).entries());
    else if (type.includes("json")) wire.json = JSON.parse(body);
    else wire.text = body;
  }
  return wire;
}

/** A fake `fetch`. `route` answers by what was sent; an unrouted call answers 404 with `{}`. */
export function wireRecorder(
  route: (wire: Wire, n: number) => Response | undefined = () => undefined,
) {
  const calls: Wire[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const wire = wireOf(url, init);
    calls.push(wire);
    return route(wire, calls.length) ?? Response.json({}, { status: 404 });
  };
  return { fetch, calls };
}

/** A refusal as data: its class, name, code, `revoked` and message. */
export function shapeOfError(e: unknown) {
  const x = e as { code?: unknown; revoked?: unknown };
  return {
    isError: e instanceof Error,
    class: (e as object | null)?.constructor?.name,
    name: (e as Error | null)?.name,
    code: x?.code,
    revoked: x?.revoked,
    message: (e as Error | null)?.message,
  };
}
