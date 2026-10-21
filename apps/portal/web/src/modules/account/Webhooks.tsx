/**
 * Webhooks (designs/2026-10-07-webhooks-out.md): the client's own URLs that hear events as they
 * happen, each signed. A secret shows once, on add and on rotate. The log keeps every try; a
 * finished delivery goes again on Redeliver. A failed try waiting on the next shows when that
 * runs, and a URL that fails for 5 days is turned off until someone turns it back on.
 */
import {
  ACTIONS,
  Button,
  ChecksField,
  CopyButton,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  Tag,
  TextField,
  tipProps,
  useEditForm,
  useNarrow,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PageRows, RowDoes, rowLines, useGoing } from "../../page-rows.js";
import { ERROR, QUIET, TOOLS } from "../work/bits.js";

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
  failingSince: string | null;
  disabledAt: string | null;
  disabledWhy: string | null;
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
  nextAt: string | null;
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
  retrying: { label: "Retrying", tone: "warn" },
} as const;
/** A pending delivery with a next try set failed its last one and waits on the ladder. */
const stateOf = (d: Delivery) => (d.state === "pending" && d.nextAt ? "retrying" : d.state);
/** Matches `DISABLE_AFTER_DAYS` in packages/core/src/webhooks.ts. */
const OFF_AFTER_DAYS = 5;
const hookTag = (h: Hook) =>
  h.disabledAt ? (
    <Tag tone="warn">Turned off</Tag>
  ) : (
    <Tag tone={h.active ? "green" : "neutral"}>{h.active ? "On" : "Off"}</Tag>
  );
/** What a hook's row says under it: why it is off, that it fails, a test's answer. */
const notes = (h: Hook, tested: string | undefined) =>
  h.disabledAt || (h.active && h.failingSince) || tested ? (
    <div className="grid gap-1 text-[13px]">
      {h.disabledAt ? (
        <p className="m-0" role="status">
          Turned off {at(h.disabledAt)}. {h.disabledWhy} Nothing is sent until it's turned back on.
        </p>
      ) : h.active && h.failingSince ? (
        <p className="m-0">
          Failing since {at(h.failingSince)}. It turns off after {OFF_AFTER_DAYS} days of failures.
        </p>
      ) : null}
      {h.prevUntil ? (
        <p className={cx("m-0", QUIET)}>The old secret also signs until {at(h.prevUntil)}.</p>
      ) : null}
      {tested ? <p className="m-0">{tested}</p> : null}
    </div>
  ) : null;
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

/** A new webhook's fields, blank. */
const NEW_HOOK = { url: "", name: "", events: [] as string[] };
const NEW_HOOK_SCHEMA = z.object({
  url: z.string().trim().min(1, "Paste the URL."),
  name: z.string(),
  events: z.array(z.string()),
});

