/**
 * The sign-in pages (A3, A4, A8): an emailed code or its link, Google,
 * Microsoft, or a password. Signed in, it sends you on to `?next=` (one of our
 * hosts) or the portal. `?out=1` signs out first. `/reset` sets a password.
 */
import { Alert, Button, ButtonLink, Gate } from "@wren/ui";
import { type FormEvent, useEffect, useState } from "react";
import { nextOf } from "./next.js";

const STAMP = "/wren-icon.png";
const TITLE = "Sign in to Wren";
/** auth.example.com → example.com. */
const BASE = location.hostname.replace(/^auth\./, "");
const PORTAL = `https://app.${BASE}/`;

/** Better Auth's error codes, said plainly. */
const SAID: Record<string, string> = {
  INVALID_OTP: "That code didn't match. Check it, or send a new one.",
  OTP_EXPIRED: "That code ran out. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries on that code. Send a new one.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  PASSWORD_COMPROMISED: "That password shows up in known breaches. Pick another.",
  PASSWORD_TOO_SHORT: "Use at least 10 characters.",
  INVALID_TOKEN: "That link has run out. Ask for a new one.",
};
const PROVIDER_FAILED =
  "That sign-in didn't work. If you're new, ask the person you work with at Wren to invite you, or sign in with an emailed code.";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/auth/${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (res.status === 429) throw new Error("Too many tries. Wait a few minutes.");
  if (!res.ok)
    throw new Error(
      (data?.code && SAID[data.code]) || data?.message || `Something went wrong (${res.status}).`,
    );
  return data as T;
}

/** Run a form's action with its busy flag and error line. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, setProblem, run };
}

export function App() {
  if (location.pathname === "/link") return <EmailLink />;
  if (location.pathname === "/reset") return <Reset />;
  return <Home />;
}

function Home() {
  const [ready, setReady] = useState(false);
  const next = nextOf(location.search, BASE);
  const error = new URLSearchParams(location.search).get("error");

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival.
  useEffect(() => {
    void (async () => {
      if (new URLSearchParams(location.search).get("out")) {
        await api("sign-out", {}).catch(() => {});
        history.replaceState(null, "", "/");
      }
      const s = await api<{ user?: unknown } | null>("get-session").catch(() => null);
      if (s?.user) location.replace(next);
      else setReady(true);
    })();
  }, []);

  if (!ready)
    return (
      <Gate stamp={STAMP} title={TITLE}>
        <p>One moment…</p>
      </Gate>
    );
  return <SignIn next={next} failed={Boolean(error)} />;
}

function SignIn({ next, failed }: { next: string; failed: boolean }) {
  const [mode, setMode] = useState<"code" | "password">("code");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, problem, setProblem, run } = useAction();
  useEffect(() => {
    if (failed) setProblem(PROVIDER_FAILED);
  }, [failed, setProblem]);

  const social = (provider: "google" | "microsoft") =>
    run(async () => {
      const { url } = await api<{ url: string }>("sign-in/social", {
        provider,
        // Back here first, so `next` gets the same check as every other way in.
        callbackURL: `${location.origin}/?next=${encodeURIComponent(next)}`,
        errorCallbackURL: `${location.origin}/`,
      });
      location.assign(url);
    });

  const sendCode = run(async () => {
    await api("email-otp/send-verification-otp", { email, type: "sign-in" });
    setSent(true);
    setNote(`If ${email} has access, a code is on its way. It works for 10 minutes.`);
  });
  const useCode = run(async () => {
    await api("sign-in/email-otp", { email, otp: code.trim() });
    location.replace(next);
  });
  const usePassword = run(async () => {
    await api("sign-in/email", { email, password });
    location.replace(next);
  });
  const forgot = run(async () => {
    if (!email) throw new Error("Enter your email first.");
    await api("request-password-reset", { email, redirectTo: `${location.origin}/reset` });
    setNote(
      "If this email has an account, a link to set a password is on its way. New here? Sign in with a code first.",
    );
  });

  return (
    <Gate stamp={STAMP} title={TITLE}>
      {problem ? <Alert>{problem}</Alert> : null}
      {note ? <p>{note}</p> : null}
      {!sent ? (
        <>
          <Button tone="secondary" disabled={busy} onClick={() => void social("google")()}>
            Continue with Google
          </Button>
          <Button tone="secondary" disabled={busy} onClick={() => void social("microsoft")()}>
            Continue with Microsoft
          </Button>
          <p>Or use your email.</p>
        </>
      ) : null}
      {mode === "code" && sent ? (
        <form onSubmit={useCode}>
          <label className="ui-field">
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              // biome-ignore lint/a11y/noAutofocus: the one thing to do on this screen.
              autoFocus
            />
          </label>
          <Button tone="primary" type="submit" disabled={busy}>
            Sign in
          </Button>
          <Button
            tone="quiet"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setNote(null);
              setCode("");
            }}
          >
            Use a different email
          </Button>
        </form>
      ) : (
        <form onSubmit={mode === "code" ? sendCode : usePassword}>
          <label className="ui-field">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode === "password" ? (
            <label className="ui-field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          ) : null}
          <Button tone="primary" type="submit" disabled={busy}>
            {mode === "code" ? "Email me a code" : "Sign in"}
          </Button>
          {mode === "code" ? (
            <Button tone="quiet" disabled={busy} onClick={() => setMode("password")}>
              Use a password instead
            </Button>
          ) : (
            <>
              <Button tone="quiet" disabled={busy} onClick={() => void forgot()}>
                Set or reset my password
              </Button>
              <Button tone="quiet" disabled={busy} onClick={() => setMode("code")}>
                Email me a code instead
              </Button>
            </>
          )}
        </form>
      )}
    </Gate>
  );
}

/** The link in the code email: a button, so a mail scanner opening it can't use the code up. */
function EmailLink() {
  const p = new URLSearchParams(location.search);
  const email = p.get("email") ?? "";
  const code = p.get("code") ?? "";
  const { busy, problem, run } = useAction();
  const go = run(async () => {
    await api("sign-in/email-otp", { email, otp: code });
    location.replace(PORTAL);
  });
  return (
    <Gate stamp={STAMP} title={TITLE}>
      {problem ? <Alert>{problem}</Alert> : <p>Signing in as {email}.</p>}
      {problem ? (
        <ButtonLink href="/" tone="secondary">
          Back to sign-in
        </ButtonLink>
      ) : (
        <Button tone="primary" disabled={busy || !email || !code} onClick={() => void go()}>
          Sign in
        </Button>
      )}
    </Gate>
  );
}

function Reset() {
  const p = new URLSearchParams(location.search);
  const token = p.get("error") ? null : p.get("token");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, problem, run } = useAction();
  const save = run(async () => {
    await api("reset-password", { newPassword: password, token });
    setDone(true);
  });

  if (!token || done)
    return (
      <Gate stamp={STAMP} title={done ? "Password set" : "That link has run out"}>
        <p>{done ? "Sign in with it from now on." : "Ask for a new one from the sign-in page."}</p>
        <ButtonLink href="/" tone="primary">
          Sign in
        </ButtonLink>
      </Gate>
    );
  return (
    <Gate stamp={STAMP} title="Set your password">
      {problem ? <Alert>{problem}</Alert> : null}
      <form onSubmit={save}>
        <label className="ui-field">
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
            // biome-ignore lint/a11y/noAutofocus: the one thing to do on this screen.
            autoFocus
          />
        </label>
        <Button tone="primary" type="submit" disabled={busy}>
          Set password
        </Button>
      </form>
    </Gate>
  );
}
