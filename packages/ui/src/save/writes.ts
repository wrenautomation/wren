/**
 * The portal's one write path (designs/2026-10-15-one-write-path.md). Every call that changes
 * something goes through `WRITES`: a press (Send, Approve, Drop), a hand-drawn page's write, a
 * set-aside waiting out its undo. Typed values save through `Saver` (./engine.ts); its saves are
 * writes here too, as every portal write is.
 *
 * What it promises:
 * - One request id per press, made once, kept on a retry after a lost answer and on a resend
 *   after a reload. The server runs one write per id (the Worker's Restate idempotency key).
 * - A press and its calls are kept in this tab's session storage the moment they go, so a
 *   hidden tab, a reload or a deploy never loses one and never sends one twice.
 * - A press that takes its records out of a list (`hide`) is an overlay over the server's rows:
 *   it drops once the server answered and the page read again, never on a timer.
 * - Coming back (visible, focus, pageshow, online): a held press past its deadline goes, a lost
 *   call goes again under its id, a long one asks the server how it went, every read on screen
 *   reads again, and an outcome that landed while the tab was hidden is said now.
 * - A held press (Delete, Drop: undo for 10 seconds) goes when its deadline has passed, checked
 *   on a return and when the page goes (pagehide, freeze: keepalive). A timer only reminds.
 * - A send (a reply, a DM, a comment) is accept-then-track: the server answers at once that it
 *   has it (`{ accepted: true }`), and its outcome comes from the server's own record of it
 *   (`status`), asked on reminders and on every return. Nothing waits on a held-open request.
 * - The server pushes a send's outcome over the portal's socket (`heard`); asking `status` is the
 *   fallback, slower while the socket is open. While Restate retries a send, why shows (`retry`).
 * - A write that landed is handed to `landed`: the data layer reads again here and in other tabs.
 */
import { failureKind, wordsOf } from "./engine.js";
import { newId, type Store } from "./env.js";

export type WriteStatus = "held" | "sending" | "unsure" | "sent" | "failed";

/** One portal call under a press: what went on the wire, kept to send again after a reload. */
export interface WireCall {
  /** Its request id: the press's, or `<press id>-<n>` for one of several records. */
  id: string;
  path: string;
  /** As sent, without `requestId`; null when it can't be kept (a file, too large). */
  body: Record<string, unknown> | null;
  status: "sending" | "unsure" | "sent" | "failed";
  error: string | null;
  at: number;
  /** The server took it (a send): its outcome is read from the server, not waited for. */
  accepted?: boolean;
  /** The server is trying it again, and why. */
  retry?: Retry | null;
}

/** A send the server keeps trying: how many times so far, and why the last try failed. */
export interface Retry {
  count: number;
  reason: string;
}

/** A press: what the person did, and how it went. */
export interface Write {
  /** The request id. */
  id: string;
  /** What two presses share when they are the same press: the handler and its records. */
  key: string;
  /** The action's id ("inbox.reply"), when a record's action made it. */
  what: string | null;
  /** In words ("Reply"), for the line that says how it went. */
  label: string | null;
  /** Records it touches, as `recordKey(scope, id)`. */
  records: string[];
  /** What it sends (the words), kept to show while it goes and to give back if refused. */
  input: Record<string, unknown> | null;
  status: WriteStatus;
  /** Why it failed, or why it isn't sure yet. */
  error: string | null;
  at: number;
  settled: number | null;
  /** A held press goes at this time unless undone. */
  due: number | null;
  /** Its records leave lists while it goes. */
  hide: boolean;
  /** The page read again since it settled: its overlay is done. */
  read: boolean;
  /** Its outcome reached the person (said while the tab showed). */
  told: boolean;
  /** The page load that started it. */
  page: string;
  /** It was lost once (offline, a 5xx): when it lands, say so even if nobody waits. */
  retried: boolean;
  /** The server has it and runs it whatever this tab does (a send it accepted). */
  accepted: boolean;
  /** The server is trying it again, and why (a send it accepted). */
  retry?: Retry | null;
  calls: WireCall[];
}

/** A send's first answer: the server has it and runs it; its outcome is asked by `status`. */
export interface Accepted {
  accepted: true;
  state: "queued";
  requestId: string;
}

export const isAccepted = (v: unknown): v is Accepted =>
  !!v && typeof v === "object" && (v as { accepted?: unknown }).accepted === true;

