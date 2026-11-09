/**
 * Live topics (designs/2026-11-08-live-topics.md). A writer that committed (Lambda, CLI) POSTs
 * `/api/live/changed`, signed with `LIVE_HOOK_SECRET` (`tellLive` in @wren/core/live). One
 * `LiveRoom` DO per site (`app`, `client:<id>`) pushes the topics to its tabs over
 * `/api/live/topics`; each tab reads those keys again. Topics only, never data.
 */
import {
  LIVE_HOOK_PATH,
  LIVE_SIG_HEADER,
  LIVE_TS_HEADER,
  liveTopics,
  liveVerify,
} from "@wren/core/live";
import { json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { acceptSocket, socketDoor } from "./socket-door.js";
import type { Viewer } from "./worker.js";

export { LIVE_HOOK_PATH };
export const TOPICS_LIVE_PATH = "/api/live/topics";
export const TOPICS_PROTOCOL = "wren-topics";
const BODY_MAX = 4096;
const CLIENT_ID = /^[a-z0-9_-]{1,64}$/;

/** What a tab hears. */
export interface TopicsNews {
  type: "changed";
  topics: string[];
}

/** One room per site; operators sit in `app`. */
export const roomOf = (site: Site) =>
  site.kind === "client" ? `client:${site.client}` : site.kind;

/** The tab's socket, through the shared door. */
export async function topicsSocketRoute(
  req: Request,
  env: Env,
  site: Site,
  viewerOf: (req: Request) => Promise<Viewer | Response>,
): Promise<Response> {
  if (!env.LIVE_ROOM) return json({ error: "not found" }, 404);
  const viewer = await socketDoor(req, site, TOPICS_PROTOCOL, viewerOf);
  if (viewer instanceof Response) return viewer;
  const ns = env.LIVE_ROOM;
  return ns
    .get(ns.idFromName(roomOf(site)))
    .fetch(new Request("https://live-room/socket", { headers: { upgrade: "websocket" } }));
}

/** The writer's signed POST: `app` hears it, and the named client's room. */
export async function topicsHookRoute(req: Request, env: Env, site: Site): Promise<Response> {
  if (site.kind !== "app" || !env.LIVE_ROOM || !env.LIVE_HOOK_SECRET)
    return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.text();
  if (body.length > BODY_MAX) return json({ error: "too big" }, 413);
  const ok = await liveVerify(
    env.LIVE_HOOK_SECRET,
    req.headers.get(LIVE_TS_HEADER) ?? "",
    body,
    req.headers.get(LIVE_SIG_HEADER) ?? "",
  );
  if (!ok) return json({ error: "bad signature" }, 401);
  let asked: { topics?: unknown; client?: unknown };
  try {
    asked = JSON.parse(body) as typeof asked;
  } catch {
    return json({ error: "not json" }, 400);
  }
  const topics = liveTopics(Array.isArray(asked.topics) ? asked.topics : []);
  if (!topics.length) return json({ error: "no topics" }, 400);
  const client =
    typeof asked.client === "string" && CLIENT_ID.test(asked.client) ? asked.client : null;
  const rooms = ["app", ...(client ? [`client:${client}`] : [])];
  const ns = env.LIVE_ROOM;
  const news: TopicsNews = { type: "changed", topics };
  const told = await Promise.all(
    rooms.map((r) =>
      ns
        .get(ns.idFromName(r))
        .fetch(
          new Request("https://live-room/tell", { method: "POST", body: JSON.stringify(news) }),
        )
        .then((res) => res.json() as Promise<{ tabs: number }>)
        .then((a) => a.tabs)
        .catch(() => 0),
    ),
  );
  return json({ tabs: told.reduce((a, b) => a + b, 0) });
}

/** The bits of a socket the room uses (a test hands in fakes). */
export interface RoomSocket {
  send(frame: string): void;
}

export class LiveRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/socket") {
      if ((req.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
        return json({ error: "WebSocket only" }, 426);
      return acceptSocket(this.state, TOPICS_PROTOCOL).res;
    }
    if (pathname === "/tell" && req.method === "POST")
      return json({ tabs: this.tell(this.state.getWebSockets(), await req.text()) });
    return json({ error: "not found" }, 404);
  }

  /** Send the frame to each socket; the count that took it. */
  tell(sockets: readonly RoomSocket[], frame: string): number {
    let n = 0;
    for (const s of sockets)
      try {
        s.send(frame);
        n++;
      } catch {
        // gone: its close comes
      }
    return n;
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "error");
    } catch {
      // already closed
    }
  }
}
