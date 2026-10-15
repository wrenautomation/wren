/**
 * The portal API: POST /api/<service>/<route> with JSON (`delivery/home`,
 * `reactivation/recordsList`). On app.<domain> each call
 * carries a short-lived token from our sign-in at auth.<domain>; no session
 * there sends the browser to sign in and back. The demo and the local preview
 * need none.
 */
import { FILE_TYPES, MAX_FILE_BYTES, typeOfName } from "@wren/delivery/routes";
import { tellAutotrack } from "./autotrack.js";
import { dropSnapshot } from "./snapshot.js";

export type {
  AccessView,
  AccountView,
  AskView,
  BoardRow,
  CommentView,
  ContractView,
  DeliverableView,
  DeliveryHome,
  EngagementView,
  MailLevel,
  Me,
  MemberView,
  MilestoneState,
  MomentView,
  NextView,
  PulseView,
  ResultView,
  ReviewView,
  StepView,
  UpdateView,
} from "@wren/delivery/restate";
export type {
  EmailFilter,
  EmailRow,
  EmailsPage,
  ImportPreview,
  ImportResult,
  ImportSampleRow,
  LiveRun,
  Now,
  Overview,
  PersonRow,
  PersonView,
  Pipeline,
  PipelineStep,
  PipelineStepId,
  RankedContact,
  Reason,
  ReviewResult,
  RunPage,
  Source,
  StepState,
  Story,
  WhyLine,
  WorkFact,
  WorkIcon,
  WorkLink,
  WorkOption,
  WorkStep,
  WorkView,
} from "@wren/reactivation/restate";

/** Sent when a look is saved or a component installed: the shell asks `me` again. */
export const ME_CHANGED = "wren:me-changed";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The input a refusal is about, when it names one (`subreddit`, `title`). */
    readonly field?: string,
    /** What kind of no: `conflict` is a save over a version that moved (the save engine reads it). */
    readonly code?: string,
  ) {
    super(message);
  }
  /** A save over a version that changed meanwhile: show both, never drop either. */
  get conflict(): boolean {
    return this.code === "conflict";
  }
}

type Refused = {
  message?: string;
  error?: string;
  metadata?: { field?: unknown; code?: unknown };
} | null;

/** A refusal's answer as an ApiError: its words, its status, the field it names. */
const refusalOf = (d: Refused, status: number): ApiError => {
  const field = d?.metadata?.field;
  const code = d?.metadata?.code;
  return new ApiError(
    d?.message ?? d?.error ?? `Something went wrong (${status}).`,
    status,
    typeof field === "string" ? field : undefined,
    typeof code === "string" ? code : undefined,
  );
};

/** Where sign-in lives, or null on a host that needs none. */
export const AUTH_ORIGIN = location.hostname.startsWith("app.")
  ? `${location.protocol}//auth.${location.hostname.slice("app.".length)}`
  : null;

/**
 * A client's own host (portal.theirfirm.com): sign-in runs through this host's `/__auth/*`, and
 * the session stays in its own cookie (designs/2026-10-06-custom-domains.md).
 */
const ON_CLIENT_HOST =
  !AUTH_ORIGIN && !/^(demo\.|localhost$|127\.0\.0\.1$|\[::1\]$)/.test(location.hostname);

const SENT_AT = "wren.signInSentAt";

/**
 * Off to sign in; back here after. Never resolves: the page is leaving. Sent
 * there under 30s ago and still refused: stop, so a token we reject can't loop.
 */
export function signIn(): Promise<never> {
  if (!AUTH_ORIGIN && !ON_CLIENT_HOST) return new Promise(() => {});
  forgetDevice();
  try {
    if (Date.now() - Number(sessionStorage.getItem(SENT_AT) ?? 0) < 30_000)
      throw new ApiError("Sign-in isn't sticking. Try again in a minute.", 401);
    sessionStorage.setItem(SENT_AT, String(Date.now()));
  } catch (err) {
    if (err instanceof ApiError) return Promise.reject(err);
  }
  location.assign(
    AUTH_ORIGIN
      ? `${AUTH_ORIGIN}/?next=${encodeURIComponent(location.href)}`
      : `/__auth/in?next=${encodeURIComponent(location.pathname + location.search)}`,
  );
  return new Promise(() => {});
}

export const signOutUrl = AUTH_ORIGIN
  ? `${AUTH_ORIGIN}/?out=1`
  : ON_CLIENT_HOST
    ? "/__auth/out"
    : null;

const TOKEN_URL = AUTH_ORIGIN
  ? `${AUTH_ORIGIN}/api/auth/token`
  : ON_CLIENT_HOST
    ? "/__auth/token"
    : null;

/** The token kept across loads (it lasts 15 minutes), and who it names, kept past that. */
const HELD_KEY = "wren.portal.token";
const OWNER_KEY = "wren.portal.owner";