/** What the server says of a request id it was sent. */
export type WireState =
  | { state: "sending"; retry?: Retry }
  | { state: "sent"; answer?: unknown }
  | { state: "failed"; error: string }
  | { state: "unknown" };

/** The portal side: how a call is sent, asked about, and how the page reads again and says things. */
export interface WriteHooks {
  /** Send one call with its request id in the body; `keepalive` when the page is going. */
  send?: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  /** How the call under `id` went, from the server's own record. */
  status?: (path: string, id: string) => Promise<WireState>;
  /** Read everything on screen again; resolves once the reads land. */
  reread?: () => Promise<void>;
  /** Say how a press went, when the person couldn't see it happen. */
  tell?: (w: Write) => void;
  /** A write landed on these records (the data layer tells the other tabs). */
  landed?: (records: string[]) => void;
}

export type WritePageEvent = "back" | "hidden" | "gone";

export interface WriteEnv {
  /** This tab's session storage, or null. */
  storage: Store | null;
  now: () => number;
  id: () => string;
  visible: () => boolean;
  /** Page moments: back (visible, focus, pageshow, online), hidden, gone (pagehide, freeze). */
  listen: (fn: (e: WritePageEvent) => void) => () => void;
  /** A reminder at `ms` from now; never decides anything by itself. */
  remind: (ms: number, fn: () => void) => void;
}

const STORE_KEY = "wren.writes";
/** A settled press stays this long: the box that sent it shows how it went. */
export const RECENT_MS = 10 * 60_000;
/** A call out longer than this, on a return, asks the server how it went. */
export const ASK_AFTER_MS = 15_000;
const KEEP_MAX = 48_000;
/** How soon a send the server took is asked about, then each time twice as late, to this. */
const FOLLOW_FIRST_MS = 400;
const FOLLOW_MAX_MS = 5_000;
/** The same, while the server pushes outcomes over the socket: asking is only the fallback. */
const FOLLOW_PUSHED_MS = 20_000;

/** A record's key in a write: its scope (the type's plural, a page's name) and its id. */
export const recordKey = (scope: string, id: string | number) => `${scope}\u0000${id}`;

const done = (s: WriteStatus) => s === "sent" || s === "failed";
const open = (s: WriteStatus) => !done(s);

