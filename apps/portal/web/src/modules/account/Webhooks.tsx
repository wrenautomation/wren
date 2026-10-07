/**
 * Webhooks (designs/2026-10-07-webhooks-out.md): the client's own URLs that hear events as they
 * happen, each signed. A secret shows once, on add and on rotate. The log keeps every try; a
 * finished delivery goes again on Redeliver.
 */
import { Alert, Button, cx, Empty, Input, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FIELD, QUIET, TOOLS } from "../work/bits.js";

interface Hook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  by: string;
  at: string;
  rotatedAt: string | null;
  prevUntil: string | null;
}
interface Delivery {
  id: string;
  subscription: string;
  event: string;
  eventId: string;
  state: "pending" | "delivered" | "failed";
  attempts: number;
  status: number | null;
  latencyMs: number | null;
  response: string | null;
  error: string | null;
  at: string;
  lastAt: string | null;
}
interface Try {
  n: number;
  status: number | null;
  latencyMs: number | null;
  response: string | null;
  error: string | null;
  at: string;
}
interface Hooks {
  webhooks: Hook[];
  deliveries: Delivery[];
  events: { id: string; says: string }[];
  canManage: boolean;
}

const STATE = {
  pending: { label: "Sending", tone: "neutral" },
  delivered: { label: "Delivered", tone: "green" },
  failed: { label: "Failed", tone: "warn" },
} as const;
const PRE =
  "m-0 max-h-[220px] overflow-auto border border-(--ui-hair) bg-(--ui-tile) p-2.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-all";
const at = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const answerOf = (d: { status: number | null; latencyMs: number | null; error: string | null }) =>
  d.status
    ? `${d.status}${d.latencyMs === null ? "" : `, ${d.latencyMs} ms`}`
    : (d.error ?? "No answer");

