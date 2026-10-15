/**
 * One action per press. A second press while the first call is out gets the first's answer,
 * and every call carries a request id: the same id until the server answered, so a retry after
 * a lost answer is one action, not two (the server keeps one result per id).
 */
import { failureKind } from "./engine.js";
import { newId } from "./env.js";

export class Once {
  private readonly live = new Map<string, Promise<unknown>>();
  private readonly ids = new Map<string, string>();
  constructor(private readonly id: () => string = newId) {}

  /** The request id for `key`, kept until a call under it gets an answer. */
  requestId(key: string): string {
    let r = this.ids.get(key);
    if (!r) {
      r = this.id();
      this.ids.set(key, r);
    }
    return r;
  }

  /** Whether a call under `key` is out now. */
  busy(key: string): boolean {
    return this.live.has(key);
  }

  /**
   * Run `fn` with the key's request id, unless a call under `key` is out: then its promise. An
   * answer or a refusal ends the id; a lost answer (offline, a timeout, a 5xx) keeps it.
   */
  run<R>(key: string, fn: (requestId: string) => Promise<R>): Promise<R> {
    const out = this.live.get(key);
    if (out) return out as Promise<R>;
    const request = this.requestId(key);
    let p: Promise<R>;
    try {
      p = Promise.resolve(fn(request));
    } catch (err) {
      p = Promise.reject(err);
    }
    const settled = p.then(
      (v) => {
        if (this.ids.get(key) === request) this.ids.delete(key);
        return v;
      },
      (err: unknown) => {
        if (failureKind(err, () => false) !== "transient" && this.ids.get(key) === request)
          this.ids.delete(key);
        throw err;
      },
    );
    const tracked = settled.finally(() => {
      if (this.live.get(key) === tracked) this.live.delete(key);
    });
    this.live.set(key, tracked);
    return tracked;
  }
}

/** Every action call in this tab, by handler and ids. */
export const ACTIONS = new Once();
