/**
 * A client's public booking page (`book.html`), served by the portal Worker (`src/book.ts`) on the
 * client's own host or at `/c/<client>` on the app host. No sign-in. `/book/<tag>`: open times
 * on the visitor's clock, then name and email, then the confirmation. `/booking/<token>`: one
 * call, with a new time or a cancel. Every call goes to `<base>/__book/<handler>`.
 */
import "./app.css";
import { Alert, Button, ButtonLink, Icon, type IconName, Input, Loading, Textarea } from "@wren/ui";
import { type FormEvent, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type BookPath,
  bookOrReload,
  bookPath,
  byDay,
  looksLikeEmail,
  Refused,
  zoneOf,
  zones,
} from "./book-path.js";

interface Page {
  /** The client's name. */
  owner: string;
  /** The booker gets the invite and our emails. */
  mails: boolean;
  /** A Google calendar is connected: the call has a Meet link. */
  meet: boolean;
  /** The client's links to message it directly; none = no row. */
  contact?: Contact[];
}
interface Contact {
  kind: "email" | "phone" | "instagram" | "x" | "linkedin";
  label: string;
  href: string;
}
interface Slots extends Page {
  zone: string;
  length: number;
  slots: string[];
  /** Turnstile's site key, when the page asks for the check. */
  human?: string;
}
interface Call {
  id: number;
  state: "booked" | "cancelled";
  start: string;
  end: string;
  title: string;
  offer: string | null;
  meetUrl: string | null;
  open: boolean;
}
type Booked = Call & { manage: string };

const DOWN = "Booking is down for a moment. Try again soon.";

async function ask<T>(base: string, handler: string, body: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}/__book/${handler}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Refused(DOWN, 0);
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !j) throw new Refused(sentence(j?.error) ?? DOWN, res.status);
  return j;
}

/** Restate's refusals are lower case and bare: a sentence for the page. */
function sentence(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
}