/** The body as kept: JSON only, small, no files. */
function keepable(body: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const hasBlob = Object.values(body).some(
      (v) => typeof Blob !== "undefined" && v instanceof Blob,
    );
    if (hasBlob) return null;
    const s = JSON.stringify(body);
    return s.length <= KEEP_MAX ? (JSON.parse(s) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A JSON text with keys in order: two equal bodies make one key. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof Blob !== "undefined" && v instanceof Blob) return `"<file:${Math.random()}>"`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** The request id in a body, or null. */
const idIn = (body: Record<string, unknown>) =>
  typeof body.requestId === "string" && body.requestId ? body.requestId : null;

export interface PressOptions {
  key: string;
  what?: string | null | undefined;
  label?: string | null | undefined;
  records?: readonly string[] | undefined;
  input?: Record<string, unknown> | null | undefined;
  hide?: boolean | undefined;
}

export class Writes {
  private list: Write[] = [];
  private readonly live = new Map<string, Promise<unknown>>();
  private readonly wires = new Map<string, Promise<unknown>>();
  /** A held press's commit, by id (this page's only). */
  private readonly commits = new Map<string, (id: string) => Promise<unknown>>();
  private hooks: WriteHooks = {};
  private readonly seen = new Set<() => void>();
  private snap: readonly Write[] = [];
  /** A return being handled, and whether another came meanwhile (visible and focus fire together). */
  private backing: Promise<void> | null = null;
  private backAgain = false;
  private hiddenAt: number | null = null;
  private unlisten: (() => void) | null = null;
  /** Sends the server took, waiting for their outcome from `status`, by request id. */
  private readonly following = new Map<
    string,
    {
      path: string;
      body: Record<string, unknown> | null;
      resolve: (answer: unknown) => void;
      reject: (err: Error) => void;
      tries: number;
      asking: boolean;
    }
  >();
  /** This page load. */
  private readonly page = Math.random().toString(36).slice(2, 10);
  /** The socket that pushes outcomes is open. */
  private pushing = false;

  constructor(private readonly env: WriteEnv) {
    this.list = this.load();
    this.snap = [...this.list];
  }

  /** Hand in the portal's side; a hook given replaces the one before. */
  use(hooks: WriteHooks) {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /** Listen to the page; presses a previous load left out go again. */
  start() {
    if (this.unlisten) return;
    const page = this.env.listen((e) => {
      if (e === "back") void this.back();
      else if (e === "hidden") this.hiddenAt ??= this.env.now();
      else this.gone();
    });
    this.unlisten = page;
    if (!this.env.visible()) this.hiddenAt = this.env.now();
    void this.back(true);
  }

  stop() {
    this.unlisten?.();
    this.unlisten = null;
  }

  // --- reading ------------------------------------------------------------------------------

  readonly subscribe = (fn: () => void) => {
    this.seen.add(fn);
    return () => void this.seen.delete(fn);
  };
  readonly snapshot = (): readonly Write[] => this.snap;

  /** The newest press on a record, of these actions when named. */
  lastOn(record: string, what?: readonly string[]): Write | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i] as Write;
      if (w.records.includes(record) && (!what || (w.what !== null && what.includes(w.what))))
        return w;
    }
    return null;
  }

  /**
   * The newest action press in `scope` still going, and its ids: a button shows it is at work
   * after its page went and came back, not only while the page that pressed it stays.
   */
  goingIn(scope: string): { what: string; ids: string[] } | null {
    const at = recordKey(scope, "");
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i] as Write;
      if (w.status !== "sending" || w.what === null) continue;
      const ids = w.records.filter((r) => r.startsWith(at)).map((r) => r.slice(at.length));
      if (ids.length) return { what: w.what, ids };
    }
    return null;
  }

  /** Ids in `scope` an open press (or one whose page hasn't read again) keeps out of lists. */
  hiddenIn(scope: string): Set<string> {
    const at = recordKey(scope, "");
    const out = new Set<string>();
    for (const w of this.list)
      if (w.hide && (open(w.status) || (w.status === "sent" && !w.read)))
        for (const r of w.records) if (r.startsWith(at)) out.add(r.slice(at.length));
    return out;
  }

  /** How many hiding presses have landed: a list reads again when it moves. */
  landed(): number {
    return this.list.filter((w) => w.hide && w.status === "sent").length;
  }

  /** The person sees this page now: an outcome said now is seen. */
  showing(): boolean {
    return this.env.visible() && this.hiddenAt === null;
  }

  /** Writes not yet answered. */
  get pending(): number {
    return this.list.filter((w) => open(w.status)).length;
  }

  /** Forget a settled press: its line is read. */
  dismiss(id: string) {
    const w = this.byId(id);
    if (!w || open(w.status)) return;
    this.list = this.list.filter((x) => x !== w);
    this.changed();
  }

  // --- a press ------------------------------------------------------------------------------

  /**
   * Run a press: `fn` gets its request id. A second press of the same key while one is out gets
   * the first's answer. A press after a lost answer keeps the id; after an answer, a new one.
   */
  press<R>(o: PressOptions, fn: (requestId: string) => Promise<R>): Promise<R> {
    const out = this.live.get(o.key);
    if (out) return out as Promise<R>;
    const w = this.begin(o, "sending");
    return this.track(w, fn);
  }

  /** Is a press of `key` out now? */
  busy(key: string): boolean {
    return this.live.has(key);
  }

  /**
   * Hold a press until `ms` from now: its records leave lists at once, and `undo` (true while
   * it can) brings them back. It goes when its deadline passes, checked on a return, a reminder,
   * and when the page goes. `commit` gets the request id. A second hold of the same key is none.
   */
  hold(
    o: PressOptions & { ms: number },
    commit: (requestId: string) => Promise<unknown>,
  ): { id: string; undo: () => boolean } | null {
    if (this.live.has(o.key) || this.list.some((w) => w.key === o.key && w.status === "held"))
      return null;
    const w = this.begin({ ...o, hide: true }, "held");
    w.due = this.env.now() + o.ms;
    this.commits.set(w.id, commit);
    this.changed();
    this.env.remind(o.ms, () => void this.due());
    return { id: w.id, undo: () => this.undo(w.id) };
  }

  /** Take back a held press. False when it already went. */
  undo(id: string): boolean {
    const w = this.byId(id);
    if (w?.status !== "held") return false;
    if (w.due !== null && this.env.now() >= w.due) {
      // Its deadline passed while nobody checked: it goes now, as it would have.
      void this.due();
      return false;
    }
    this.commits.delete(id);
    this.list = this.list.filter((x) => x !== w);
    this.changed();
    return true;
  }

  // --- a call on the wire -------------------------------------------------------------------

  /**
   * One portal write on the wire. Its request id: the body's (a press's), else a lost call's of
   * the same path and body, else a new one. The same call while one is out answers with it.
   */
  call<R>(
    path: string,
    body: Record<string, unknown>,
    send: (body: Record<string, unknown>) => Promise<R>,
  ): Promise<R> {
    const { requestId: _, ...bare } = body;
    const key = `${path} ${stable(bare)}`;
    const given = idIn(body);
    const owner = given ? this.ownerOf(given) : null;
    let id = given;
    if (!id) {
      const lost = this.list.find(
        (w) => w.key === key && (w.status === "unsure" || w.status === "sending"),
      );
      const flying = lost && this.live.get(key);
      if (flying) return flying as Promise<R>;
      id = lost?.id ?? this.env.id();
    }
    const twin = this.wires.get(id);
    if (twin) return twin as Promise<R>;
    // A call no press made (a hand-drawn page's write) is its own press.
    let w = owner ?? this.byId(id);
    if (!w) {
      w = this.begin({ key }, "sending", id);
    } else if (!owner && w.key === key && w.status !== "sending") {
      w.status = "sending";
      w.error = null;
      w.settled = null;
    }
    const kept = keepable(bare);
    const wire = w.calls.find((c) => c.id === id);
    if (wire) {
      wire.status = "sending";
      wire.error = null;
    } else
      w.calls.push({ id, path, body: kept, status: "sending", error: null, at: this.env.now() });
    this.changed();
    const sent = Promise.resolve()
      .then(() => send({ ...body, requestId: id }))
      // A send the server took: its outcome is the server's record of it, asked until it's in.
      .then((answer) =>
        isAccepted(answer) ? (this.follow(id as string, path, kept) as Promise<R>) : answer,
      )
      .then(
        (answer) => {
          this.wireDone(id as string, "sent", null);
          return answer;
        },
        (err: unknown) => {
          this.wireDone(id as string, this.kindOf(err), wordsOf(err));
          throw err;
        },
      );
    this.wires.set(id, sent);
    const forget = () => {
      if (this.wires.get(id as string) === sent) this.wires.delete(id as string);
    };
    sent.then(forget, forget);
    // Its own press: a second identical call while it's out shares it.
    if (!owner && w.key === key) return this.trackOwn(w, sent);
    return sent;
  }

  // --- coming back, going -------------------------------------------------------------------

  /** A return: held presses past due go, lost calls go again, outcomes are said, reads refresh. */
  back(first = false): Promise<void> {
    if (this.backing) {
      this.backAgain = true;
      return this.backing;
    }
    const run = this.backOnce(first).finally(() => {
      this.backing = null;
      if (this.backAgain) {
        this.backAgain = false;
        void this.back();
      }
    });
    this.backing = run;
    return run;
  }

  private async backOnce(first: boolean): Promise<void> {
    const now = this.env.now();
    const away = this.hiddenAt;
    if (this.env.visible()) this.hiddenAt = null;
    await this.due();
    const asks: Promise<unknown>[] = [];
    for (const w of [...this.list]) {
      if (w.status === "held") continue;
      for (const c of w.calls) {
        if (c.status === "sent" || c.status === "failed") continue;
        if (this.wires.has(c.id)) {
          // A send the server took: ask how it went now. Any other out in this page: ask about
          // a long one, in case its answer was lost.
          if (this.following.has(c.id)) asks.push(this.askFollowing(c.id));
          else if (now - c.at >= ASK_AFTER_MS && this.hooks.status) asks.push(this.ask(w, c));
          continue;
        }
        // Lost (offline, 5xx) or left by an earlier load: again, under its id.
        asks.push(this.resend(w, c));
      }
      if (open(w.status) && !w.calls.length && w.page !== this.page && !this.live.has(w.key)) {
        // A press an earlier load started that never reached the wire: nothing to send it with.
        this.settle(w, "failed", "The page reloaded before it was sent. Send it again.");
      }
    }
    await Promise.allSettled(asks);
    this.tellUntold();
    const touched = this.list.some(
      (w) =>
        open(w.status) ||
        (w.settled !== null && (away !== null ? w.settled >= away : now - w.settled < 60_000)),
    );
    if ((touched || first) && this.list.length) await this.reread();
  }

  /** The page is going: every held press goes now (keepalive, as the tab is hidden). */
  gone() {
    for (const w of this.list) if (w.status === "held") this.commit(w);
    this.save();
  }

  /** Held presses whose deadline passed go now. */
  async due(): Promise<void> {
    const now = this.env.now();
    const going = this.list.filter((w) => w.status === "held" && w.due !== null && now >= w.due);
    for (const w of going) this.commit(w);
  }

  // --- inside -------------------------------------------------------------------------------

  private begin(o: PressOptions, status: WriteStatus, id?: string): Write {
    // A lost press of the same key keeps its id: the server runs it once.
    const lost = this.list.find(
      (x) => x.key === o.key && (x.status === "unsure" || x.status === "sending"),
    );
    if (lost && !this.live.has(o.key)) {
      lost.status = status;
      lost.error = null;
      if (o.input !== undefined) lost.input = o.input && keepable(o.input);
      this.changed();
      return lost;
    }
    // A new press of a key replaces its settled line.
    this.list = this.list.filter((x) => !(x.key === o.key && done(x.status)));
    const w: Write = {
      id: id ?? this.env.id(),
      key: o.key,
      what: o.what ?? null,
      label: o.label ?? null,
      records: [...(o.records ?? [])],
      input: o.input ? keepable(o.input) : null,
      status,
      error: null,
      at: this.env.now(),
      settled: null,
      due: null,
      hide: !!o.hide,
      read: false,
      told: false,
      page: this.page,
      retried: false,
      accepted: false,
      calls: [],
    };
    this.list.push(w);
    this.changed();
    return w;
  }

  private track<R>(w: Write, fn: (requestId: string) => Promise<R>, waited = true): Promise<R> {
    let p: Promise<R>;
    try {
      p = Promise.resolve(fn(w.id));
    } catch (err) {
      p = Promise.reject(err);
    }
    return this.trackOwn(w, p, waited);
  }

  /** `waited`: whoever started it awaits the answer and says it, if the person can see. */
  private trackOwn<R>(w: Write, p: Promise<R>, waited = true): Promise<R> {
    const tracked = p.then(
      (answer) => {
        this.settle(w, "sent", null, waited);
        return answer;
      },
      (err: unknown) => {
        const kind = this.kindOf(err);
        if (kind === "unsure") {
          w.status = "unsure";
          w.error = wordsOf(err);
          w.retried = true;
          this.changed();
        } else this.settle(w, "failed", wordsOf(err), waited);
        throw err;
      },
    );
    const key = w.key;
    const clear = () => {
      if (this.live.get(key) === tracked) this.live.delete(key);
    };
    tracked.then(clear, clear);
    this.live.set(key, tracked);
    return tracked;
  }

  private commit(w: Write) {
    const go = this.commits.get(w.id);
    this.commits.delete(w.id);
    if (!go) {
      // Held in an earlier load: it went on that page's way out, or never could.
      if (!w.calls.length) this.settle(w, "failed", "The page closed before it went. Do it again.");
      return;
    }
    w.status = "sending";
    w.due = null;
    this.changed();
    // Nobody waits on a held press: its outcome is said by `tell`.
    void this.track(w, go, false).catch(() => undefined);
  }

  private async resend(w: Write, c: WireCall) {
    const send = this.hooks.send;
    if (!send || !c.body) {
      if (w.page !== this.page && !this.live.has(w.key))
        this.settle(w, "failed", "The page reloaded before it was sent. Send it again.");
      return;
    }
    try {
      await this.call(c.path, { ...c.body, requestId: c.id }, (b) => send(c.path, b));
    } catch {
      // Said by its status; a lost one tries again on the next return.
    }
  }

  private async ask(w: Write, c: WireCall) {
    try {
      const got = await this.hooks.status?.(c.path, c.id);
      if (!got || got.state === "sending") return;
      if (got.state === "sent") this.wireDone(c.id, "sent", null);
      else if (got.state === "failed") this.wireDone(c.id, "failed", got.error);
      else if (c.body && this.hooks.send) {
        // The server never got it: send it again, under its id.
        this.wires.delete(c.id);
        await this.resend(w, c);
      }
    } catch {
      // The server can't say now: the call's own answer still comes.
    }
  }

  /** A send the server took: resolves with its answer once `status` says it went. */
  private follow(id: string, path: string, body: Record<string, unknown> | null): Promise<unknown> {
    const w = this.ownerOf(id) ?? this.byId(id);
    const c = w?.calls.find((x) => x.id === id);
    if (c) c.accepted = true;
    if (w) w.accepted = true;
    this.changed();
    return new Promise((resolve, reject) => {
      this.following.set(id, { path, body, resolve, reject, tries: 0, asking: false });
      this.remindFollowing(id);
    });
  }

  /**
   * The socket that pushes outcomes opened (true) or closed. While it's open, asking `status`
   * is a slow fallback; when it closes, every send is asked about at once.
   */
  pushed(on: boolean) {
    if (this.pushing === on) return;
    this.pushing = on;
    if (!on) for (const id of [...this.following.keys()]) void this.askFollowing(id);
  }

  /** The server says how the call under `id` goes (pushed over the socket). */
  heard(id: string, got: WireState) {
    if (this.following.has(id)) return void this.apply(id, got);
    // A call this page didn't send (an earlier load's) and isn't asking about: settle it here.
    const w = this.ownerOf(id) ?? this.byId(id);
    const c = w?.calls.find((x) => x.id === id);
    if (!w || !c || c.status === "sent" || c.status === "failed") return;
    if (got.state === "sent") this.wireDone(id, "sent", null);
    else if (got.state === "failed") this.wireDone(id, "failed", got.error);
    else if (got.state === "sending") this.retrying(id, got.retry ?? null);
  }

  private remindFollowing(id: string) {
    const f = this.following.get(id);
    if (!f) return;
    const ms = Math.min(
      FOLLOW_FIRST_MS * 2 ** f.tries,
      this.pushing ? FOLLOW_PUSHED_MS : FOLLOW_MAX_MS,
    );
    f.tries += 1;
    this.env.remind(ms, () => void this.askFollowing(id));
  }

  /** How a taken send went, from the server: in, refused (and why), or still going. */
  private async askFollowing(id: string) {
    const f = this.following.get(id);
    if (!f || f.asking) return;
    f.asking = true;
    try {
      const got = await this.hooks.status?.(f.path, id);
      if (got) await this.apply(id, got);
    } catch {
      // The server can't say now: ask again on the next reminder or return.
    } finally {
      f.asking = false;
    }
    if (this.following.has(id)) this.remindFollowing(id);
  }

  /** What the server said of a taken send (asked or pushed). */
  private async apply(id: string, got: WireState) {
    const f = this.following.get(id);
    if (!f) return;
    if (got.state === "sent") {
      this.following.delete(id);
      f.resolve(got.answer ?? null);
    } else if (got.state === "failed") {
      this.following.delete(id);
      f.reject(new Error(got.error));
    } else if (got.state === "sending") this.retrying(id, got.retry ?? null);
    else if (got.state === "unknown" && f.body && this.hooks.send) {
      // Taken, yet the server has no record (it keeps them a day): give it again, same id.
      await this.hooks.send(f.path, { ...f.body, requestId: id });
    }
  }

  /** The server is still at it: keep why it is trying again, if it is. */
  private retrying(id: string, retry: Retry | null) {
    const w = this.ownerOf(id) ?? this.byId(id);
    const c = w?.calls.find((x) => x.id === id);
    if (!w || !c) return;
    const was = c.retry ?? null;
    if (was === retry || (was && retry && was.count === retry.count && was.reason === retry.reason))
      return;
    c.retry = retry;
    w.retry = w.calls.find((x) => x.retry)?.retry ?? null;
    this.changed();
  }

  private wireDone(id: string, status: WireCall["status"], error: string | null) {
    const w = this.ownerOf(id) ?? this.byId(id);
    if (!w) return;
    const c = w.calls.find((x) => x.id === id);
    if (!c) return;
    c.status = status;
    c.error = error;
    if (this.live.has(w.key) && w.page === this.page) return this.changed();
    // No press here waits on it (an earlier load's): its calls decide.
    if (w.calls.some((x) => x.status === "failed"))
      this.settle(w, "failed", w.calls.find((x) => x.status === "failed")?.error ?? null);
    else if (w.calls.every((x) => x.status === "sent")) this.settle(w, "sent", null);
    else if (w.calls.some((x) => x.status === "unsure")) {
      w.status = "unsure";
      w.retried = true;
      w.error = error;
      this.changed();
    } else this.changed();
  }

  private settle(w: Write, status: "sent" | "failed", error: string | null, waited = false) {
    w.status = status;
    w.error = error;
    w.settled = this.env.now();
    w.due = null;
    // Said by whoever pressed, if the person could see it; else by `tell`, now or on return.
    // A send's refusal comes long after the press, when the person may be elsewhere: always said.
    w.told =
      waited && this.showing() && w.page === this.page && !(w.accepted && status === "failed");
    this.changed();
    if (!w.told && this.env.visible()) this.tellUntold();
    w.retry = null;
    if (w.hide && status === "sent") void this.reread(w);
    if (status === "sent" && w.records.length)
      try {
        this.hooks.landed?.([...w.records]);
      } catch {
        // Nobody to tell.
      }
  }

  private tellUntold() {
    if (!this.env.visible()) return;
    for (const w of this.list)
      if (done(w.status) && !w.told) {
        w.told = true;
        // A failure is always said. A landing only when it carried words, was lost once, or
        // was a send the server ran on its own time (he may be on another page by then): a
        // set-aside that went is what the list already shows.
        if (w.status === "sent" && !w.input && !w.retried && !w.accepted) continue;
        try {
          this.hooks.tell?.(w);
        } catch {
          // A line that can't show: the box still says it.
        }
      }
    this.changed();
  }

  private async reread(w?: Write) {
    try {
      await this.hooks.reread?.();
    } catch {
      // A read that failed says so itself.
    }
    const settled = w ? [w] : this.list.filter((x) => done(x.status));
    let moved = false;
    for (const x of settled)
      if (!x.read && done(x.status)) {
        x.read = true;
        moved = true;
      }
    if (moved) this.changed();
  }

  private kindOf(err: unknown): "unsure" | "failed" {
    return failureKind(err, () => false) === "transient" ? "unsure" : "failed";
  }

  private byId(id: string) {
    return this.list.find((w) => w.id === id) ?? null;
  }

  /** The press a call's id belongs to: its own id, or `<id>-<n>`. */
  private ownerOf(id: string): Write | null {
    for (const w of this.list) if (id === w.id || id.startsWith(`${w.id}-`)) return w;
    return null;
  }

  private changed() {
    this.prune();
    this.save();
    this.snap = [...this.list];
    for (const f of [...this.seen]) f();
  }

  private prune() {
    const now = this.env.now();
    this.list = this.list.filter(
      (w) => open(w.status) || w.settled === null || now - w.settled < RECENT_MS || !w.told,
    );
  }

  private save() {
    const s = this.env.storage;
    if (!s) return;
    try {
      if (this.list.length) s.setItem(STORE_KEY, JSON.stringify(this.list));
      else s.removeItem(STORE_KEY);
    } catch {
      // Full or blocked: this page still holds them.
    }
  }

  private load(): Write[] {
    try {
      const raw = this.env.storage?.getItem(STORE_KEY);
      const got = raw ? (JSON.parse(raw) as Write[]) : [];
      return Array.isArray(got) ? got.filter((w) => w && typeof w.id === "string") : [];
    } catch {
      return [];
    }
  }
}

function session(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function listenPage(fn: (e: WritePageEvent) => void): () => void {
  if (typeof addEventListener !== "function" || typeof document === "undefined") return () => {};
  const vis = () => fn(document.visibilityState === "hidden" ? "hidden" : "back");
  const back = () => fn("back");
  const gone = () => fn("gone");
  document.addEventListener("visibilitychange", vis);
  document.addEventListener("freeze", gone);
  addEventListener("focus", back);
  addEventListener("pageshow", back);
  addEventListener("online", back);
  addEventListener("pagehide", gone);
  return () => {
    document.removeEventListener("visibilitychange", vis);
    document.removeEventListener("freeze", gone);
    removeEventListener("focus", back);
    removeEventListener("pageshow", back);
    removeEventListener("online", back);
    removeEventListener("pagehide", gone);
  };
}

/** The browser's. */
export function browserWriteEnv(): WriteEnv {
  return {
    storage: session(),
    now: () => Date.now(),
    id: newId,
    visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    listen: listenPage,
    remind: (ms, fn) => void setTimeout(fn, ms),
  };
}

/** Every write in this tab. */
export const WRITES = new Writes(browserWriteEnv());

/** Two equal values make one key, whatever their keys' order. */
export const stableKey = (v: unknown) => stable(v);
