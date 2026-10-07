/**
 * A note's Yjs doc kept in step with everyone else. Live: one socket to the note's room
 * (`@wren/notes/room`, a Durable Object behind `/api/notes/live/<id>`), which relays edits and
 * cursors as they happen and saves them to the server as their author. No room (the demo, View
 * as, no binding, a dropped socket): plain HTTP over `notes/sync`, edits a moment after they're
 * made and others' on a poll, while the socket tries again.
 *
 * A copy lives in this browser (IndexedDB), so edits made offline survive a reload and merge when
 * the server is back. Whether anything is unsent is a count of local edits, not a diff's size: a
 * diff always carries the doc's deletions, so it is never empty once anything was deleted.
 */
import { fromB64, toB64 } from "@wren/notes/doc";
import { LIVE_PREFIX, PROTOCOL } from "@wren/notes/room";
import type { Role } from "@wren/notes/types";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { ApiError } from "../../api.js";
import { WREN } from "../../module.js";
import { notes } from "./api.js";

export type SyncState = "saved" | "saving" | "offline" | "failed";

/** Updates from the server or the room: the editor's undo ignores them, and they're never sent back. */
export const REMOTE = Symbol("server");

/** What the page hears about the note while it's open. */
export interface SyncHooks {
  onState: (s: SyncState) => void;
  onSaved: (out: { version: number; updatedAt: string | null; editedBy: string | null }) => void;
  onRefused: (message: string, status: number) => void;
  /** Shared up or down while open. */
  onRole: (role: Role) => void;
  /** Someone changed the comments: read them again. */
  onComments: () => void;
  onLive: (live: boolean) => void;
}

const PUSH_AFTER = 600;
const POLL_SHOWN = 5_000;
const POLL_IDLE = 30_000;
/** No key or pointer in this long: poll slowly. */
const IDLE_AFTER = 120_000;
/** Bigger than this goes over HTTP (a socket message tops out at 1 MB on the edge). */
const FRAME_MAX = 512 * 1024;
const RETRY_MAX = 30_000;

export class NoteSync {
  readonly doc = new Y.Doc();
  /** Who's here and where their cursor is. */
  readonly awareness = new Awareness(this.doc);
  private serverSv: Uint8Array;
  private local: IndexeddbPersistence | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private again = false;
  private stopped = false;
  private lastPoll = 0;
  private touched = Date.now();
  /** Local edits made, and how many of them the server has. */
  private edits = 0;
  private sentEdits = 0;
  private role: Role;
  private socket: WebSocket | null = null;
  private live = false;
  private tries = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  state: SyncState = "saved";

