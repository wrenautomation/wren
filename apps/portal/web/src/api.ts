/**
 * The portal API: POST /api/<service>/<route> with JSON (`delivery/home`,
 * `reactivation/people`). On app.<domain> each call
 * carries a short-lived token from our sign-in at auth.<domain>; no session
 * there sends the browser to sign in and back. The demo and the local preview
 * need none.
 */

export type {
  AskView,
  BoardRow,
  DeliverableView,
  DeliveryHome,
  EngagementView,
  MailLevel,
  Me,
  MemberView,
  MilestoneState,
  PulseView,
  ResultView,
  StepView,
  UpdateView,
} from "@wren/delivery/restate";
export type {
  CrmHealth,
  EmailFilter,
  EmailRow,
  EmailsPage,
  LiveRun,
  Now,
  Overview,
  PeopleFilter,
  PeoplePage,
  PersonRow,
  PersonView,
  Pipeline,
  PipelineStep,
  PipelineStepId,
  RankedContact,
  RawFinding,
  RawPage,
  Reason,
  RepliesPage,
  ReplyFilter,
  ReplyRow,
  ReviewResult,
  RunPage,
  Setup,
  Source,
  StepState,
  Story,
  WhyLine,
} from "@wren/reactivation/restate";

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

const SENT_AT = "wren.signInSentAt";

/**
 * Off to sign in; back here after. Never resolves: the page is leaving. Sent
 * there under 30s ago and still refused: stop, so a token we reject can't loop.
 */
export function signIn(): Promise<never> {
  if (!AUTH_ORIGIN) return new Promise(() => {});
  try {
    if (Date.now() - Number(sessionStorage.getItem(SENT_AT) ?? 0) < 30_000)
      throw new ApiError("Sign-in isn't sticking. Try again in a minute.", 401);
    sessionStorage.setItem(SENT_AT, String(Date.now()));
  } catch (err) {
    if (err instanceof ApiError) return Promise.reject(err);
  }
  location.assign(`${AUTH_ORIGIN}/?next=${encodeURIComponent(location.href)}`);
  return new Promise(() => {});
}

export const signOutUrl = AUTH_ORIGIN ? `${AUTH_ORIGIN}/?out=1` : null;

let held: { token: string; until: number } | null = null;

/** The current token, fetched again a minute before it runs out. */
async function token(): Promise<string | null> {
  if (!AUTH_ORIGIN) return null;
  if (held && held.until > Date.now()) return held.token;
  let res: Response;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/auth/token`, { credentials: "include" });
  } catch {
    throw new ApiError("You're offline, or sign-in is.", 0);
  }
  if (res.status === 401) return signIn();
  if (!res.ok) throw new ApiError(`Couldn't check your sign-in (${res.status}).`, res.status);
  const { token: t } = (await res.json()) as { token: string };
  const exp = JSON.parse(atob(t.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")).exp;
  held = { token: t, until: Number(exp) * 1000 - 60_000 };
  return t;
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
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("You're offline, or the portal is.", 0);
  }
  // A token the Worker refused (keys rotated, clock skew): one fresh one, then sign in.
  if (res.status === 401 && AUTH_ORIGIN) {
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