/** One call to `delivery/<route>`, its answer back, and the error to show. */
function useRun(props: PageProps, reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One write at a time; a second press of the same one is one action (its request id).
  const flying = useRef(false);
  const run = async <T,>(route: string, body: Record<string, unknown>): Promise<T | null> => {
    if (flying.current) return null;
    flying.current = true;
    setBusy(true);
    setError(null);
    try {
      const got = await ACTIONS.run(
        `delivery/${route}:${props.client}:${JSON.stringify(body)}`,
        (requestId) => call<T>(`delivery/${route}`, { client: props.client, ...body, requestId }),
      );
      reload();
      return got;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** A secret or token that shows once, with Copy. */
export function Secret({
  secret,
  onClose,
  what = "secret",
}: {
  secret: string;
  onClose: () => void;
  what?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  // It shows once: bring it into view from wherever Add or New secret was pressed.
  useEffect(() => box.current?.scrollIntoView({ block: "center" }), []);
  return (
    <div
      ref={box}
      className="mb-4 grid gap-2 border border-(--ui-live) bg-(--ui-tile) p-3"
      role="status"
    >
      <p className="m-0 font-medium">Copy this {what} now. It won't show again.</p>
      <code className="break-all text-[13px]">{secret}</code>
      <div className={TOOLS}>
        <CopyButton text={secret} tone="primary" />
        <Button size="sm" tone="quiet" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function Webhooks(props: PageProps) {
  const load = useCall(`webhooks:${props.client}:${props.team}`, () =>
    call<Hooks>("delivery/webhooks", { client: props.client, asClient: !props.team }),
  );
  const act = useRun(props, load.retry);
  const narrow = useNarrow();
  const going = useGoing();
  const [secret, setSecret] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const data = load.data;
  const nameOf = (id: string) => data?.webhooks.find((h) => h.id === id)?.name ?? "Removed";
  const says = (id: string) => data?.events.find((e) => e.id === id)?.says ?? id;

  const form = useEditForm({
    key: `webhook:new:${props.client}`,
    defaults: NEW_HOOK,
    schema: NEW_HOOK_SCHEMA,
  });
  const add = form.onSend(
    async (v) => {
      const url = v.url.trim();
      const got = await act.run<{ secret: string }>("webhookAdd", {
        name: v.name.trim() || hostOf(url),
        url,
        events: v.events,
      });
      if (!got) return false;
      setSecret(got.secret);
    },
    { clear: true },
  );
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
      {secret ? <Secret key={secret} secret={secret} onClose={() => setSecret(null)} /> : null}
      <Section>
        {load.error && !data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !data ? (
          <Loading lines={3} />
        ) : data.webhooks.length === 0 ? (
          <Empty>No webhooks yet.</Empty>
        ) : (
          <PageRows<Hook>
            label="Webhooks"
            noun="webhook"
            lines={rowLines(
              data.webhooks,
              (h) => h.id,
              (h) => notes(h, tested[h.id]),
            )}
            rowState={(h) => going.stateOf(h.id)}
            name={{
              label: "Webhook",
              icon: "link",
              min: 260,
              title: (h) => h.name,
              sub: (h) => <code className="truncate text-[12.5px] text-(--ui-ink-3)">{h.url}</code>,
            }}
            columns={[
              {
                key: "state",
                label: "State",
                icon: "pulse",
                width: 130,
                phone: true,
                cell: (h) => hookTag(h),
              },
              {
                key: "events",
                label: "Hears",
                icon: "bolt",
                min: 220,
                className: "max-[1000px]:hidden",
                cell: (h) =>
                  h.events.map((e, i) => (
                    <span key={e} {...tipProps(says(e))}>
                      {i ? ", " : ""}
                      <code className="text-[12px]">{e}</code>
                    </span>
                  )),
              },
            ]}
            end={
              data.canManage
                ? (h) => (
                    <RowDoes
                      title={h.name}
                      lone={narrow}
                      busy={act.busy}
                      does={[
                        {
                          id: "test",
                          label: "Send test",
                          run: () => going.go(h.id, "Testing", () => test(h)),
                        },
                        {
                          id: "toggle",
                          label: h.active ? "Turn off" : h.disabledAt ? "Turn back on" : "Turn on",
                          run: () =>
                            going.go(h.id, h.active ? "Turning off" : "Turning on", () =>
                              act.run("webhookEdit", { id: h.id, active: !h.active }),
                            ),
                        },
                        {
                          id: "rotate",
                          label: "New secret",
                          confirm: "Make a new secret? The old one keeps working for 24 hours.",
                          run: () =>
                            going.go(h.id, "Making a secret", async () => {
                              const got = await act.run<{ secret: string }>("webhookRotate", {
                                id: h.id,
                              });
                              if (got) setSecret(got.secret);
                            }),
                        },
                        {
                          id: "remove",
                          label: "Remove",
                          confirm: `Remove ${h.name}? Its log goes too.`,
                          run: () =>
                            going.go(h.id, "Removing", () =>
                              act.run("webhookRemove", { id: h.id }),
                            ),
                        },
                      ]}
                    />
                  )
                : undefined
            }
          />
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
              <TextField
                form={form}
                name="url"
                label="URL"
                type="url"
                required
                maxLength={2000}
                placeholder="https://hooks.yourtool.com/in"
                className="grow basis-[320px]"
              />
              <TextField
                form={form}
                name="name"
                label="Name"
                maxLength={80}
                placeholder="CRM"
                className="grow basis-[200px]"
              />
            </div>
            <ChecksField
              form={form}
              name="events"
              label="Events"
              options={data.events.map((e) => [
                e.id,
                <>
                  {e.says} <code className={cx("text-[12px]", QUIET)}>{e.id}</code>
                </>,
              ])}
            />
            <div>
              <Button tone="primary" type="submit" size="dense" busy={act.busy}>
                Add
              </Button>
            </div>
          </form>
        </Section>
      ) : data && !data.canManage && data.webhooks.length === 0 ? (
        <p className={QUIET}>Ask an owner to add a webhook.</p>
      ) : null}

      {data?.webhooks.length ? (
        <Section
          title="Deliveries"
          note={`The newest 50. A failed one is tried 7 times over a day. A URL that fails for ${OFF_AFTER_DAYS} days is turned off.`}
        >
          {data.deliveries.length === 0 ? (
            <Empty>Nothing sent yet.</Empty>
          ) : (
            <PageRows<Delivery>
              label="Deliveries"
              noun="delivery"
              lines={rowLines(
                data.deliveries,
                (d) => d.id,
                (d) =>
                  open === d.id ? (
                    <OneDelivery
                      id={d.id}
                      canManage={data.canManage}
                      props={props}
                      onSent={load.retry}
                    />
                  ) : null,
              )}
              open={{ id: open, onOpen: (d) => setOpen(open === d.id ? null : d.id) }}
              name={{
                label: "Event",
                icon: "bolt",
                min: 220,
                title: (d) => d.event,
                sub: (d) => (
                  <span className="truncate text-[12.5px] text-(--ui-ink-3)">
                    {nameOf(d.subscription)}
                  </span>
                ),
              }}
              columns={[
                {
                  key: "state",
                  label: "State",
                  icon: "pulse",
                  width: 120,
                  phone: true,
                  cell: (d) => <Tag tone={STATE[stateOf(d)].tone}>{STATE[stateOf(d)].label}</Tag>,
                },
                {
                  key: "answer",
                  label: "Answer",
                  icon: "chat",
                  min: 220,
                  className: "max-[1000px]:hidden",
                  cell: (d) =>
                    `${answerOf(d)} · ${d.attempts} ${d.attempts === 1 ? "try" : "tries"}${
                      stateOf(d) === "retrying" && d.nextAt ? ` · retrying at ${at(d.nextAt)}` : ""
                    }`,
                },
                {
                  key: "at",
                  label: "Sent",
                  icon: "clock",
                  width: 150,
                  quiet: true,
                  className: "max-[900px]:hidden",
                  cell: (d) => at(d.at),
                },
              ]}
            />
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
  const got = useCall(`webhook:${id}`, () =>
    call<Delivery & { payload: unknown; tries: Try[] }>("delivery/webhookDelivery", {
      client: props.client,
      asClient: !props.team,
      id,
    }),
  );
  const act = useRun(props, () => {
    got.retry();
    onSent();
  });
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
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