/** This browser's local storage, or null where it's blocked. */
export const device = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
const stored = (key: string): string | null => {
  try {
    return device()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null) => {
  try {
    if (value === null) device()?.removeItem(key);
    else device()?.setItem(key, value);
  } catch {
    // Blocked storage: every load asks for a token, as before.
  }
};

let held: { token: string; until: number } | null = (() => {
  if (!TOKEN_URL) return null;
  try {
    const h = JSON.parse(stored(HELD_KEY) ?? "null") as { token: string; until: number } | null;
    return h && h.until > Date.now() ? h : null;
  } catch {
    return null;
  }
})();

/**
 * Who last signed in on this device: what the portal shows before the server answers belongs to
 * them. A host without sign-in (the demo, a local run) has one viewer.
 */
export const deviceOwner = (): string | null => (TOKEN_URL ? stored(OWNER_KEY) : "here");

/** Sign-out, or a sign-in the server refused: nothing of this login stays on the device. */
export function forgetDevice() {
  held = null;
  store(HELD_KEY, null);
  store(OWNER_KEY, null);
  const d = device();
  if (d) dropSnapshot(d);
}

// Sign-out is a plain link to the sign-in host: wipe the device on the click, before it leaves.
if (signOutUrl && typeof addEventListener === "function")
  addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && a.getAttribute("href") === signOutUrl) forgetDevice();
    },
    true,
  );
/** One ask at a time: calls made together share it. */
let asking: Promise<string | null> | null = null;

/** The current token, fetched again a minute before it runs out. */
function token(): Promise<string | null> {
  if (!TOKEN_URL) return Promise.resolve(null);
  if (held && held.until > Date.now()) return Promise.resolve(held.token);
  asking ??= fresh(TOKEN_URL).finally(() => {
    asking = null;
  });
  return asking;
}

/** The sign-in token for a socket, which can't carry the header (live notes). Null = none here. */
export const socketToken = (): Promise<string | null> => token();

/** The sign-in header for a call made outside `call` (dictation's audio). */
export async function authHeaders(): Promise<Record<string, string>> {
  const t = await token();
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function fresh(url: string): Promise<string | null> {
  const ask = async () => {
    try {
      return await fetch(url, { credentials: "include" });
    } catch {
      throw new ApiError("You're offline, or sign-in is.", 0);
    }
  };
  let res = await ask();
  // Too many checks at once (tabs opening together): wait as asked, at most 5 s, and ask once more.
  if (res.status === 429) {
    const wait = Math.min(5, Number(res.headers.get("retry-after")) || 2);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await ask();
  }
  if (res.status === 401) return signIn();
  if (res.status === 429) throw new ApiError("Sign-in is busy. Try again in a minute.", 429);
  if (!res.ok) throw new ApiError(`Couldn't check your sign-in (${res.status}).`, res.status);
  const { token: t } = (await res.json()) as { token: string };
  const claims = JSON.parse(atob(t.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""));
  held = { token: t, until: Number(claims.exp) * 1000 - 60_000 };
  // Someone else signed in here: the last login's snapshot isn't theirs.
  const who = String(claims.email ?? "").toLowerCase() || null;
  const d = device();
  if (d && who !== stored(OWNER_KEY)) dropSnapshot(d);
  store(OWNER_KEY, who);
  store(HELD_KEY, JSON.stringify(held));
  return t;
}

const VIEW_AS = "wren.viewAs";

/**
 * View as (designs/2026-10-14-view-as.md): which client this tab looks at, as whom, Look or Act.
 * One tab only (session storage). Every call carries it; the server decides.
 */
export interface ViewAsTab {
  /** A client's id, or `wren` for a teammate. */
  client: string;
  email?: string;
  role?: string;
  act?: boolean;
  /** The picker's say, kept in the tab only: this login may Act (an admin). */
  mayAct?: boolean;
}

export const viewing: ViewAsTab | null = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_AS) ?? "null") as ViewAsTab | null;
    return v && typeof v === "object" && typeof v.client === "string" ? v : null;
  } catch {
    return null;
  }
})();

/** Under View as, Look: this tab reads only. Null when it may change things (yours, or Act). */
export const viewingAs: string | null =
  viewing && !viewing.act ? (viewing.email ?? viewing.role ?? viewing.client) : null;

/** Start, change or stop View as. The app opens again from the top, as them or as you. */
export function viewAs(v: ViewAsTab | null) {
  try {
    if (v) sessionStorage.setItem(VIEW_AS, JSON.stringify(v));
    else sessionStorage.removeItem(VIEW_AS);
  } catch {
    // No session storage: nothing to look as.
  }
  location.assign("/");
}

/** A call as yourself, whatever this tab views as: the View as picker's. */
export const callAsMe = <T>(path: string, body: Record<string, unknown> = {}): Promise<T> =>
  call<T>(path, { ...body, viewAs: null });

