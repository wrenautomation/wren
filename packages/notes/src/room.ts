/**
 * A note's live room (designs/2026-10-07-notes.md, "Live editing"): everyone with the note open
 * on one socket each. It relays Yjs updates and awareness (cursors, names) between them and
 * flushes edits to `NotesConsole/sync` a moment after they're made, as the person who made them,
 * and when the last person leaves. What the server wrote meanwhile (a CLI append, a restore)
 * comes back in that answer, or on the poll, and goes out to everyone.
 *
 * Pure: the portal Worker's Durable Object (`NoteRoom`) and the local preview both run it, each
 * with its own sockets and its own way to call the service.
 *
 * Frames are JSON, Yjs bytes as base64. In: `hello {sv}`, `update {update, seq}`,
 * `awareness {update}`, `poke` (it wrote over HTTP: poll now), `comments` (they changed: tell the
 * others). Out: `sync {update, sv, role}`, `update {update}`, `awareness {update}`,
 * `saved {seq, version, …}` (the server has edits up to `seq`), `role {role}` (shared up or
 * down), `refused {message, status}`, `comments`.
 */
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { fromB64, toB64 } from "./doc.js";
import { type Role, UPDATE_MAX } from "./types.js";

/** Where a browser opens a note's room: `<LIVE_PREFIX><id>?client=`. */
export const LIVE_PREFIX = "/api/notes/live/";
/** The socket's subprotocol; the sign-in token rides after it. */
export const PROTOCOL = "wren-notes";

/** Edits wait this long for more before they go to the server. */
export const FLUSH_AFTER = 1_500;
/** What the server wrote without the room, and whether each person may still open it. */
export const POLL_EVERY = 15_000;
/** The server unreachable: try again after. */
export const RETRY_AFTER = 5_000;
/** A frame's longest: a Yjs update's limit, base64 and the envelope. */
export const FRAME_MAX = Math.ceil((UPDATE_MAX * 4) / 3) + 1024;

/** One socket, as the room uses it. */
export interface Socket {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

/** Who joined, as the Worker signed them in. Their role comes from the server. */
export interface Seat {
  email: string;
  /** What each call as them carries: the viewer, the workspace, a client host's pin. */
  as: Record<string, unknown>;
}

/** Why a join was refused: the service's own status and words. */
export class RoomRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** `notes/sync`'s answer, or why not. */
export type SyncAnswer =
  | {
      ok: true;
      update: string;
      sv: string;
      version: number;
      name: string;
      updatedAt: string | null;
      editedBy: string | null;
      role: Role;
    }
  | { ok: false; status: number; message: string };

export interface RoomDeps {
  /** `NotesConsole/sync` as the person in `as`. */
  sync(
    as: Record<string, unknown>,
    body: { id: string; update: string; sv: string },
  ): Promise<SyncAnswer>;
  /** Keeps the host alive for a flush after the last socket closed. */
  later?: (work: Promise<unknown>) => void;
  /** The room is empty and has nothing left to send: the host may drop it. */
  onEmpty?: () => void;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Updates from the server: everyone gets them. */
const SERVER = Symbol("server");
/** Awareness the room itself removes (a socket left). */
const ROOM = Symbol("room");

export class Peer {
  readonly ids = new Set<number>();
  /** Edits not yet on the server, and the last one's number. */
  pending: Uint8Array[] = [];
  seq = 0;
  open = true;
  constructor(
    readonly socket: Socket,
    readonly email: string,
    public role: Role,
    readonly as: Record<string, unknown>,
  ) {}
  get edits() {
    return this.role === "edit" || this.role === "owner";
  }
  /** A commenter's edits are suggestions: the server checks them before anyone sees them. */
  get suggests() {
    return this.role === "comment";
  }
  send(frame: object) {
    if (!this.open) return;
    try {
      this.socket.send(JSON.stringify(frame));
    } catch {
      this.open = false;
    }
  }
}

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private readonly peers = new Set<Peer>();
  /** Left with edits unsent: flushed as them, then dropped. */
  private readonly leftovers = new Set<Peer>();
  /** Which socket set each awareness client: one can't speak for another. */
  private readonly owners = new Map<number, Peer>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private again = false;
  private turn = 0;
  private shut = false;

