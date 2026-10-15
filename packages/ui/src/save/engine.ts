/**
 * The save engine's core, plain TypeScript (no React): one `Saver` per thing a person types
 * into. The input shows `value`; only `set` (his typing), `takeTheirs` and a newer read over a
 * clean box ever change it. What a save sends back is never written into the input.
 *
 * The rules it keeps:
 * - Every `set` is journaled synchronously (./journal.ts), cleared once the server holds it.
 * - Saves for a key run one at a time across tabs (./lock.ts) and coalesce: the one in flight
 *   plus the newest value. Each save reads the value, base and version when it starts.
 * - A read that left before the newest save answered (or lands while one is out) is ignored.
 * - A refusal for a moved base is a conflict: both values kept until Keep mine or Use theirs.
 * - Offline, 5xx and timeouts retry with backoff and on `online`; any other refusal waits.
 */
import { tick } from "./clock.js";
import { browserEnv, type SaveEnv } from "./env.js";
import { clearEntry, readEntry, TAB, writeEntry } from "./journal.js";
import { withLock } from "./lock.js";

/** Quiet this long after the last change, it saves. */
export const SAVE_DELAY_MS = 1_200;
/** A save that hasn't answered by now is tried again. */
export const SAVE_TIMEOUT_MS = 20_000;
const BACKOFF_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** Own values remembered to tell our echo from someone else's change. */
const REMEMBER = 20;

/**
 * - `clean`: nothing typed since the last read.
 * - `edited`: typed, the save waits for a pause.
 * - `saving`: a save is out.
 * - `saved`: the server holds what's typed (said once a save answered).
 * - `waiting`: kept on this device; a retry comes (offline, 5xx, timeout).
 * - `conflict`: someone changed it meanwhile; Keep mine or Use theirs.
 * - `failed`: refused (`error` says why); waits for a change or a flush.
 */
export type Status = "clean" | "edited" | "saving" | "saved" | "waiting" | "conflict" | "failed";

export interface Conflict<T> {
  mine: T;
  /** What the server holds now; null until a read after the refusal lands. */
  theirs: T | null;
}

export interface SaveState<T> {
  value: T;
  /** What the server holds, as far as this saver knows: Undo of unsaved typing goes back to it. */
  base: T;
  status: Status;
  error: string | null;
  conflict: Conflict<T> | null;
  /** What's typed differs from what the server holds. */
  dirty: boolean;
  /** The journal gave typing back when this opened. */
  restored: boolean;
}

export interface SaveContext<T> {
  /** What to send as `expect`: the version when the record has one, else the base value. */
  expect: string | T | null;
  /** What the server held when this typing started over it. */
  base: T;
  version: string | null;
  /** The same for every try of one value over one base: a retry is one write, not two. */
  request: string;
}

/** What the server said it holds now: its words (trimmed, say) and its new version. */
export interface SaveAnswer<T> {
  value?: T | undefined;
  version?: string | null | undefined;
}

export type SaveFn<T> = (
  value: T,
  ctx: SaveContext<T>,
) => Promise<SaveAnswer<T> | undefined | Answerless>;
/** A save that answers nothing (`Promise<void>`): the value sent is what the server holds. */
// biome-ignore lint/suspicious/noConfusingVoidType: a save may resolve to nothing.
type Answerless = void;

export interface SaverOptions<T> {
  /** Names the journal entry and the lock; null keeps both off (a value that can't outlive the page). */
  key: string | null;
  /** The value as last read. */
  server: T;
  /** The server's version of `server`. Given (even null), `expect` is the version, not the value. */
  version?: string | null | undefined;
  /** The tick (./clock.ts) when the read of `server` left. */
  at?: number | undefined;
  save: SaveFn<T>;
  /** Equal for saving: drafts compare trimmed, so a trailing space he typed isn't a change. */
  same?: ((a: T, b: T) => boolean) | undefined;
  /** Autosave this long after the last change, and on blur, hide and pagehide; null: only `flush`. */
  delay?: number | null | undefined;
  timeout?: number | undefined;
  /** Whether a refusal means the base moved; the default reads 409 + "changed", or `code: "conflict"`. */
  conflictOf?: ((err: unknown) => boolean) | undefined;
  /** The server holds `value` now: write it through into the page's read caches. */
  onSaved?: ((value: T, answer: SaveAnswer<T>) => void) | undefined;
  /** A conflict opened: read the record again so `theirs` can show. */
  onConflict?: (() => void) | undefined;
  env?: Partial<SaveEnv> | undefined;
}

