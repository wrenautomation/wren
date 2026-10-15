/**
 * The edits store (designs/2026-10-15-one-write-path.md, "Unsaved edits"): every word typed into
 * the portal that the server doesn't hold yet, in one place. Each field's entry names the person
 * (the store's owner), the client, the record and field (its key), and what the server held when
 * the typing started (its base and version, in the entry). Leaving the page, switching rows or
 * apps, reloading or closing the tab never loses one; coming back gives it back.
 *
 * Reads and writes are synchronous (a box reads its entry as it mounts); each change also goes to
 * the device copy in IndexedDB (`./local.ts`) and to this person's other tabs. `dropLocalCopy`
 * wipes it with the rest. The save engine's journal (`../save/journal.ts`) keeps its entries
 * here, so autosaving boxes, kept forms and `useEdit` fields share it.
 */
import type { Store } from "../save/env.js";
import type { KeyValue } from "./local.js";

const SEP = "\u0000";
/** Entries older than this are dropped when read (the journal's week). */
const LEGACY = ["wren.unsaved:", "wren.form:"];

type Listener = () => void;

export class Edits {
  /** `${client}\0${key}` → the entry's JSON. */
  private mem = new Map<string, string>();
  private owner: string | null = null;
  private disk: KeyValue | null = null;
  private tabs: BroadcastChannel | null = null;
  private client = "";
  private readonly seen = new Set<Listener>();
  private version = 0;

  /** The client the portal shows now: what's typed from here on is kept under it. */
  setClient(client: string | null) {
    this.client = client ?? "";
  }

  /** A store over the client shown now, kept for as long as the box that asked lives. */
  view(client = this.client): Store {
    return {
      getItem: (k) => this.get(client, k),
      setItem: (k, v) => this.set(client, k, v),
      removeItem: (k) => this.set(client, k, null),
    };
  }

  get(client: string, key: string): string | null {
    // An entry from before the store knew clients counts under any.
    return this.mem.get(client + SEP + key) ?? this.mem.get(SEP + key) ?? null;
  }

  set(client: string, key: string, value: string | null, fromTab = false) {
    const ks = value === null ? [client + SEP + key, SEP + key] : [client + SEP + key];
    let moved = false;
    for (const k of ks) {
      const had = this.mem.get(k);
      if (value === null ? had === undefined : had === value) continue;
      moved = true;
      if (value === null) this.mem.delete(k);
      else this.mem.set(k, value);
      if (fromTab || !this.owner) continue;
      const id = `edit:${this.owner}${SEP}${k}`;
      void (value === null ? this.disk?.removeItem(id) : this.disk?.setItem(id, value))?.catch(
        () => undefined,
      );
      try {
        this.tabs?.postMessage({ k, v: value });
      } catch {
        // No other tabs.
      }
    }
    if (moved) this.changed();
  }

  /** Every key with an entry under `client` (tests, the shell's count). */
  keys(client = this.client): string[] {
    const out: string[] = [];
    for (const k of this.mem.keys()) {
      const [c, key] = [k.slice(0, k.indexOf(SEP)), k.slice(k.indexOf(SEP) + 1)];
      if (c === client || c === "") out.push(key);
    }
    return out;
  }

  /**
   * Keep this person's edits on the device and share them with their other tabs. What this tab
   * typed before (none, usually) stays over what the device held.
   */
  async start(owner: string | null, disk: KeyValue | null, legacy: Storage | null = null) {
    this.stop();
    this.owner = owner;
    if (!owner) return;
    this.disk = disk;
    if (typeof BroadcastChannel !== "undefined") {
      this.tabs = new BroadcastChannel(`wren-edits:${owner}`);
      this.tabs.onmessage = (e: MessageEvent) => {
        const m = e.data as { k?: unknown; v?: unknown } | null;
        if (!m || typeof m.k !== "string") return;
        const at = m.k.indexOf(SEP);
        if (at < 0) return;
        this.set(m.k.slice(0, at), m.k.slice(at + 1), typeof m.v === "string" ? m.v : null, true);
      };
    }
    const prefix = `edit:${owner}${SEP}`;
    try {
      for (const [id, v] of (await disk?.entries(prefix)) ?? []) {
        const k = id.slice(prefix.length);
        if (!this.mem.has(k)) this.mem.set(k, v);
      }
    } catch {
      // Blocked storage: this tab still keeps them.
    }
    this.adopt(legacy);
    this.changed();
  }

  /** Entries an older build kept in local storage come here once. */
  private adopt(legacy: Storage | null) {
    if (!legacy) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < legacy.length; i++) {
        const k = legacy.key(i);
        if (k && LEGACY.some((p) => k.startsWith(p))) keys.push(k);
      }
      for (const k of keys) {
        const v = legacy.getItem(k);
        if (v !== null && this.get("", k) === null) this.set("", k, v);
        legacy.removeItem(k);
      }
    } catch {
      // Blocked: nothing to adopt.
    }
  }

  /** Forget everything in this tab (the device copy is wiped by `dropLocalCopy`). */
  wipe() {
    this.stop();
    this.mem.clear();
    this.changed();
  }

  private stop() {
    this.tabs?.close();
    this.tabs = null;
    this.disk = null;
    this.owner = null;
  }

  readonly subscribe = (fn: Listener) => {
    this.seen.add(fn);
    return () => void this.seen.delete(fn);
  };
  /** Moves each time an entry changes: what `useSyncExternalStore` compares. */
  readonly snapshot = () => this.version;

  private changed() {
    this.version += 1;
    for (const f of [...this.seen]) f();
  }
}

/** Every unsaved edit in this tab. */
export const EDITS = new Edits();
