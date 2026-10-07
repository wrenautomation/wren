/**
 * A client's own key, straight to its vendor (designs/2026-10-07-vendor-keys.md). Wren's keys
 * live with autobrowse (Exa's ring, the `x` and `youtube` sites); a client's own key never goes
 * there, since a Restate call journals its input. So the worker calls the vendor itself, in the
 * shape autobrowse answers the same route, and the call site can't tell which ran.
 *
 * Routes: `web GET /search` with `via: "exa"`, `x GET /2/*` and `youtube GET /youtube/v3/*`.
 * Anything else on an own key is refused with what runs, never sent on Wren's key.
 */
import type { FetchLike } from "./doh.js";

export interface DirectAnswer {
  ok: boolean;
  status: number;
  body: unknown;
}

const query = (input: Record<string, unknown> = {}, drop: string[] = []) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(input))
    if (v != null && !drop.includes(k)) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** Does an own key answer this call here? Null when it does; else why not. */
export function directRefusal(vendor: string, site: string, method: string, path: string) {
  if (method !== "GET") return `${vendor}: only reads run on your own key`;
  if (vendor === "exa" && site === "web" && path === "/search") return null;
  if (vendor === "x" && site === "x" && path.startsWith("/2/")) return null;
  if (vendor === "youtube" && site === "youtube" && path.startsWith("/youtube/v3/")) return null;
  return `${site} ${path} doesn't run on your own ${vendor} key yet`;
}

async function answer(res: Response): Promise<DirectAnswer> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, body };
}

/** One read on the client's own key. The key rides a header, never the URL. */
export async function directCall(
  vendor: string,
  key: string,
  site: string,
  path: string,
  input: Record<string, unknown> | undefined,
  fetch: FetchLike = globalThis.fetch,
): Promise<DirectAnswer> {
  const why = directRefusal(vendor, site, "GET", path);
  if (why) return { ok: false, status: 409, body: { error: why } };
  const timeout = { signal: AbortSignal.timeout(30_000) };
  if (vendor === "exa") {
    const q = String(input?.q ?? "");
    const n = Math.min(50, Math.max(1, Number(input?.n ?? 10) || 10));
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: q, numResults: n, type: "auto" }),
      ...timeout,
    });
    const a = await answer(res);
    if (!a.ok) return a;
    // autobrowse's `web /search` answer: hits with the whole result as `raw`.
    const results = ((a.body as { results?: { title?: string; url: string }[] })?.results ??
      []) as { title?: string; url: string }[];
    return {
      ok: true,
      status: 200,
      body: {
        query: q,
        hits: results.map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: null, raw: r })),
        via: "exa",
        tried: [],
      },
    };
  }
  if (vendor === "x") {
    const res = await fetch(`https://api.x.com${path}${query(input)}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      ...timeout,
    });
    return answer(res);
  }
  const res = await fetch(`https://www.googleapis.com${path}${query(input)}`, {
    headers: { "x-goog-api-key": key, accept: "application/json" },
    ...timeout,
  });
  return answer(res);
}

/**
 * What one read spent, in the vendor's unit: an X read is each post it returned; a YouTube
 * call its quota units (a search 100, any other list 1); an Exa search 1.
 */
export function unitsOfRead(vendor: string, path: string, body: unknown): number {
  if (vendor === "x") {
    const data = (body as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? data.length : data ? 1 : 0;
  }
  if (vendor === "youtube") return /\/search$/.test(path.split("?")[0] ?? "") ? 100 : 1;
  return 1;
}