export class SaveTimeout extends Error {
  constructor() {
    super("The save took too long");
  }
}

export type Failure = "transient" | "conflict" | "refused";

const statusOf = (err: unknown) => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
};

/** The default: a 409 that says it changed, or a refusal coded `conflict`. */
export function conflictOf(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "conflict") return true;
  return statusOf(err) === 409 && /chang|moved|since/i.test(wordsOf(err));
}

/** How a failed save goes on: tried again, a conflict, or a refusal for him to read. */
export function failureKind(
  err: unknown,
  conflict: (err: unknown) => boolean = conflictOf,
): Failure {
  if (conflict(err)) return "conflict";
  if (err instanceof SaveTimeout || err instanceof TypeError) return "transient";
  const s = statusOf(err);
  if (s === 0 || s === 408 || s === 429 || (s !== null && s >= 500)) return "transient";
  return "refused";
}

export const wordsOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Default equality: the same value, or the same JSON. */
export function sameValue<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Per key in this tab: when its newest save answered, and what it saved. */
const answered = new Map<string, { at: number; value: unknown; version: string | null }>();

/** Forget this tab's saves (tests). */
export function forgetSaves() {
  answered.clear();
}

export class Saver<T> {
  readonly key: string | null;
  private o: SaverOptions<T>;
  private readonly env: SaveEnv;
  private readonly same: (a: T, b: T) => boolean;
  private readonly versioned: boolean;
  private readonly lockName: string;

  private value: T;
  private base: T;
  private version: string | null;
  /** The newest read that counted, and its version. */
  private server: T;
  private serverVersion: string | null;
  private status: Status;
  private error: string | null = null;
  private conflict: Conflict<T> | null = null;
  private theirsVersion: string | null = null;
  private restored = false;

  private fence = 0;
  private inflight = false;
  private looping = false;
  /** Asked to save again while one was out (a pause passed, a flush): go once it answers. */
  private again = false;
  private waiters: ((ok: boolean) => void)[] = [];
  private autosave: ReturnType<typeof setTimeout> | null = null;
  private retrying: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  /** Refused: no autosave until he changes it or flushes. */
  private blocked = false;
  private request: { value: T; base: T; id: string } | null = null;
  /** Conflicts settled on their own since the last save that landed. */
  private rebased = 0;
  /** Bases this saver wrote over: a read of one, with no tick, is old. */
  private over: T[] = [];
  /** Values this saver sent: one coming back after a refusal is our own late echo. */
  private sent: T[] = [];
  private readonly listeners = new Set<() => void>();
  private snap: SaveState<T>;
  private unlisten: (() => void) | null = null;

  constructor(o: SaverOptions<T>) {
    this.o = o;
    this.key = o.key;
    this.env = { ...browserEnv(), ...o.env };
    this.same = o.same ?? sameValue;
    this.versioned = o.version !== undefined;
    this.lockName = o.key ?? `own:${this.env.id()}`;
    let server = o.server;
    let version = o.version ?? null;
    // A read cached from before this tab's newest save of the key is older than that save.
    const was = o.key ? answered.get(o.key) : undefined;
    if (was && o.at !== undefined && o.at < was.at && !this.same(server, was.value as T)) {
      server = was.value as T;
      version = was.version;
    }
    this.server = server;
    this.serverVersion = version;
    this.value = server;
    this.base = server;
    this.version = version;
    this.status = "clean";
    this.restore();
    this.snap = this.build();
  }

  /** Take the newest callbacks (a render's `save` closes over its props). */
  update(o: Partial<Pick<SaverOptions<T>, "save" | "onSaved" | "onConflict" | "conflictOf">>) {
    this.o = { ...this.o, ...o };
  }

  // --- reading the state -------------------------------------------------------------------

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  readonly snapshot = (): SaveState<T> => this.snap;