/** What the server reads of it. */
const wire = viewing && {
  client: viewing.client,
  ...(viewing.email ? { email: viewing.email } : {}),
  ...(viewing.role ? { role: viewing.role } : {}),
  act: viewing.act === true,
};
/** The body as sent: with this tab's View as, unless the call says its own. */
const viewed = (body: Record<string, unknown>) =>
  wire && !("viewAs" in body) ? { ...body, viewAs: wire } : body;

/** Answers read once per load and shared: a product's record types never change under a page. */
const SHARED = /(^|\/)recordsTypes$/;
const shared = new Map<string, Promise<unknown>>();
// A saved look or a changed install can change what is served: read again.
if (typeof addEventListener === "function") addEventListener(ME_CHANGED, () => shared.clear());

export function call<T>(
  path: string,
  body: Record<string, unknown> = {},
  retried = false,
): Promise<T> {
  if (!SHARED.test(path)) return send<T>(path, body, retried);
  const key = `${path}:${JSON.stringify(body)}`;
  let got = shared.get(key) as Promise<T> | undefined;
  if (!got) {
    got = send<T>(path, body, retried);
    // A failed read asks again next time.
    got.catch(() => shared.delete(key));
    shared.set(key, got);
  }
  return got;
}

type Queued = {
  path: string;
  body: Record<string, unknown>;
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
};
let batch: Queued[] | null = null;
/** What `apps/portal/src/pulse.ts` takes in one request. */
const BATCH_MAX = 8;

/**
 * Run `fn`, and send the reads it starts right now (not after an await) as one request, not one
 * each. A lone read goes alone. If the batch fails, each read is sent by itself.
 */
export function batched<T>(fn: () => T): T {
  const outer = batch;
  const mine: Queued[] = [];
  batch = mine;
  try {
    return fn();
  } finally {
    batch = outer;
    void flush(mine);
  }
}

async function flush(all: Queued[]) {
  for (let i = 0; i < all.length; i += BATCH_MAX) {
    const some = all.slice(i, i + BATCH_MAX);
    const alone = (q: Queued) => sendNow<unknown>(q.path, q.body, false).then(q.ok, q.fail);
    const [only] = some;
    if (some.length === 1 && only) {
      await alone(only);
      continue;
    }
    let answers: { status: number; body: unknown }[] | null = null;
    try {
      const got = await sendNow<{ answers: { status: number; body: unknown }[] }>(
        "pulse",
        { calls: some.map((q) => ({ path: q.path, body: q.body })) },
        false,
      );
      if (got.answers.length === some.length) answers = got.answers;
    } catch {
      // The batch itself failed: each read asks for itself below.
    }
    await Promise.all(
      some.map((q, k) => {
        const a = answers?.[k];
        // A refused token or a failed batch: the single path knows how to sign in again.
        if (!a || a.status === 401 || a.status === 0) return alone(q);
        tellAutotrack(q.path, q.body, a.status);
        if (a.status >= 200 && a.status < 300) return q.ok(a.body);
        return q.fail(refusalOf(a.body as Refused, a.status));
      }),
    );
  }
}

function send<T>(path: string, body: Record<string, unknown>, retried: boolean): Promise<T> {
  if (batch && !retried) {
    const into = batch;
    return new Promise<T>((ok, fail) => {
      into.push({
        path,
        body: viewed(body),
        ok: ok as (v: unknown) => void,
        fail,
      });
    });
  }
  return sendNow<T>(path, body, retried);
}

async function sendNow<T>(
  path: string,
  body: Record<string, unknown>,
  retried: boolean,
): Promise<T> {
  const t = await token();
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(t ? { authorization: `Bearer ${t}` } : {}),
      },
      body: JSON.stringify(viewed(body)),
    });
  } catch {
    tellAutotrack(path, body, 0);
    throw new ApiError("You're offline, or the portal is.", 0);
  }
  // A token the Worker refused (keys rotated, clock skew): one fresh one, then sign in.
  if (res.status === 401 && TOKEN_URL) {
    held = null;
    store(HELD_KEY, null);
    return retried ? signIn() : sendNow<T>(path, body, true);
  }
  tellAutotrack(path, body, res.status);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an error page from the edge.
  }
  if (!res.ok) throw refusalOf(data as Refused, res.status);
  return data as T;
}

/** Straight to the private bucket on a signed PUT; the portal only signs (D11). Answers its key. */
export async function uploadFile(client: string | undefined, file: File): Promise<string> {
  const type = FILE_TYPES[file.type] ? file.type : typeOfName(file.name);
  if (!type)
    throw new ApiError("That kind of file isn't taken. Send a PDF, image, sheet or doc.", 400);
  if (file.size > MAX_FILE_BYTES)
    throw new ApiError(`Files go up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`, 400);
  const { key, url } = await call<{ key: string; url: string }>("delivery/upload", {
    client,
    name: file.name,
    type,
    size: file.size,
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": type },
    body: file,
  }).catch(() => null);
  if (!res?.ok) throw new ApiError("The file didn't go up. Try again.", res?.status ?? 0);
  return key;
}
