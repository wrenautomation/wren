/**
 * The Payments head: is the client's Stripe connected, test or live, and does Stripe tell us
 * when a link is paid. An approver connects it here with a key; Wren adds the webhook with it,
 * or the page asks for the endpoint's signing secret. Each is saved alone first (`saveKey`) and
 * the connect call gets its ref. A key is never shown again, only its last 4.
 */
import { Button, Tag, TextField, useEditForm } from "@wren/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { saveKey } from "../../keys.js";

interface Status {
  connected: boolean;
  live: boolean | null;
  webhook: "api" | "pasted" | null;
  url: string;
  keyStore: boolean;
  last4: string | null;
  managed: string;
  approves: boolean;
  /** Links reconcile found disagreeing with Stripe in the last month. */
  drift?: number;
  /** What reconcile found wrong with the webhook's events that it couldn't fix. */
  note?: string | null;
}
interface Connected {
  connected: boolean;
  webhook: "api" | "pasted" | null;
  url?: string;
  why?: string;
}

const LINE = "text-[13px] text-(--ui-ink-2)";

export function StripePanel({ client, reload }: { client: string; reload: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  // Nothing is kept (`key: null`): both boxes are secrets, never stored on the device.
  const form = useEditForm({ key: null, defaults: { key: "", secret: "" } });
  const blank = !form.watch("key").trim() && !form.watch("secret").trim();
  const flying = useRef(false);
  const [said, setSaid] = useState<{ ok: boolean; line: string; url?: string } | null>(null);
  const load = useCallback(
    () =>
      call<Status>("payments/status", { client })
        .then(setS)
        .catch(() => setS(null)),
    [client],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const submit = form.onSend(
    async ({ key, secret }) => {
      if (flying.current || (!key.trim() && !secret.trim())) return false;
      flying.current = true;
      setSaid(null);
      try {
        const keyRef = key.trim() ? (await saveKey(client, "STRIPE_SECRET_KEY", key)).ref : null;
        const secretRef = secret.trim()
          ? (await saveKey(client, "STRIPE_WEBHOOK_SECRET", secret)).ref
          : null;
        const r = await call<Connected>("payments/connect", { client, keyRef, secretRef });
        setSaid(
          r.webhook
            ? { ok: true, line: "Connected. Paid links now show here." }
            : {
                ok: false,
                line: r.why ?? "Connected, but Stripe can't reach us yet.",
                ...(r.url ? { url: r.url } : {}),
              },
        );
        await load();
        reload();
      } catch (err) {
        setSaid({ ok: false, line: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        flying.current = false;
      }
    },
    { clear: true },
  );

  if (!s) return null;
  const mode = s.live === false ? "test mode" : s.live ? "live" : null;
  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <Tag tone={s.connected && s.webhook ? "green" : "warn"} dot>
          {s.connected
            ? `Stripe connected${mode ? `, ${mode}` : ""}${s.last4 ? `, key ending ${s.last4}` : ""}`
            : "Stripe not connected"}
        </Tag>
        {s.connected ? (
          <span className={LINE}>
            {s.webhook
              ? "Stripe tells us when a link is paid or refunded."
              : "Stripe can't tell us about payments yet."}
          </span>
        ) : null}
        {s.drift ? (
          <span className="text-[13px] text-(--ui-bad)">
            {s.drift === 1
              ? "1 link disagrees with Stripe. Its row says why."
              : `${s.drift} links disagree with Stripe. Each row says why.`}
          </span>
        ) : null}
        <span className={LINE}>Managed by Wren: in development.</span>
        {s.approves && s.keyStore ? (
          <Button size="dense" tone="quiet" onClick={() => setOpen((o) => !o)}>
            {s.connected ? "Change Stripe key" : "Connect Stripe"}
          </Button>
        ) : null}
      </div>
      {s.note ? <span className="text-[13px] text-(--ui-bad)">{s.note}</span> : null}
      {!s.keyStore && s.approves ? (
        <span className={LINE}>
          Saving a Stripe key isn't turned on yet. Wren's team can do it.
        </span>
      ) : null}
      {open ? (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex w-full min-w-0 flex-col gap-1.5 sm:max-w-xl"
        >
          <div className="flex min-w-0 flex-wrap gap-2">
            <TextField
              form={form}
              name="key"
              type="password"
              autoComplete="off"
              box="min-w-0 flex-1 basis-48"
              placeholder="Stripe restricted key"
              aria-label="Stripe key"
            />
            <TextField
              form={form}
              name="secret"
              type="password"
              autoComplete="off"
              box="min-w-0 flex-1 basis-48"
              placeholder="Signing secret, if asked"
              aria-label="Webhook signing secret"
            />
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={blank}
            >
              Save
            </Button>
          </div>
          <span className="text-[12px] text-(--ui-ink-3)">
            Give the key write access to Prices, Payment Links and Webhook Endpoints, and read
            access to Checkout Sessions, Payment Intents, Charges and Disputes. We never show it
            again.
          </span>
        </form>
      ) : null}
      {said ? (
        <span className={`text-[13px] ${said.ok ? "text-(--ui-ink-2)" : "text-(--ui-bad)"}`}>
          {said.line}
          {said.url ? <code className="ml-1 break-all">{said.url}</code> : null}
        </span>
      ) : null}
    </div>
  );
}
