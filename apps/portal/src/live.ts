/**
 * Live notes (designs/2026-10-07-notes.md, "Live editing"): `/api/notes/live/<id>` opens a
 * WebSocket to that note's room, one Durable Object per note (`NoteRoom`), which runs
 * `@wren/notes/room`. The Worker signs the person in; the room asks the service, as them, what
 * they may do, on join and on every poll. Without the binding, or on the demo, the browser syncs
 * over plain HTTP as before.
 *
 * The token rides in `Sec-WebSocket-Protocol` (`wren-notes, <token>`): a browser can't set an
 * Authorization header on a WebSocket. The origin must be this host.
 */
import {
  LIVE_PREFIX,
  PROTOCOL,
  Room,
  RoomRefusal,
  type Socket,
  type SyncAnswer,
} from "@wren/notes/room";
import { forward, json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import { SERVICES } from "./services.js";
import type { Viewer } from "./worker.js";

const JOIN = "x-note-join";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Join {
  id: string;
  email: string;
  /** What each call as them carries: the viewer, the workspace or the host's pin, the origin. */
  as: Record<string, unknown>;
}

/** The socket's door: who, which note, which workspace. */
export async function liveRoute(
  req: Request,
  env: Env,
  site: Site,
  viewerOf: (req: Request) => Promise<Viewer | Response>,
): Promise<Response> {
  const url = new URL(req.url);
  const id = url.pathname.slice(LIVE_PREFIX.length);
  if (!UUID.test(id)) return json({ error: "not found" }, 404);
  if ((req.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
    return json({ error: "WebSocket only" }, 426);
  if (site.kind === "demo") return json({ error: "The demo isn't live." }, 404);
  if (!env.NOTE_ROOM) return json({ error: "Live editing isn't set up." }, 503);
  // Another site's page can open a socket anywhere: only our own page may open this one.
  let from = "";
  try {
    from = new URL(req.headers.get("origin") ?? "").host;
  } catch {
    // No origin: refused below.
  }
  if (from !== url.host) return json({ error: "wrong origin" }, 403);
  const [proto, token] = (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((s) => s.trim());
  if (proto !== PROTOCOL || !token) return json({ error: "Sign in." }, 401);
  const viewer = await viewerOf(
    new Request(req.url, { headers: { authorization: `Bearer ${token}` } }),
  );
  if (viewer instanceof Response) return viewer;
  if ("demo" in viewer) return json({ error: "Sign in." }, 401);
  const client = url.searchParams.get("client");
  // A client's host is that client, as the client sees it; elsewhere the workspace asked for.
  const pin =
    site.kind === "client"
      ? { client: site.client, asClient: true }
      : client && client.length <= 200
        ? { client }
        : {};
  const join: Join = {
    id,
    email: viewer.email,
    as: {
      ...pin,
      viewer,
      origin: { ip: req.headers.get("cf-connecting-ip"), agent: req.headers.get("user-agent") },
    },
  };
  const room = env.NOTE_ROOM.get(env.NOTE_ROOM.idFromName(id));
  return room.fetch(
    new Request("https://note-room/join", {
      headers: { upgrade: "websocket", [JOIN]: JSON.stringify(join) },
    }),
  );
}

/** `NotesConsole/sync` as the person in `as`. */
export async function syncAs(
  env: Env,
  as: Record<string, unknown>,
  body: { id: string; update: string; sv: string },
): Promise<SyncAnswer> {
  const res = await forward(
    env,
    `${SERVICES.notes?.name}/sync`,
    JSON.stringify({ ...body, ...as }),
  );
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // An edge error page.
  }
  if (!res.ok || !data)
    return {
      ok: false,
      status: res.status === 200 ? 502 : res.status,
      message: String(data?.message ?? data?.error ?? `status ${res.status}`),
    };
  return { ok: true, ...(data as Omit<Extract<SyncAnswer, { ok: true }>, "ok">) };
}

/**
 * One note's room. Plain sockets, not hibernation: a room lives while someone has the note open,
 * and its doc is in memory meanwhile.
 */
export class NoteRoom implements DurableObject {
  private room: Room | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly bindings: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    let join: Join;
    try {
      join = JSON.parse(req.headers.get(JOIN) ?? "") as Join;
    } catch {
      return json({ error: "bad join" }, 400);
    }
    if (!this.room || this.room.closed) {
      const room: Room = new Room(join.id, {
        sync: (as, body) => syncAs(this.bindings, as, body),
        later: (work) => this.state.waitUntil(work),
        onEmpty: () => {
          if (this.room === room) this.room = null;
        },
      });
      this.room = room;
    }
    const room = this.room;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const socket: Socket = {
      send: (frame) => server.send(frame),
      close: (code, reason) => {
        try {
          server.close(code, reason);
        } catch {
          // Already closed.
        }
      },
    };
    let peer: Awaited<ReturnType<Room["join"]>>;
    try {
      peer = await room.join(socket, { email: join.email, as: join.as });
    } catch (err) {
      const status = err instanceof RoomRefusal ? err.status : 503;
      return json({ error: err instanceof Error ? err.message : "no room" }, status);
    }
    server.accept();
    server.addEventListener("message", (e) => {
      if (typeof e.data === "string") room.message(peer, e.data);
      else socket.close(1003, "text only");
    });
    const out = () => {
      room.leave(peer);
      socket.close(1000, "bye");
    };
    server.addEventListener("close", out);
    server.addEventListener("error", out);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": PROTOCOL },
    });
  }
}