  constructor(
    readonly id: string,
    private readonly deps: RoomDeps,
  ) {
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const frame = { t: "update", update: toB64(update) };
      for (const p of this.peers) if (p !== origin) p.send(frame);
    });
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin instanceof Peer) {
          for (const id of [...added, ...updated]) {
            const owner = this.owners.get(id);
            if (owner && owner !== origin) {
              origin.socket.close(4400, "that cursor isn't yours");
              return;
            }
            this.owners.set(id, origin);
            origin.ids.add(id);
            // Who a cursor is: the room says, from the sign-in, never the browser.
            const state = this.awareness.states.get(id);
            if (state) state.user = { ...(state.user as object), email: origin.email };
          }
        }
        const changed = [...added, ...updated, ...removed];
        if (!changed.length) return;
        const frame = {
          t: "awareness",
          update: toB64(encodeAwarenessUpdate(this.awareness, changed)),
        };
        for (const p of this.peers) if (p !== origin) p.send(frame);
      },
    );
  }

  get size() {
    return this.peers.size;
  }

  /** Closed: the host makes a new room for whoever comes next. */
  get closed() {
    return this.shut;
  }

  /**
   * In, once the room has the server's latest as them (the first one in loads the doc). Refused
   * when the server refuses them or can't be reached.
   */
  async join(socket: Socket, seat: Seat): Promise<Peer> {
    if (this.shut) throw new Error("room closed");
    const out = await this.deps.sync(seat.as, {
      id: this.id,
      update: "",
      sv: toB64(Y.encodeStateVector(this.doc)),
    });
    if (!out.ok) throw new RoomRefusal(out.message, out.status);
    if (this.shut) throw new Error("room closed");
    Y.applyUpdate(this.doc, fromB64(out.update), SERVER);
    const p = new Peer(socket, seat.email.toLowerCase(), out.role, seat.as);
    this.peers.add(p);
    this.pollTimer ??= setInterval(() => void this.poll(), POLL_EVERY);
    return p;
  }

  /** A frame from `p`. A bad one closes its socket. */
  message(p: Peer, raw: string) {
    if (!this.peers.has(p)) return;
    if (raw.length > FRAME_MAX) return p.socket.close(1009, "too big");
    let f: { t?: unknown; sv?: unknown; update?: unknown; seq?: unknown };
    try {
      f = JSON.parse(raw);
    } catch {
      return p.socket.close(4400, "not json");
    }
    const bytes = (v: unknown) => (typeof v === "string" ? fromB64(v) : null);
    try {
      switch (f.t) {
        case "hello": {
          const sv = bytes(f.sv);
          p.send({
            t: "sync",
            update: toB64(Y.encodeStateAsUpdate(this.doc, sv ?? undefined)),
            sv: toB64(Y.encodeStateVector(this.doc)),
            role: p.role,
          });
          const ids = [...this.awareness.getStates().keys()];
          if (ids.length)
            p.send({ t: "awareness", update: toB64(encodeAwarenessUpdate(this.awareness, ids)) });
          return;
        }
        case "update": {
          const u = bytes(f.update);
          if (!u) return;
          if (!p.edits && !p.suggests)
            return p.send({ t: "refused", message: "you can't edit this note", status: 403 });
          p.pending.push(u);
          p.seq = Math.max(p.seq, Number(f.seq) || 0);
          if (p.edits) {
            // Everyone sees it now; the server has it in a moment.
            Y.applyUpdate(this.doc, u, p);
            this.soon(FLUSH_AFTER);
          } else this.soon(0);
          return;
        }
        case "awareness": {
          const u = bytes(f.update);
          if (u) applyAwarenessUpdate(this.awareness, u, p);
          return;
        }
        case "poke":
          return void this.poll();
        case "comments":
          for (const o of this.peers) if (o !== p) o.send({ t: "comments" });
          return;
        default:
          return;
      }
    } catch {
      p.socket.close(4400, "bad frame");
    }
  }

  /** Out: their cursor goes; their unsent edits go to the server; the last one out flushes. */
  leave(p: Peer) {
    if (!this.peers.delete(p)) return;
    p.open = false;
    if (p.ids.size) removeAwarenessStates(this.awareness, [...p.ids], ROOM);
    for (const id of p.ids) this.owners.delete(id);
    if (p.pending.length) this.leftovers.add(p);
    if (this.peers.size) return;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    const done = (async () => {
      await this.flush();
      // The server was down: once more shortly, then give up (their browsers keep a copy).
      if (this.leftovers.size && !this.peers.size) {
        await new Promise((r) => setTimeout(r, RETRY_AFTER));
        if (!this.peers.size) await this.flush();
      }
      if (!this.peers.size) this.close();
    })();
    this.deps.later?.(done);
  }

  /** Stop: timers off, awareness gone. */
  close() {
    if (this.shut) return;
    this.shut = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.awareness.destroy();
    this.deps.onEmpty?.();
  }

  private soon(ms: number) {
    if (this.closed) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, ms);
  }

  /** Every person's unsent edits to the server, as them, one person at a time. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      for (const p of [...this.peers, ...this.leftovers]) {
        if (!p.pending.length) {
          this.leftovers.delete(p);
          continue;
        }
        const sending = p.pending;
        const seq = p.seq;
        p.pending = [];
        const ok = await this.call(p, Y.mergeUpdates(sending), seq);
        // Unreachable: keep them for the next try.
        if (ok === "retry") {
          p.pending = [...sending, ...p.pending];
          this.soon(RETRY_AFTER);
          break;
        }
        if (!p.pending.length) this.leftovers.delete(p);
      }
    })().finally(() => {
      this.flushing = null;
      if (this.again && !this.closed) {
        this.again = false;
        if ([...this.peers, ...this.leftovers].some((p) => p.pending.length))
          this.soon(FLUSH_AFTER);
      }
    });
    return this.flushing;
  }

  /** What the server wrote without the room, asked as each person in turn: their access too. */
  async poll() {
    const all = [...this.peers];
    if (!all.length || this.closed) return;
    const p = all[this.turn++ % all.length] as Peer;
    await this.call(p, null, 0);
  }

  private async call(
    p: Peer,
    update: Uint8Array | null,
    seq: number,
  ): Promise<"ok" | "refused" | "retry"> {
    let out: SyncAnswer;
    try {
      out = await this.deps.sync(p.as, {
        id: this.id,
        update: update ? toB64(update) : "",
        sv: toB64(Y.encodeStateVector(this.doc)),
      });
    } catch {
      return "retry";
    }
    if (!out.ok) {
      if (out.status === 0 || out.status >= 500 || out.status === 429) return "retry";
      p.send({ t: "refused", message: out.message, status: out.status });
      if (out.status === 404) {
        // They can't open it any more: out of the room.
        p.socket.close(4404, "no such note");
        this.leave(p);
      } else if (out.status === 403 && update) {
        // An editor's access changed under them: they read from here on. A commenter's change
        // that did more than suggest is dropped; they stay a commenter.
        if (p.edits) p.role = "view";
        p.pending = [];
      }
      return "refused";
    }
    if (this.closed) return "ok";
    if (out.role !== p.role) {
      // Shared up or down while here.
      p.role = out.role;
      p.send({ t: "role", role: out.role });
    }
    const before = Y.encodeStateVector(this.doc);
    Y.applyUpdate(this.doc, fromB64(out.update), SERVER);
    const changed = !sameBytes(before, Y.encodeStateVector(this.doc));
    if (!update && !changed) return "ok";
    const meta = {
      version: out.version,
      name: out.name,
      updatedAt: out.updatedAt,
      editedBy: out.editedBy,
    };
    for (const o of this.peers)
      o.send({ t: "saved", seq: o === p && update ? seq : null, ...meta });
    return "ok";
  }
}