  private build(): SaveState<T> {
    return {
      value: this.value,
      base: this.base,
      status: this.status,
      error: this.error,
      conflict: this.conflict,
      dirty: this.isDirty(),
      restored: this.restored,
    };
  }
  private emit() {
    this.snap = this.build();
    for (const f of [...this.listeners]) f();
  }
  private isDirty() {
    return !this.same(this.value, this.base);
  }

  // --- open and close -----------------------------------------------------------------------

  /** Start listening to the page; restored typing saves now. */
  open() {
    if (this.unlisten) return;
    if (this.o.delay !== null) this.unlisten = this.env.listen((e) => this.onPage(e));
    else this.unlisten = () => {};
    if (this.restored && this.isDirty() && !this.conflict && this.o.delay !== null) this.kick();
  }

  /** Stop listening; what's typed and unsaved saves now (leaving a record never waits). */
  close() {
    this.unlisten?.();
    this.unlisten = null;
    this.clearAutosave();
    if (this.retrying) clearTimeout(this.retrying);
    this.retrying = null;
    if (this.o.delay !== null && this.isDirty() && !this.conflict && !this.blocked) this.kick();
  }

  private onPage(e: "hidden" | "pagehide" | "online") {
    if (e === "online") {
      if (this.status === "waiting") this.tryNow();
      return;
    }
    if (this.isDirty() && !this.conflict && !this.blocked) this.tryNow();
  }

  // --- typing -------------------------------------------------------------------------------

  /** His change. Journaled now; saved after a pause. */
  set(value: T) {
    this.value = value;
    const dirty = this.isDirty();
    if (this.conflict) this.conflict = { ...this.conflict, mine: value };
    else if (this.blocked) {
      this.blocked = false;
      this.error = null;
      this.status = "edited";
    } else if (this.status !== "saving" && this.status !== "waiting")
      this.status = dirty ? "edited" : this.status === "saved" ? "saved" : "clean";
    this.journal();
    this.clearAutosave();
    const delay = this.o.delay === undefined ? SAVE_DELAY_MS : this.o.delay;
    if (dirty && !this.conflict && delay !== null && this.status !== "waiting")
      this.autosave = setTimeout(() => {
        this.autosave = null;
        this.kick();
      }, delay);
    this.emit();
  }

  /**
   * Save what's typed now: on blur, ⌘S, and before anything that reads the saved value (Approve,
   * Send, Ask Claude). True once the server holds it; false on a conflict or a failure.
   */
  flush(): Promise<boolean> {
    this.clearAutosave();
    if (this.conflict) return Promise.resolve(false);
    if (!this.isDirty() && !this.inflight) return Promise.resolve(true);
    if (this.blocked) {
      this.blocked = false;
      this.error = null;
    }
    if (this.retrying) clearTimeout(this.retrying);
    this.retrying = null;
    return new Promise((done) => {
      this.waiters.push(done);
      this.kick();
    });
  }

  /** The status's Retry: the same as a flush. */
  retry = () => this.flush();

  private tryNow() {
    this.clearAutosave();
    if (this.retrying) clearTimeout(this.retrying);
    this.retrying = null;
    this.kick();
  }

  private clearAutosave() {
    if (this.autosave) clearTimeout(this.autosave);
    this.autosave = null;
  }

  // --- conflicts ----------------------------------------------------------------------------

  /** Write mine over theirs: the base moves to theirs, then it saves. */
  keepMine(): Promise<boolean> {
    if (!this.conflict) return this.flush();
    const theirs = this.conflict.theirs ?? this.server;
    this.base = theirs;
    this.version = this.conflict.theirs !== null ? this.theirsVersion : this.serverVersion;
    this.conflict = null;
    this.status = this.isDirty() ? "edited" : "saved";
    this.journal();
    this.emit();
    return this.flush();
  }

  /** Drop mine: the box shows theirs. */
  takeTheirs() {
    if (!this.conflict) return;
    const theirs = this.conflict.theirs ?? this.server;
    this.value = theirs;
    this.base = theirs;
    this.version = this.conflict.theirs !== null ? this.theirsVersion : this.serverVersion;
    this.conflict = null;
    this.status = "clean";
    this.journal();
    this.emit();
  }

