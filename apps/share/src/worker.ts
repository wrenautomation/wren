/**
 * share.wrenautomation.com: where autobrowse installs send scrubbed run traces and flow packs
 * (autobrowse designs/2026-10-24-shared-library.md). Public routes take a file into the
 * private `inbox/` prefix of the R2 bucket, with a size cap and a rate cap per install id and
 * per IP. Nothing in `inbox/` is read by a model or a person: the second scrub (Presidio, on
 * the desk) reads it through the admin routes and writes `kept/`.
 *   PUT /v1/traces/<name>.zip, PUT /v1/flows/<name>.json   header x-install: the random id
 *   GET /admin/list?prefix=&cursor=, GET|PUT|DELETE /admin/object/<key>   bearer ADMIN_TOKEN
 *   GET /health
 */

export interface Env {
  SHARE: R2Bucket;
  INSTALL_LIMIT: RateLimit;
  IP_LIMIT: RateLimit;
  ADMIN_TOKEN: string;
}

export const MAX_TRACE = 8 * 1024 * 1024;
export const MAX_FLOW = 1024 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const INSTALL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What the admin may write: the second pass's output and the registry's state. */
const WRITABLE = /^(kept|flows|gate)\//;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (status: number, error: string) => json({ error }, status);

async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))),
  );
  // Digests are equal length, so an XOR over every byte takes the same time either way.
  const p = new Uint8Array(x as ArrayBuffer);
  const q = new Uint8Array(y as ArrayBuffer);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= (p[i] ?? 0) ^ (q[i] ?? 0);
  return diff === 0;
}

async function take(req: Request, env: Env, kind: "traces" | "flows", name: string) {
  const install = req.headers.get("x-install")?.toLowerCase() ?? "";
  if (!INSTALL.test(install)) return refuse(400, "x-install: a UUID");
  const ext = kind === "traces" ? ".zip" : ".json";
  if (!NAME.test(name) || !name.endsWith(ext)) return refuse(400, `name: [A-Za-z0-9._-], ${ext}`);
  const ip = req.headers.get("cf-connecting-ip") ?? "none";
  const [byInstall, byIp] = await Promise.all([
    env.INSTALL_LIMIT.limit({ key: install }),
    env.IP_LIMIT.limit({ key: ip }),
  ]);
  if (!byInstall.success || !byIp.success) return refuse(429, "slow down");
  const cap = kind === "traces" ? MAX_TRACE : MAX_FLOW;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > cap) return refuse(413, `over ${cap} bytes`);
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length) return refuse(400, "empty");
  if (body.length > cap) return refuse(413, `over ${cap} bytes`);
  if (kind === "traces" && !(body[0] === 0x50 && body[1] === 0x4b)) return refuse(415, "not a zip");
  if (kind === "flows") {
    try {
      JSON.parse(new TextDecoder().decode(body));
    } catch {
      return refuse(415, "not JSON");
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = `inbox/${day}/${install}/${kind}/${name}`;
  await env.SHARE.put(key, body, { customMetadata: { install, kind } });
  return json({ ok: true }, 201);
}

async function admin(req: Request, env: Env, path: string, url: URL) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.ADMIN_TOKEN || !(await same(auth, `Bearer ${env.ADMIN_TOKEN}`)))
    return refuse(401, "bearer");
  if (path === "list" && req.method === "GET") {
    const got = await env.SHARE.list({
      prefix: url.searchParams.get("prefix") ?? "inbox/",
      limit: 1000,
      ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor") ?? "" } : {}),
    });
    return json({
      keys: got.objects.map((o) => ({ key: o.key, size: o.size })),
      cursor: got.truncated ? got.cursor : null,
    });
  }
  if (!path.startsWith("object/")) return refuse(404, "no route");
  const key = decodeURIComponent(path.slice("object/".length));
  if (!key || key.includes("..")) return refuse(400, "key");
  if (req.method === "GET") {
    const o = await env.SHARE.get(key);
    return o ? new Response(o.body) : refuse(404, "none");
  }
  if (req.method === "DELETE") {
    await env.SHARE.delete(key);
    return json({ ok: true });
  }
  if (req.method === "PUT") {
    if (!WRITABLE.test(key)) return refuse(403, "kept/, flows/ or gate/ only");
    await env.SHARE.put(key, await req.arrayBuffer());
    return json({ ok: true }, 201);
  }
  return refuse(405, "method");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/health") return json({ ok: true });
    const pub = path.match(/^\/v1\/(traces|flows)\/([^/]+)$/);
    if (pub) {
      if (req.method !== "PUT") return refuse(405, "PUT");
      return take(req, env, pub[1] as "traces" | "flows", decodeURIComponent(pub[2] ?? ""));
    }
    if (path.startsWith("/admin/")) return admin(req, env, path.slice("/admin/".length), url);
    return refuse(404, "no route");
  },
} satisfies ExportedHandler<Env>;