/** One call to `delivery/<route>`, its answer back, and the error to show. */
function useRun(props: PageProps, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const got = await call<T>(`delivery/${route}`, { client: props.client, ...body });
      reload();
      return got;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Secret({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2 border border-(--ui-accent) bg-(--ui-tile) p-3" role="status">
      <p className="m-0 font-medium">Copy this secret now. It won't show again.</p>
      <code className="break-all text-[13px]">{secret}</code>
      <div className={TOOLS}>
        <Button
          size="sm"
          onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" tone="quiet" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function Webhooks(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`webhooks:${props.client}:${props.team}:${nonce}`, () =>
    call<Hooks>("delivery/webhooks", { client: props.client, asClient: !props.team }),
  );
  const act = useRun(props, () => setNonce((n) => n + 1));
  const [secret, setSecret] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const data = load.data;
  const nameOf = (id: string) => data?.webhooks.find((h) => h.id === id)?.name ?? "Removed";
  const says = (id: string) => data?.events.find((e) => e.id === id)?.says ?? id;

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const url = String(f.get("url") ?? "").trim();
    const got = await act.run<{ secret: string }>("webhookAdd", {
      name: String(f.get("name") ?? "").trim() || hostOf(url),
      url,
      events: f.getAll("events").map(String),
    });
    if (got) {
      setSecret(got.secret);
      form.reset();
    }
  };
  const test = async (h: Hook) => {
    const got = await act.run<Delivery>("webhookTest", { id: h.id });
    if (got)
      setTested((t) => ({
        ...t,
        [h.id]: `${got.state === "delivered" ? "It answered" : "It failed"}: ${answerOf(got)}`,
      }));
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        lede="Send events to your own tools as they happen. Each request is signed, so your tool can check it came from us."
      />
      {secret ? <Secret secret={secret} onClose={() => setSecret(null)} /> : null}
      <Section>
        {load.error && !data ? (
          <Alert onRetry={load.retry}>{load.error.message}</Alert>
        ) : !data ? (
          <Loading lines={3} />
        ) : data.webhooks.length === 0 ? (
          <Empty>No webhooks yet.</Empty>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0">
            {data.webhooks.map((h) => (
              <li key={h.id} className="grid gap-2 border-b border-(--ui-hair) pb-4">
                <p className="m-0 flex flex-wrap items-center gap-2">
                  <b>{h.name}</b>
                  <Tag tone={h.active ? "green" : "neutral"}>{h.active ? "On" : "Off"}</Tag>
                </p>
                <code className="break-all text-[13px]">{h.url}</code>
                <p className={cx("m-0 text-[13px]", QUIET)}>
                  Hears {h.events.map(says).join(", ")}
                  {h.prevUntil ? `. The old secret also signs until ${at(h.prevUntil)}` : ""}
                </p>
                {tested[h.id] ? <p className="m-0 text-[13px]">{tested[h.id]}</p> : null}
                {data.canManage ? (
                  <div className={TOOLS}>
                    <Button size="sm" tone="secondary" busy={act.busy} onClick={() => void test(h)}>
                      Send test
                    </Button>
                    <Button
                      size="sm"
                      tone="quiet"
                      disabled={act.busy}
                      onClick={() => void act.run("webhookEdit", { id: h.id, active: !h.active })}
                    >
                      {h.active ? "Turn off" : "Turn on"}
                    </Button>
                    <Button
                      size="sm"
                      tone="quiet"
                      disabled={act.busy}
                      onClick={async () => {
                        if (!confirm("Make a new secret? The old one keeps working for 24 hours."))
                          return;
                        const got = await act.run<{ secret: string }>("webhookRotate", {
                          id: h.id,
                        });
                        if (got) setSecret(got.secret);
                      }}
                    >
                      New secret
                    </Button>
                    <Button
                      size="sm"
                      tone="quiet"
                      disabled={act.busy}
                      onClick={() => {
                        if (confirm(`Remove ${h.name}? Its log goes too.`))
                          void act.run("webhookRemove", { id: h.id });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {act.error ? (
          <p className={ERROR} role="alert">
            {act.error}
          </p>
        ) : null}
      </Section>

      {data?.canManage ? (
        <Section title="Add a webhook" note="An https URL on the public internet.">
          <form className="grid gap-3" aria-label="Add a webhook" onSubmit={(e) => void add(e)}>
            <div className="flex flex-wrap gap-3">
              <label className={`${FIELD} grow basis-[320px]`}>
                <span>URL</span>
                <Input
                  name="url"
                  type="url"
                  required
                  maxLength={2000}
                  placeholder="https://hooks.yourtool.com/in"
                />
              </label>
              <label className={`${FIELD} grow basis-[200px]`}>
                <span>Name</span>
                <Input name="name" maxLength={80} placeholder="CRM" />
              </label>
            </div>
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className="mb-1 text-[13px] font-medium">Events</legend>
              {data.events.map((e) => (
                <label key={e.id} className="flex items-baseline gap-2 text-[13.5px]">
                  <input type="checkbox" name="events" value={e.id} />
                  <span>
                    {e.says} <code className={cx("text-[12px]", QUIET)}>{e.id}</code>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" size="dense" busy={act.busy}>
                Add
              </Button>
            </div>
          </form>
        </Section>
      ) : data && !data.canManage && data.webhooks.length === 0 ? (
        <p className={QUIET}>Ask an owner to add a webhook.</p>
      ) : null}

      {data?.webhooks.length ? (
        <Section title="Deliveries" note="The newest 50. A failed one is tried 7 times over a day.">
          {data.deliveries.length === 0 ? (
            <Empty>Nothing sent yet.</Empty>
          ) : (
            <ul className="m-0 grid list-none border-t border-(--ui-hair) p-0">
              {data.deliveries.map((d) => (
                <li key={d.id} className="border-b border-(--ui-hair)">
                  <button
                    type="button"
                    aria-expanded={open === d.id}
                    onClick={() => setOpen(open === d.id ? null : d.id)}
                    className="grid w-full cursor-pointer gap-0.5 bg-transparent px-1 py-2 text-left text-[13.5px] text-(--ui-ink) hover:bg-(--ui-hover)"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{d.event}</span>
                      <Tag tone={STATE[d.state].tone}>{STATE[d.state].label}</Tag>
                    </span>
                    <span
                      className={cx("flex flex-wrap justify-between gap-2 text-[12.5px]", QUIET)}
                    >
                      <span>
                        {nameOf(d.subscription)} · {answerOf(d)} · {d.attempts}{" "}
                        {d.attempts === 1 ? "try" : "tries"}
                      </span>
                      <span className="tabular-nums">{at(d.at)}</span>
                    </span>
                  </button>
                  {open === d.id ? (
                    <OneDelivery
                      id={d.id}
                      canManage={data.canManage}
                      props={props}
                      onSent={() => setNonce((n) => n + 1)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Check the signature">
        <p className={cx("m-0 text-[13.5px]", QUIET)}>
          Each request carries <code>webhook-id</code>, <code>webhook-timestamp</code> and{" "}
          <code>webhook-signature</code>. Any Standard Webhooks library checks them with your
          secret. Turn away a timestamp more than 5 minutes old, and use the id to skip repeats.
        </p>
      </Section>
    </>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "Webhook";
  }
};

/** One delivery: the body as signed, and each try's answer. */
function OneDelivery({
  id,
  canManage,
  props,
  onSent,
}: {
  id: string;
  canManage: boolean;
  props: PageProps;
  onSent: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const got = useCall(`webhook:${id}:${nonce}`, () =>
    call<Delivery & { payload: unknown; tries: Try[] }>("delivery/webhookDelivery", {
      client: props.client,
      asClient: !props.team,
      id,
    }),
  );
  const act = useRun(props, () => {
    setNonce((n) => n + 1);
    onSent();
  });
  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!got.data) return <Loading lines={2} />;
  const d = got.data;
  return (
    <div className="grid gap-3 px-1 pb-3">
      <ol className="m-0 grid list-none gap-1 p-0 text-[13px]">
        {d.tries.map((t) => (
          <li key={t.n} className="grid gap-1">
            <span>
              Try {t.n} at {at(t.at)}: {answerOf(t)}
            </span>
            {t.response ? <pre className={PRE}>{t.response}</pre> : null}
          </li>
        ))}
      </ol>
      <div className="grid gap-1">
        <span className={cx("text-[12px] font-medium", QUIET)}>Body sent, id {d.eventId}</span>
        <pre className={PRE}>{JSON.stringify(d.payload, null, 2)}</pre>
      </div>
      {canManage && d.state !== "pending" ? (
        <div className={TOOLS}>
          <Button
            size="sm"
            tone="secondary"
            busy={act.busy}
            onClick={() => void act.run("webhookRedeliver", { id })}
          >
            Redeliver
          </Button>
          {act.error ? <span className={ERROR}>{act.error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
