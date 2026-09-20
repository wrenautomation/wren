// The open-tracking pixel host.
//
// Two routes and nothing else:
//
//   GET /p/<token>.gif   the pixel. Always 200, always the same 1x1 GIF,
//                        whether or not the token is one of ours — an
//                        unknown token must be indistinguishable from a
//                        known one, or the URL space becomes an oracle
//                        for whoever probes it.
//   GET /export?since=N  the hits since row N, for OpensScheduler/fleet.
//                        Bearer-authenticated; this is the only route that
//                        can say anything about what we hold.
//
// What is stored is the minimum that makes an open readable: the token,
// when the fetch arrived, and the user agent. No IP address, no country,
// no headers beyond the one — a recipient's address is already personal
// data on our side, and their network is not ours to keep.

const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function gif() {
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      // Every fetch must reach us: a cached pixel is an open we never see,
      // and Gmail's image proxy caches aggressively by default.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Content-Length": String(PIXEL.length),
    },
  });
}

async function record(env, token, request) {
  await env.DB.prepare("INSERT INTO hits (token, seen_at, user_agent) VALUES (?, ?, ?)")
    .bind(token, new Date().toISOString(), (request.headers.get("user-agent") || "").slice(0, 512))
    .run();
}

async function exportHits(env, url, request) {
  const secret = env.EXPORT_TOKEN;
  const offered = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // Constant-time-ish: compare full strings, never short-circuit on length
  // alone, and refuse when the binding is missing rather than allowing all.
  if (!secret || offered.length !== secret.length || offered !== secret) {
    return new Response("no", { status: 401 });
  }
  const since = Number.parseInt(url.searchParams.get("since") || "0", 10);
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") || "1000", 10), 5000);
  const { results } = await env.DB.prepare(
    "SELECT id, token, seen_at, user_agent FROM hits WHERE id > ? ORDER BY id LIMIT ?",
  )
    .bind(Number.isFinite(since) ? since : 0, limit)
    .all();
  return new Response(JSON.stringify({ hits: results }), {
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("no", { status: 405 });

    if (url.pathname === "/export") return exportHits(env, url, request);

    const match = url.pathname.match(/^\/p\/([^/]+)\.gif$/);
    if (!match) return new Response("no", { status: 404 });

    // The write never delays or fails the image: a D1 hiccup must not turn
    // into a broken-image icon in a prospect's inbox.
    if (TOKEN.test(match[1])) ctx.waitUntil(record(env, match[1], request).catch(() => {}));
    return gif();
  },
};