  // --- reads --------------------------------------------------------------------------------

  /** The newest fence: when this key's newest save answered, in this saver or this tab. */
  private fenceNow() {
    const shared = this.key ? (answered.get(this.key)?.at ?? 0) : 0;
    return Math.max(this.fence, shared);
  }

  /**
   * A read landed: `server` as the page read it, `at` the tick when that read left. A read that
   * left before the newest save answered is ignored; so is one that lands while a save is out.
   */
  read(server: T, o: { version?: string | null | undefined; at?: number | undefined } = {}) {
    const version = o.version ?? null;
    if (this.inflight) return;
    if (o.at !== undefined ? o.at < this.fenceNow() : this.over.some((v) => this.same(v, server)))
      return;
    this.server = server;
    this.serverVersion = version;
    if (this.conflict) return this.readInConflict(server, version);
    const moved = this.versioned ? version !== this.version : !this.same(server, this.base);
    if (!moved) return;
    if (!this.isDirty()) {
      // Someone else's change (Claude wrote, an undo): it shows, as nothing is typed over it.
      this.base = server;
      this.version = version;
      if (!this.same(this.value, server)) this.value = server;
      if (this.status !== "saved") this.status = "clean";
      this.journal();
      return this.emit();
    }
    if (this.same(server, this.value)) {
      // It holds what's typed (another tab saved the same).
      this.base = server;
      this.version = version;
      this.status = "saved";
      this.journal();
      return this.emit();
    }
    if (this.versioned && this.same(server, this.base)) {
      // Only the version moved (another field saved): this value didn't.
      this.version = version;
      return;
    }
    this.openConflict(server, version);
  }

  private readInConflict(server: T, version: string | null) {
    const c = this.conflict as Conflict<T>;
    if (this.same(server, c.mine)) {
      this.base = server;
      this.version = version;
      this.conflict = null;
      this.status = "saved";
      this.journal();
      return this.emit();
    }
    // Our own earlier save, landed late; or the version moved and the value didn't: not theirs.
    // Twice at most in a row, so a server that keeps refusing shows the conflict.
    const ours = this.sent.some((v) => this.same(v, server)) || this.same(server, this.base);
    if (ours && this.rebased < 2) {
      this.rebased += 1;
      this.base = server;
      this.version = version;
      this.conflict = null;
      this.status = "edited";
      this.journal();
      this.emit();
      return this.kick();
    }
    this.theirsVersion = version;
    this.conflict = { mine: c.mine, theirs: server };
    this.emit();
  }

  private openConflict(theirs: T | null, version: string | null) {
    this.clearAutosave();
    if (this.retrying) clearTimeout(this.retrying);
    this.retrying = null;
    this.theirsVersion = version;
    this.conflict = { mine: this.value, theirs };
    this.status = "conflict";
    this.journal();
    this.emit();
  }

  // --- saving -------------------------------------------------------------------------------

  private journal() {
    const k = this.key;
    if (!k) return;
    if (this.isDirty() || this.conflict)
      writeEntry(this.env.storage, k, {
        base: this.base,
        version: this.version,
        value: this.value,
        at: this.env.now(),
        tab: TAB,
      });
    else clearEntry<T>(this.env.storage, k, TAB, (v) => this.same(v, this.value));
  }

  /** Typing a reload left behind: back in the box over the same base, a conflict over a moved one. */
  private restore() {
    const k = this.key;
    if (!k) return;
    const e = readEntry<T>(this.env.storage, k, this.env.now());
    if (!e) return;
    if (this.same(e.value, this.server)) {
      clearEntry(this.env.storage, k, TAB, () => true);
      return;
    }
    this.restored = true;
    this.value = e.value;
    const unmoved = this.versioned ? e.version === this.version : this.same(e.base, this.server);
    if (unmoved) this.status = "edited";
    else {
      // The base he typed over: Keep mine moves it to theirs.
      this.base = e.base;
      this.version = e.version;
      this.theirsVersion = this.serverVersion;
      this.conflict = { mine: e.value, theirs: this.server };
      this.status = "conflict";
    }
    // Ours now: this tab clears it once saved.
    this.journal();
  }

