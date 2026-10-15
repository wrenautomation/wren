/**
 * Writes of one value that only the newest matters for: a pref, a playback position, a select.
 * One write per key at a time; a value set while one is out waits, and a newer one takes its
 * place, so the server ends on the last value and two writes never land out of order.
 */

export type Wrote =
  | { status: "saved" }
  | { status: "replaced" }
  | { status: "failed"; error: unknown };

interface Next {
  value: unknown;
  send: (value: unknown) => Promise<unknown>;
  done: (r: Wrote) => void;
}
interface Slot {
  out: boolean;
  next: Next | null;
}

export class Latest {
  private readonly slots = new Map<string, Slot>();

  /**
   * Send `value` under `key` once the write out now answers. `saved` once the server took it,
   * `replaced` when a newer value went instead, `failed` with the refusal.
   */
  write<T>(key: string, value: T, send: (value: T) => Promise<unknown>): Promise<Wrote> {
    let s = this.slots.get(key);
    if (!s) {
      s = { out: false, next: null };
      this.slots.set(key, s);
    }
    const slot = s;
    return new Promise<Wrote>((done) => {
      slot.next?.done({ status: "replaced" });
      slot.next = { value, send: send as (v: unknown) => Promise<unknown>, done };
      if (!slot.out) void this.drain(key, slot);
    });
  }

  /** A write under `key` is out or waiting. */
  busy(key: string): boolean {
    const s = this.slots.get(key);
    return !!s && (s.out || s.next !== null);
  }

  private async drain(key: string, s: Slot) {
    s.out = true;
    while (s.next) {
      const n = s.next;
      s.next = null;
      let r: Wrote;
      try {
        await n.send(n.value);
        r = { status: "saved" };
      } catch (error) {
        r = { status: "failed", error };
      }
      n.done(r);
    }
    s.out = false;
    if (this.slots.get(key) === s) this.slots.delete(key);
  }
}

/** This tab's writes of that kind, by key. */
export const LATEST = new Latest();
