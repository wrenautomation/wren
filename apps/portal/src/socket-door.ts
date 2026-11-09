/**
 * The door every live socket shares (./watch.ts, ./topics.ts): a WebSocket upgrade, from our own
 * page, signed in, never on the demo. The token rides in `Sec-WebSocket-Protocol` (`<proto>, <token>`).
 */
import { json } from "./edge.js";
import type { Site } from "./hosts.js";
import type { Viewer } from "./worker.js";

export type SignedIn = Exclude<Viewer, { demo: true }>;

/** The signed-in viewer, or the refusal to send. */
export async function socketDoor(
  req: Request,
  site: Site,
  protocol: string,
  viewerOf: (req: Request) => Promise<Viewer | Response>,
): Promise<SignedIn | Response> {
  if (site.kind === "demo") return json({ error: "not found" }, 404);
  if ((req.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
    return json({ error: "WebSocket only" }, 426);
  let from = "";
  try {
    from = new URL(req.headers.get("origin") ?? "").host;
  } catch {
    // no origin: refused below
  }
  if (from !== new URL(req.url).host) return json({ error: "wrong origin" }, 403);
  const [proto, token] = (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((s) => s.trim());
  if (proto !== protocol || !token) return json({ error: "Sign in." }, 401);
  const viewer = await viewerOf(
    new Request(req.url, { headers: { authorization: `Bearer ${token}` } }),
  );
  if (viewer instanceof Response) return viewer;
  if ("demo" in viewer) return json({ error: "Sign in." }, 401);
  return viewer as SignedIn;
}

/** A hibernating server socket for a DO; the 101 answers with the protocol the tab asked for. */
export function acceptSocket(
  state: DurableObjectState,
  protocol: string,
): { res: Response; socket: WebSocket } {
  const pair = new WebSocketPair();
  state.acceptWebSocket(pair[1]);
  const res = new Response(null, {
    status: 101,
    webSocket: pair[0],
    headers: { "sec-websocket-protocol": protocol },
  });
  return { res, socket: pair[1] };
}
