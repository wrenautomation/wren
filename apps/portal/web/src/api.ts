/**
 * The portal API: POST /api/<service>/<route> with JSON (`delivery/home`,
 * `reactivation/recordsList`). On app.<domain> each call
 * carries a short-lived token from our sign-in at auth.<domain>; no session
 * there sends the browser to sign in and back. The demo and the local preview
 * need none.
 */
import { FILE_TYPES, MAX_FILE_BYTES, typeOfName } from "@wren/delivery/routes";

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
  ) {
    super(message);
  }
}

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

let held: { token: string; until: number } | null = null;
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
  const exp = JSON.parse(atob(t.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")).exp;
  held = { token: t, until: Number(exp) * 1000 - 60_000 };
  return t;
}

const VIEW_AS = "wren.viewAs";

/** View as: the person this tab looks as, read only. Every call carries it; the server checks. */
export const viewingAs: string | null = (() => {
  try {
    return sessionStorage.getItem(VIEW_AS) || null;
  } catch {
    return null;
  }
})();

/** Start or stop View as. The app opens again from the top, as that person or as you. */
export function viewAs(email: string | null) {
  try {
    if (email) sessionStorage.setItem(VIEW_AS, email);
    else sessionStorage.removeItem(VIEW_AS);
  } catch {
    // No session storage: nothing to look as.
  }
  location.assign("/");
}

export async function call<T>(
  path: string,
  body: Record<string, unknown> = {},
  retried = false,
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
      body: JSON.stringify(viewingAs ? { ...body, viewAs: viewingAs } : body),
    });
  } catch {
    throw new ApiError("You're offline, or the portal is.", 0);
  }
  // A token the Worker refused (keys rotated, clock skew): one fresh one, then sign in.
  if (res.status === 401 && TOKEN_URL) {
    held = null;
    return retried ? signIn() : call<T>(path, body, true);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an error page from the edge.
  }
  if (!res.ok) {
    const d = data as { message?: string; error?: string } | null;
    throw new ApiError(
      d?.message ?? d?.error ?? `Something went wrong (${res.status}).`,
      res.status,
    );
  }
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