const fmt = (iso: string, zone: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, ...o }).format(new Date(iso));
const longWhen = (iso: string, zone: string) =>
  fmt(iso, zone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

const LABEL = "m-0 text-[13px] font-medium text-(--ui-accent)";
const H1 = "m-0 mt-2 text-[28px] leading-tight font-semibold tracking-tight text-(--ui-ink)";
const LEDE = "m-0 mt-2 text-[15px] text-(--ui-ink-2)";

function Shell({ owner, children }: { owner: string | null; children: React.ReactNode }) {
  useEffect(() => {
    if (owner) document.title = `Book a call with ${owner}`;
  }, [owner]);
  return (
    <main className="min-h-dvh bg-(--ui-paper) text-(--ui-ink)">
      <div className="mx-auto grid max-w-[720px] gap-8 px-4 pt-8 pb-16 sm:pt-14">
        <p className="m-0 text-[15px] font-semibold tracking-tight">{owner ?? " "}</p>
        {children}
      </div>
    </main>
  );
}

const ICON: Record<Contact["kind"], IconName> = {
  email: "mail",
  phone: "phone",
  instagram: "external",
  x: "external",
  linkedin: "external",
};
const NAME: Record<Contact["kind"], string> = {
  email: "Email",
  phone: "Phone",
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
};

/** The client's own links: square, one row, wrapping on a phone. */
function ContactLinks({ links }: { links: Contact[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {links.map((l) => {
        const web = l.kind !== "email" && l.kind !== "phone";
        return (
          <li key={l.kind}>
            <a
              href={l.href}
              {...(web ? { target: "_blank", rel: "noopener" } : {})}
              aria-label={`${NAME[l.kind]}: ${l.label}`}
              className="inline-flex h-9 items-center gap-2 border border-(--ui-hair) bg-(--ui-paper) px-3 text-[14px] text-(--ui-ink) no-underline hover:border-(--ui-accent) hover:text-(--ui-accent)"
            >
              <Icon name={ICON[l.kind]} size={14} className="text-(--ui-ink-3)" />
              {web && l.kind !== "linkedin" ? `${NAME[l.kind]} ${l.label}` : l.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Days across the top, that day's times under them, on `zone`'s clock. */
function Picker({
  slots,
  zone,
  setZone,
  pick,
  contact = [],
}: {
  slots: string[];
  zone: string;
  setZone: (z: string) => void;
  pick: (iso: string) => void;
  contact?: Contact[] | undefined;
}) {
  const days = useMemo(() => byDay(slots, zone), [slots, zone]);
  const [day, setDay] = useState("");
  const shown = days.has(day) ? day : (days.keys().next().value ?? "");
  const all = useMemo(() => zones(zone), [zone]);
  const strip = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown day changes
  useEffect(() => {
    strip.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown]);
  return (
    <div className="grid gap-5">
      {days.size === 0 ? null : (
        <label className="flex flex-wrap items-center gap-2 text-[14px] text-(--ui-ink-2)">
          Times in
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="h-9 max-w-full border border-(--ui-hair) bg-(--ui-paper) px-2 text-[14px] text-(--ui-ink)"
          >
            {all.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {days.size === 0 ? (
        <div className="grid gap-4 bg-(--ui-tile) px-4 py-4 sm:px-5">
          <p className="m-0 text-[15px] font-medium text-(--ui-ink)">
            {contact.length
              ? "No open times right now. Message me directly."
              : "No open times right now. Check back soon."}
          </p>
          {contact.length ? <ContactLinks links={contact} /> : null}
        </div>
      ) : (
        <>
          <div
            ref={strip}
            role="tablist"
            aria-label="Day"
            className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
          >
            {[...days].map(([d, list]) => {
              const first = list[0] as string;
              const on = d === shown;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setDay(d)}
                  className={`grid min-w-16 flex-none gap-0.5 border px-3 py-2.5 text-center text-[13px] ${
                    on
                      ? "border-(--ui-accent) bg-(--ui-accent-wash) text-(--ui-accent)"
                      : "border-(--ui-hair) bg-(--ui-paper) text-(--ui-ink) hover:border-(--ui-ink-3)"
                  }`}
                >
                  <span>{fmt(first, zone, { weekday: "short" })}</span>
                  <b className="text-[19px] font-semibold">
                    {fmt(first, zone, { day: "numeric" })}
                  </b>
                  <span>{fmt(first, zone, { month: "short" })}</span>
                </button>
              );
            })}
          </div>
          <div
            aria-live="polite"
            className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
          >
            {(days.get(shown) ?? []).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                className="border border-(--ui-hair) bg-(--ui-paper) px-2 py-3 text-[15px] font-medium text-(--ui-ink) hover:border-(--ui-accent) hover:text-(--ui-accent)"
              >
                {fmt(s, zone, { hour: "numeric", minute: "2-digit" })}
              </button>
            ))}
          </div>
          {contact.length ? (
            <div className="grid gap-2.5 border-t border-(--ui-hair) pt-5">
              <p className="m-0 text-[14px] text-(--ui-ink-2)">Or message me directly</p>
              <ContactLinks links={contact} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Cloudflare's check, when the page asks for it: its token, or null until it passes. */
function useHuman(key: string | undefined, box: React.RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState<string | null>(null);
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !box.current) return;
    const w = window as unknown as {
      turnstile?: {
        render: (el: HTMLElement, o: object) => string;
        reset: (id?: string) => void;
      };
    };
    const draw = () => {
      if (!w.turnstile || !box.current || id.current) return;
      id.current = w.turnstile.render(box.current, {
        sitekey: key,
        size: "flexible",
        theme: "light",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(null),
      });
    };
    if (w.turnstile) draw();
    else if (!document.querySelector("script[data-turnstile]")) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.dataset.turnstile = "";
      s.onload = draw;
      document.head.append(s);
    }
    // The form goes when another time is picked: the next one draws its own.
    return () => {
      id.current = null;
      setToken(null);
    };
  }, [key, box]);
  const reset = () => {
    setToken(null);
    const w = window as unknown as { turnstile?: { reset: (id?: string) => void } };
    if (id.current) w.turnstile?.reset(id.current);
  };
  return { token, reset };
}

function source(): Record<string, string> {
  const q = new URLSearchParams(location.search);
  const out: Record<string, string> = { page: location.pathname.slice(0, 200) };
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"]) {
    const v = q.get(k);
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

function BookPage({ at }: { at: Extract<BookPath, { kind: "book" }> }) {
  const [page, setPage] = useState<Slots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState(() => zoneOf("UTC"));
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Booked | null>(null);
  // Kept across a taken time: the form comes back with what they typed.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const human = useHuman(start ? page?.human : undefined, box);

  const slots = () => ask<Slots>(at.base, "slots", at.tag ? { tag: at.tag } : {});
  const load = async () => {
    try {
      setPage(await slots());
    } catch (err) {
      setError((err as Error).message);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => {
    void load();
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!start) return;
    const f = new FormData(e.currentTarget);
    if (!name.trim()) return setError("Add your name.");
    if (!looksLikeEmail(email)) return setError("That email doesn't look right.");
    if (page?.human && !human.token) return setError("Finish the check below first.");
    setBusy(true);
    setError(null);
    const got = await bookOrReload(
      () =>
        ask<Booked>(at.base, "book", {
          ...(at.tag ? { tag: at.tag } : {}),
          start,
          name: name.trim(),
          email: email.trim(),
          zone,
          website: String(f.get("website") ?? ""),
          ...(human.token ? { human: human.token } : {}),
          source: source(),
        }),
      slots,
    );
    setBusy(false);
    if ("booked" in got) return setDone(got.booked);
    human.reset();
    setError(got.error);
    // Taken: back to fresh times, in place; the name and email stay.
    if (got.slots) {
      setPage(got.slots);
      setStart(null);
    }
  };

  if (!page)
    return (
      <Shell owner={null}>
        {error ? <Alert onRetry={() => void load()}>{error}</Alert> : <Loading lines={6} />}
      </Shell>
    );

  if (done)
    return (
      <Shell owner={page.owner}>
        <section className="grid gap-6">
          <div>
            <p className={LABEL}>Booked</p>
            <h1 className={H1}>You're booked</h1>
            <p className={LEDE}>{longWhen(done.start, zone)}</p>
            <p className={LEDE}>
              {page.mails
                ? page.meet
                  ? "The calendar invite with the Meet link is on its way to your inbox."
                  : "A confirmation is on its way to your inbox."
                : "Keep this page's link to change or cancel."}
            </p>
          </div>
          <p className="m-0">
            <ButtonLink tone="secondary" href={done.manage}>
              Change or cancel
            </ButtonLink>
          </p>
        </section>
      </Shell>
    );

  return (
    <Shell owner={page.owner}>
      <section className="grid gap-6">
        <div>
          <h1 className={H1}>{start ? "Your details" : "Book a call"}</h1>
          <p className={LEDE}>
            A {page.length}-minute call with {page.owner}
            {page.meet ? " on Google Meet" : ""}.
          </p>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {start ? (
          <form onSubmit={submit} noValidate className="grid gap-5">
            <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-(--ui-tile) px-4 py-3 text-[15px]">
              <b className="font-semibold">{longWhen(start, zone)}</b>
              <button
                type="button"
                onClick={() => {
                  setStart(null);
                  setError(null);
                }}
                className="border-0 bg-transparent p-0 text-[14px] text-(--ui-accent) underline underline-offset-4"
              >
                Pick another time
              </button>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[14px] text-(--ui-ink-2)">
                Name
                <Input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10"
                />
              </label>
              <label className="grid gap-1.5 text-[14px] text-(--ui-ink-2)">
                Email
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                />
              </label>
            </div>
            <label aria-hidden="true" className="absolute -left-[9999px]">
              Leave empty
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
            {page.human ? <div ref={box} /> : null}
            <p className="m-0">
              <Button type="submit" busy={busy} disabled={busy} className="max-sm:w-full">
                Book the call
              </Button>
            </p>
          </form>
        ) : (
          <Picker
            slots={page.slots}
            zone={zone}
            setZone={setZone}
            contact={page.contact}
            pick={(s) => {
              setStart(s);
              setError(null);
            }}
          />
        )}
      </section>
    </Shell>
  );
}

function CallPage({ at }: { at: Extract<BookPath, { kind: "booking" }> }) {
  const [call, setCall] = useState<(Call & Page) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"show" | "move" | "cancel">("show");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [zone, setZone] = useState(() => zoneOf("UTC"));

  const loadSlots = async () => {
    try {
      setSlots(await ask<Slots>(at.base, "slots", {}));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const move = () => {
    setStep("move");
    setError(null);
    void loadSlots();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => {
    void (async () => {
      try {
        const got = await ask<Call & Page>(at.base, "booking", { token: at.token });
        setCall(got);
        // The email's links: ?do=move or ?do=cancel opens that step.
        const want = new URLSearchParams(location.search).get("do");
        if (got.open && want === "move") move();
        else if (got.open && want === "cancel") setStep("cancel");
      } catch (err) {
        setError(
          err instanceof Refused && err.status === 404
            ? "This link doesn't work. Use the link in the newest email about your call."
            : (err as Error).message,
        );
      }
    })();
  }, []);

  const run = async (handler: "reschedule" | "cancel", body: object) => {
    setBusy(true);
    setError(null);
    const got = await bookOrReload(
      () => ask<Call>(at.base, handler, { token: at.token, ...body }),
      () => ask<Slots>(at.base, "slots", {}),
    );
    setBusy(false);
    if ("booked" in got) {
      setCall((c) => (c ? { ...c, ...got.booked } : c));
      setStep("show");
      setStart(null);
      return;
    }
    setError(got.error);
    if (got.slots) {
      setSlots(got.slots);
      setStart(null);
    }
  };

  if (!call)
    return <Shell owner={null}>{error ? <Alert>{error}</Alert> : <Loading lines={4} />}</Shell>;

  const state =
    call.state === "cancelled" ? "Cancelled" : call.open ? "Your call" : "This call is over";
  return (
    <Shell owner={call.owner}>
      <section className="grid gap-6">
        <div>
          <p className={LABEL}>{step === "move" ? "New time" : state}</p>
          <h1 className={H1}>{call.title}</h1>
          <p className={LEDE}>{longWhen(call.start, zone)}</p>
          {call.open && call.meetUrl && step === "show" ? (
            <p className={LEDE}>
              <a href={call.meetUrl} target="_blank" rel="noopener" className="text-(--ui-accent)">
                Join on Google Meet
              </a>
            </p>
          ) : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {step === "show" && call.open ? (
          <div className="flex flex-wrap gap-3">
            <Button onClick={move} className="max-sm:w-full">
              Pick a new time
            </Button>
            <Button tone="secondary" onClick={() => setStep("cancel")} className="max-sm:w-full">
              Cancel the call
            </Button>
          </div>
        ) : null}
        {step === "show" && !call.open ? (
          <p className="m-0">
            <ButtonLink href={`${at.base}/book${call.offer ? `/${call.offer}` : ""}`}>
              Book another time
            </ButtonLink>
          </p>
        ) : null}
        {step === "cancel" ? (
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-[14px] text-(--ui-ink-2)">
              Anything they should know? (optional)
              <Textarea
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-24"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button
                busy={busy}
                disabled={busy}
                onClick={() => void run("cancel", reason.trim() ? { reason: reason.trim() } : {})}
                className="max-sm:w-full"
              >
                Cancel the call
              </Button>
              <Button tone="secondary" onClick={() => setStep("show")} className="max-sm:w-full">
                Keep it
              </Button>
            </div>
          </div>
        ) : null}
        {step === "move" ? (
          start ? (
            <div className="grid gap-5">
              <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-(--ui-tile) px-4 py-3 text-[15px]">
                <b className="font-semibold">{longWhen(start, zone)}</b>
                <button
                  type="button"
                  onClick={() => setStart(null)}
                  className="border-0 bg-transparent p-0 text-[14px] text-(--ui-accent) underline underline-offset-4"
                >
                  Pick another time
                </button>
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  busy={busy}
                  disabled={busy}
                  onClick={() => void run("reschedule", { start })}
                  className="max-sm:w-full"
                >
                  Move the call
                </Button>
                <Button tone="secondary" onClick={() => setStep("show")} className="max-sm:w-full">
                  Keep the old time
                </Button>
              </div>
            </div>
          ) : slots ? (
            <Picker
              slots={slots.slots}
              zone={zone}
              setZone={setZone}
              contact={slots.contact}
              pick={setStart}
            />
          ) : (
            <Loading lines={4} />
          )
        ) : null}
      </section>
    </Shell>
  );
}

function BookingApp() {
  const at = bookPath(location.pathname);
  if (!at)
    return (
      <Shell owner={null}>
        <Alert>No booking page here.</Alert>
      </Shell>
    );
  return at.kind === "book" ? <BookPage at={at} /> : <CallPage at={at} />;
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <BookingApp />
    </StrictMode>,
  );