  constructor(
    private readonly o: {
      client: string;
      id: string;
      /** The doc as `open` answered, base64. */
      state: string;
      role: Role;
      hooks: SyncHooks;
      /** Keep a copy in this browser. */
      keepLocal: boolean;
      /** Join the live room; how to sign the socket in. */
      live: (() => Promise<string | null>) | null;
    },
  ) {
    this.role = o.role;
    Y.applyUpdate(this.doc, fromB64(o.state), REMOTE);
    this.serverSv = Y.encodeStateVector(this.doc);
    this.doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.edits++;
      if (!this.canSend) return;
      if (this.live) this.sendLive(u);
      else this.soon(PUSH_AFTER);
    });
    this.awareness.on("update", (_c: unknown, origin: unknown) => {
      if (origin === "local") this.sendCursor();
    });
    if (o.keepLocal) {
      try {
        this.local = new IndexeddbPersistence(`wren-note:${o.client}:${o.id}`, this.doc);
        // What this browser kept from an offline edit goes up once it's read.
        void this.local.whenSynced
          .then(() => {
            if (!this.lacking()) return;
            if (this.live) this.catchUp(null);
            else this.soon(0);
          })
          .catch(() => {});
      } catch {
        // No IndexedDB (a private window): the server's copy only.
      }
    }
    this.tick();
    addEventListener("online", this.now);
    document.addEventListener("visibilitychange", this.now);
    addEventListener("keydown", this.touch, true);
    addEventListener("pointerdown", this.touch, true);
    if (o.live) void this.connect();
  }

  /** Edits and suggestions go up; a viewer's never do. */
  private get canSend() {
    return this.role !== "view";
  }

  /** Whether this browser holds edits the server hasn't got. */
  lacking(): boolean {
    return this.canSend && this.edits > this.sentEdits;
  }

  /** Sync now: after a restore, after a comment, on coming back online. */
  readonly now = () => {
    if (document.visibilityState === "hidden") return;
    if (this.live) this.frame({ t: "poke" });
    else this.soon(0);
  };

  /** Tell the others the comments changed. */
  commented() {
    this.frame({ t: "comments" });
  }

  private readonly touch = () => {
    this.touched = Date.now();
  };

  private soon(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), ms);
  }

  /** The poll, without the room: often while someone's here, rarely when idle, never hidden. */
  private tick() {
    if (this.stopped) return;
    const every = Date.now() - this.touched > IDLE_AFTER ? POLL_IDLE : POLL_SHOWN;
    setTimeout(() => {
      if (
        !this.live &&
        document.visibilityState !== "hidden" &&
        !this.busy &&
        Date.now() - this.lastPoll >= every - 50
      )
        void this.push();
      this.tick();
    }, every);
  }

  private set(s: SyncState) {
    if (s === this.state) return;
    this.state = s;
    this.o.hooks.onState(s);
  }

  private setRole(role: Role) {
    if (role === this.role) return;
    this.role = role;
    this.o.hooks.onRole(role);
  }

  // ---- Live -----------------------------------------------------------------------------------

  private frame(f: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(f));
    return true;
  }

  private sendLive(u: Uint8Array) {
    const update = toB64(u);
    this.set("saving");
    // Too big for a socket (a pasted book): over HTTP, then the room reads it from the server.
    if (update.length > FRAME_MAX || !this.frame({ t: "update", update, seq: this.edits }))
      this.soon(0);
  }

  /** Ours to the room; a null state (leaving) takes it down. */
  private sendCursor() {
    if (!this.live) return;
    this.frame({
      t: "awareness",
      update: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
    });
  }

  /** What this browser has and the room doesn't (edits made offline, or before it joined). */
  private catchUp(roomSv: Uint8Array | null) {
    if (!this.lacking()) return;
    this.sendLive(Y.encodeStateAsUpdate(this.doc, roomSv ?? undefined));
  }

  private setLive(on: boolean) {
    if (on === this.live) return;
    this.live = on;
    this.o.hooks.onLive(on);
    if (!on) {
      // Nobody else's cursor stays up once the room's gone.
      const others = [...this.awareness.getStates().keys()].filter((k) => k !== this.doc.clientID);
      removeAwarenessStates(this.awareness, others, "room");
      if (this.lacking()) this.soon(0);
    }
  }

  private async connect() {
    if (this.stopped || this.socket || !this.o.live) return;
    let token: string | null = null;
    try {
      token = await this.o.live();
    } catch {
      // Signed out or offline: HTTP says which, and the socket tries again.
    }
    if (this.stopped) return;
    const q = this.o.client === WREN.id ? "" : `?client=${encodeURIComponent(this.o.client)}`;
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${LIVE_PREFIX}${this.o.id}${q}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, token ? [PROTOCOL, token] : [PROTOCOL]);
    } catch {
      return this.later();
    }
    this.socket = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", sv: toB64(Y.encodeStateVector(this.doc)) }));
    };
    ws.onmessage = (e) => this.onFrame(String(e.data));
    ws.onclose = (e) => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.setLive(false);
      // Put out of the room (no access now): the page already says so.
      if (this.stopped || e.code === 4404 || e.code === 4403) return;
      this.later();
    };
  }

  private later() {
    if (this.stopped) return;
    const wait = Math.min(RETRY_MAX, 1000 * 2 ** this.tries++);
    this.retry = setTimeout(() => void this.connect(), wait);
  }

  private onFrame(raw: string) {
    let f: Record<string, unknown>;
    try {
      f = JSON.parse(raw);
    } catch {
      return;
    }
    const bytes = (v: unknown) => fromB64(String(v ?? ""));
    switch (f.t) {
      case "sync": {
        Y.applyUpdate(this.doc, bytes(f.update), REMOTE);
        this.tries = 0;
        this.setRole(f.role as Role);
        this.setLive(true);
        this.catchUp(bytes(f.sv));
        this.sendCursor();
        if (!this.lacking()) this.set("saved");
        return;
      }
      case "update":
        Y.applyUpdate(this.doc, bytes(f.update), REMOTE);
        return;
      case "awareness":
        applyAwarenessUpdate(this.awareness, bytes(f.update), "room");
        return;
      case "saved": {
        if (typeof f.seq === "number") this.sentEdits = Math.max(this.sentEdits, f.seq);
        if (this.state !== "failed" || typeof f.seq === "number")
          this.set(this.lacking() ? "saving" : "saved");
        this.o.hooks.onSaved({
          version: Number(f.version),
          updatedAt: (f.updatedAt as string | null) ?? null,
          editedBy: (f.editedBy as string | null) ?? null,
        });
        return;
      }
      case "role":
        this.setRole(f.role as Role);
        return;
      case "refused":
        this.set("failed");
        this.o.hooks.onRefused(String(f.message), Number(f.status));
        return;
      case "comments":
        this.o.hooks.onComments();
        return;
      default:
        return;
    }
  }

  // ---- HTTP -----------------------------------------------------------------------------------

  async push(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.lastPoll = Date.now();
    const mark = this.edits;
    const sending = this.lacking();
    const update = sending ? Y.encodeStateAsUpdate(this.doc, this.serverSv) : null;
    if (sending) this.set("saving");
    try {
      const out = await notes(this.o.client, "sync", {
        id: this.o.id,
        update: update ? toB64(update) : "",
        sv: toB64(Y.encodeStateVector(this.doc)),
      });
      if (this.stopped) return;
      Y.applyUpdate(this.doc, fromB64(out.update), REMOTE);
      this.serverSv = fromB64(out.sv);
      if (sending) this.sentEdits = Math.max(this.sentEdits, mark);
      this.setRole(out.role);
      this.set(this.lacking() ? "saving" : "saved");
      this.o.hooks.onSaved(out);
      // The room reads what came in over HTTP now, not on its next poll.
      if (sending) this.frame({ t: "poke" });
      if (this.lacking() && !this.live) this.again = true;
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err), 0);
      if (e.status === 0 || e.status >= 500) this.set("offline");
      else {
        this.set("failed");
        // Its access changed under it: stop sending.
        if (e.status === 404 || (e.status === 403 && this.role !== "comment")) this.setRole("view");
        this.o.hooks.onRefused(e.message, e.status);
      }
    } finally {
      this.busy = false;
      if (this.again && !this.stopped) {
        this.again = false;
        this.soon(this.state === "offline" ? 5_000 : 0);
      }
    }
  }

  /** Leave: the cursor goes, and what's unsent goes up first (the room sends what it has). */
  async stop() {
    this.awareness.setLocalState(null);
    if (this.lacking() && !this.live) await this.push().catch(() => {});
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close(1000, "left");
    this.socket = null;
    removeEventListener("online", this.now);
    document.removeEventListener("visibilitychange", this.now);
    removeEventListener("keydown", this.touch, true);
    removeEventListener("pointerdown", this.touch, true);
    await this.local?.destroy().catch(() => {});
    this.awareness.destroy();
    this.doc.destroy();
  }
}