  private requestFor(value: T, base: T): string {
    const r = this.request;
    if (r && this.same(r.value, value) && this.same(r.base, base)) return r.id;
    const id = this.env.id();
    this.request = { value, base, id };
    return id;
  }

  private remember(list: T[], v: T) {
    list.push(v);
    if (list.length > REMEMBER) list.shift();
  }

  private markAnswered(saved?: { value: T; version: string | null }) {
    const at = tick();
    this.fence = at;
    if (!this.key) return;
    const was = answered.get(this.key);
    answered.set(this.key, {
      at,
      value: saved ? saved.value : (was?.value ?? this.base),
      version: saved ? saved.version : (was?.version ?? this.version),
    });
  }

  private timed<R>(p: Promise<R>): Promise<R> {
    const ms = this.o.timeout ?? SAVE_TIMEOUT_MS;
    return new Promise<R>((ok, fail) => {
      const t = setTimeout(() => fail(new SaveTimeout()), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          ok(v);
        },
        (err: unknown) => {
          clearTimeout(t);
          fail(err);
        },
      );
    });
  }

  private kick() {
    if (this.looping) {
      this.again = true;
      return;
    }
    this.looping = true;
    void this.loop();
  }

  /** Go on saving: something is typed and nothing stops it. */
  private free() {
    return !this.conflict && !this.blocked && this.isDirty();
  }

  private async loop(): Promise<void> {
    try {
      // Once, then again only when asked while it was out: typing waits for its pause.
      let first = true;
      while (this.free() && (first || this.again || this.waiters.length > 0)) {
        first = false;
        this.again = false;
        let covered: ((ok: boolean) => void)[] = [];
        let sentValue = this.value;
        let sentBase = this.base;
        let answer: SaveAnswer<T> | undefined | Answerless;
        this.inflight = true;
        this.status = "saving";
        this.emit();
        try {
          answer = await withLock(this.env.locks, this.lockName, () => {
            // Read when the lock is ours: the live value, base and version, never a render's.
            covered = this.waiters.splice(0);
            sentValue = this.value;
            sentBase = this.base;
            const version = this.version;
            const request = this.requestFor(sentValue, sentBase);
            return this.timed(
              Promise.resolve().then(() =>
                this.o.save(sentValue, {
                  expect: this.versioned ? version : sentBase,
                  base: sentBase,
                  version,
                  request,
                }),
              ),
            );
          });
        } catch (err) {
          this.inflight = false;
          this.markAnswered();
          this.failed(err);
          for (const w of [...covered, ...this.waiters.splice(0)]) w(false);
          return;
        }
        this.inflight = false;
        this.attempt = 0;
        this.rebased = 0;
        const saved = answer?.value !== undefined ? answer.value : sentValue;
        if (answer?.version !== undefined) this.version = answer.version;
        this.markAnswered({ value: saved, version: this.version });
        this.remember(this.over, sentBase);
        this.remember(this.sent, sentValue);
        this.base = saved;
        this.server = saved;
        this.serverVersion = this.version;
        this.error = null;
        this.status = this.isDirty() ? "edited" : "saved";
        this.journal();
        this.emit();
        try {
          this.o.onSaved?.(saved, answer ?? {});
        } catch {
          // A cache that can't take the value reads it next time.
        }
        for (const w of covered) w(true);
      }
    } finally {
      this.looping = false;
      this.again = false;
      const ok = !this.isDirty() && !this.conflict && !this.blocked;
      for (const w of this.waiters.splice(0)) w(ok);
    }
  }

  private failed(err: unknown) {
    const kind = failureKind(err, this.o.conflictOf ?? conflictOf);
    if (kind === "conflict") {
      this.openConflict(null, this.serverVersion);
      this.o.onConflict?.();
      return;
    }
    this.error = wordsOf(err);
    if (kind === "transient") {
      this.status = "waiting";
      const wait = Math.min(BACKOFF_MS * 2 ** this.attempt, BACKOFF_MAX_MS);
      this.attempt += 1;
      if (this.retrying) clearTimeout(this.retrying);
      this.retrying = setTimeout(() => {
        this.retrying = null;
        this.kick();
      }, wait);
    } else {
      this.blocked = true;
      this.status = "failed";
    }
    this.emit();
  }
}
