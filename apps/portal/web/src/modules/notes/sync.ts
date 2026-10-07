/**
 * A note's Yjs doc kept in step with the server over `notes/sync` (batch 1: HTTP; batch 2 moves
 * it to a live room). Edits go up a moment after they're made; others' come down on a poll while
 * the tab is open. A copy lives in this browser (IndexedDB), so edits made offline survive a
 * reload and merge when the server is back. What goes up is always what the server lacks, by its
 * own state vector, so nothing is sent twice and nothing is lost.
 */
import { fromB64, toB64 } from "@wren/notes/doc";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { ApiError } from "../../api.js";
import { type NoteSynced, notes } from "./api.js";

export type SyncState = "saved" | "saving" | "offline" | "failed";

/** Updates from the server: the editor's undo ignores them, and they're never sent back. */
export const REMOTE = Symbol("server");

const PUSH_AFTER = 600;
const POLL_SHOWN = 5_000;
const POLL_IDLE = 30_000;
/** No key or pointer in this long: poll slowly. */
const IDLE_AFTER = 120_000;

export class NoteSync {
  readonly doc = new Y.Doc();
  private serverSv: Uint8Array;
  private local: IndexeddbPersistence | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private again = false;
  private stopped = false;
  private lastPoll = 0;
  private touched = Date.now();
  state: SyncState = "saved";

  constructor(
    private readonly client: string,
    readonly id: string,
    state: string,
    private canEdit: boolean,
    private readonly hooks: {
      onState: (s: SyncState) => void;
      onSynced: (out: NoteSynced) => void;
      onRefused: (message: string, status: number) => void;
    },
    keepLocal: boolean,
  ) {
    Y.applyUpdate(this.doc, fromB64(state), REMOTE);
    this.serverSv = Y.encodeStateVector(this.doc);
    this.doc.on("update", (_u: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE && this.canEdit) this.soon(PUSH_AFTER);
    });
    if (keepLocal) {
      try {
        this.local = new IndexeddbPersistence(`wren-note:${client}:${id}`, this.doc);
        // What this browser kept from an offline edit goes up once it's read.
        void this.local.whenSynced.then(() => this.lacking() && this.soon(0)).catch(() => {});
      } catch {
        // No IndexedDB (a private window): the server's copy only.
      }
    }
    this.tick();
    addEventListener("online", this.now);
    document.addEventListener("visibilitychange", this.now);
    addEventListener("keydown", this.touch, true);
    addEventListener("pointerdown", this.touch, true);
  }

  /** Whether this browser holds edits the server hasn't got. */
  lacking(): boolean {
    return this.canEdit && Y.encodeStateAsUpdate(this.doc, this.serverSv).length > 2;
  }

  /** Sync now: after a restore, on coming back online. */
  readonly now = () => {
    if (document.visibilityState !== "hidden") this.soon(0);
  };

  private readonly touch = () => {
    this.touched = Date.now();
  };

  private soon(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), ms);
  }

  /** The poll: often while someone's here, rarely when idle, never while hidden. */
  private tick() {
    if (this.stopped) return;
    const every = Date.now() - this.touched > IDLE_AFTER ? POLL_IDLE : POLL_SHOWN;
    setTimeout(() => {
      if (
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
    this.hooks.onState(s);
  }

  async push(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.lastPoll = Date.now();
    const update = this.canEdit ? Y.encodeStateAsUpdate(this.doc, this.serverSv) : null;
    const sending = !!update && update.length > 2;
    if (sending) this.set("saving");
    try {
      const out = await notes(this.client, "sync", {
        id: this.id,
        update: sending ? toB64(update) : "",
        sv: toB64(Y.encodeStateVector(this.doc)),
      });
      if (this.stopped) return;
      Y.applyUpdate(this.doc, fromB64(out.update), REMOTE);
      this.serverSv = fromB64(out.sv);
      this.set(this.lacking() ? "saving" : "saved");
      this.hooks.onSynced(out);
      if (this.lacking()) this.again = true;
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err), 0);
      if (e.status === 0 || e.status >= 500) this.set("offline");
      else {
        this.set("failed");
        // Its access changed under it: stop sending.
        if (e.status === 403 || e.status === 404) this.canEdit = false;
        this.hooks.onRefused(e.message, e.status);
      }
    } finally {
      this.busy = false;
      if (this.again && !this.stopped) {
        this.again = false;
        this.soon(this.state === "offline" ? 5_000 : 0);
      }
    }
  }

  /** Leave: what's unsent goes up first, if it can. */
  async stop() {
    if (this.lacking()) await this.push().catch(() => {});
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    removeEventListener("online", this.now);
    document.removeEventListener("visibilitychange", this.now);
    removeEventListener("keydown", this.touch, true);
    removeEventListener("pointerdown", this.touch, true);
    await this.local?.destroy().catch(() => {});
    this.doc.destroy();
  }
}
