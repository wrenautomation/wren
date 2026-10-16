/**
 * Vendors (designs/2026-10-07-setup-and-vendors.md): each vendor a client's parts read through,
 * on Wren's key (managed) or its own, today's room and the month's use. Wren's team sets the
 * mode, the key, the share and the cap; a client reads the same. A key is saved alone first
 * (`saveKey`) and setVendor gets its ref; the page shows only its last 4.
 */
import type { VendorsView } from "@wren/core/accounts/console";
import {
  Button,
  Callout,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  SelectField,
  Tag,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useRef, useState } from "react";
import { call } from "../../api.js";
import { saveKey } from "../../keys.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { dayLabel, ERROR, NARROW, QUIET, trimmed } from "../work/bits.js";
import { ownerOf, useAccountsAct } from "./Accounts.js";
import { dollars, modeTag, roomText, unitsText, type VendorRow } from "./setups.js";

type Act = ReturnType<typeof useAccountsAct>;
const UNSET = "Not set, so nothing runs";
type Mode = "managed" | "own" | "none";

const DL = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[14px]";

/** A month's use: "1,233 searches, about $8.63". */
const used = (m: { units: number; micros: number }, units: string) =>
  `${unitsText(m.units, units)}${m.micros ? `, about ${dollars(m.micros)}` : ""}`;

function Facts({ v, wren }: { v: VendorRow; wren: boolean }) {
  const { managed, own } = v.month;
  const rows: [string, string][] = [
    ["Price", `${v.price.charAt(0).toUpperCase()}${v.price.slice(1)}, as of ${dayLabel(v.asOf)}`],
    ["Today", roomText(v)],
  ];
  // Wren's key is what Wren pays; their own key's use is billed to them by the vendor.
  if (managed.units || !own.units) rows.push(["This month", used(managed, v.units)]);
  if (own.units)
    rows.push([
      managed.units ? "On their key" : "This month",
      `${used(own, v.units)}${own.micros ? ", paid on their key" : ""}`,
    ]);
  if (v.mode === "managed" && !wren) {
    // A vendor with no read limit stops on money alone: no share to set.
    if (v.quota !== null)
      rows.push(["Daily share", v.perDay ? unitsText(v.perDay, v.units) : UNSET]);
    // A free vendor costs nothing: its share bounds it, no cap.
    if (!v.free)
      rows.push([
        "Monthly cap",
        v.capped && v.capCents ? v.capped : v.capCents ? dollars(v.capCents * 10_000) : UNSET,
      ]);
  }
  if (v.mode === "own" && v.own === "key")
    rows.push([
      "Key",
      v.keySet ? (v.keyLast4 ? `Saved, ending ${v.keyLast4}` : "Saved") : "Not saved",
    ]);
  return (
    <dl className={DL}>
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="text-(--ui-ink-2)">{k}</dt>
          <dd className="min-w-0 break-words">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

function SetMode({
  v,
  client,
  mayMoney,
  keyStore,
  act,
}: {
  v: VendorRow;
  client: string;
  mayMoney: boolean;
  keyStore: boolean;
  act: Act;
}) {
  const [keyError, setKeyError] = useState<string | null>(null);
  // Nothing is kept (`key: null`): the form holds their API key, and the edits store is browser
  // storage. The mode, share and cap start from what is saved.
  const form = useEditForm({
    key: null,
    defaults: {
      mode: v.mode ?? "none",
      key: "",
      publicKey: "",
      perDay: v.perDay ? String(v.perDay) : "",
      cap: v.capCents ? String(v.capCents / 100) : "",
    },
  });
  const mode = form.watch("mode") as Mode;
  const managed = v.offered && mayMoney;
  const perDayShown = mode === "managed" && managed && v.quota !== null;
  const capShown = mode === "managed" && managed && !v.free;
  const landed = useRef(false);
  const submit = form.onSend(async (f) => {
    landed.current = false;
    const body: Record<string, unknown> = { vendor: v.id, mode: f.mode };
    if (mode === "own" && v.own === "key" && v.keyName) {
      setKeyError(null);
      try {
        body.keyRef = (await saveKey(client, v.keyName, trimmed(f.key) ?? "")).ref;
        // Telnyx signs a client's webhooks with its own account's public key: saved beside it.
        if (v.publicKeyName)
          body.publicKeyRef = (
            await saveKey(client, v.publicKeyName, trimmed(f.publicKey) ?? "")
          ).ref;
      } catch (err) {
        setKeyError(err instanceof Error ? err.message : String(err));
        return false;
      }
    }
    if (mode === "managed") {
      body.perDay = perDayShown ? Number(trimmed(f.perDay) ?? 0) : 0;
      // A free vendor has no cap: keep what's stored.
      body.capCents = v.free
        ? v.capCents
        : capShown
          ? Math.round(Number(trimmed(f.cap) ?? 0) * 100)
          : 0;
    }
    landed.current = await act.run("setVendor", body);
    return landed.current;
  });
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      aria-label={`${v.name} mode`}
      onSubmit={(e) =>
        // The key and public key are not kept after a save: the form starts them blank again.
        void submit(e).then(() => {
          if (landed.current) form.forget({ ...form.getValues(), key: "", publicKey: "" });
        })
      }
    >
      <SelectField
        form={form}
        name="mode"
        label="Mode"
        options={[
          ["none", "Not set up"],
          ...(v.own ? [["own", v.own === "login" ? "Their login" : "Their key"] as const] : []),
          ...(v.managedDev
            ? [["managed", "Managed by Wren (in development)", true] as const]
            : managed || v.mode === "managed"
              ? [["managed", "On Wren's key", !managed] as const]
              : []),
        ]}
      />
      {mode === "own" && v.own === "key" ? (
        keyStore ? (
          <>
            <TextField
              form={form}
              name="key"
              label={v.keySet ? "Replace their key" : "Their key"}
              className={`${NARROW} grow basis-[220px]`}
              type="password"
              autoComplete="off"
              required
              maxLength={4096}
            />
            {v.publicKeyName ? (
              <TextField
                form={form}
                name="publicKey"
                label="Their public key (Account → Public Key)"
                className={`${NARROW} grow basis-[220px]`}
                autoComplete="off"
                required
                maxLength={64}
              />
            ) : null}
          </>
        ) : (
          <p className={`${QUIET} basis-full`}>Saving their key isn't turned on yet.</p>
        )
      ) : null}
      {perDayShown ? (
        <TextField
          form={form}
          name="perDay"
          label={`Daily share (${v.units})`}
          className={`${NARROW} basis-[140px]`}
          type="number"
          min={0}
          step={1}
        />
      ) : null}
      {capShown ? (
        <TextField
          form={form}
          name="cap"
          label="Monthly cap ($)"
          className={`${NARROW} basis-[140px]`}
          type="number"
          min={0}
          step={1}
        />
      ) : null}
      <Button
        tone="primary"
        type="submit"
        size="dense"
        busy={act.busy}
        disabled={mode === "own" && v.own === "key" && !keyStore}
      >
        Save
      </Button>
      {keyError ? <p className={`${ERROR} basis-full`}>{keyError}</p> : null}
    </form>
  );
}

function Vendor({ v, d, act }: { v: VendorRow; d: VendorsView; act: Act }) {
  const wren = d.owner.id === null;
  const tag = modeTag(v, wren);
  return (
    <Section
      title={v.name}
      note={
        v.url ? (
          <a className="underline underline-offset-2" href={v.url} target="_blank" rel="noreferrer">
            Pricing
          </a>
        ) : undefined
      }
      actions={<Tag tone={tag.tone}>{tag.label}</Tag>}
    >
      <Facts v={v} wren={wren} />
      {!wren && v.mode === "managed" && !v.offered ? (
        <p className={`${QUIET} mt-3`}>Not offered on Wren's key to clients any more.</p>
      ) : null}
      {d.team && !wren ? (
        <SetMode
          v={v}
          client={d.owner.id ?? ""}
          mayMoney={d.mayMoney}
          keyStore={d.keyStore}
          act={act}
        />
      ) : null}
    </Section>
  );
}

export function Vendors(props: PageProps) {
  const load = useCall(`vendors:${props.client}:${props.team}`, () =>
    call<VendorsView>("accounts/vendors", {
      client: ownerOf(props.client),
      asClient: !props.team,
    }),
  );
  const act = useAccountsAct(props.client, load.retry);
  const d = load.data;
  return (
    <>
      <PageHeader
        title="Vendors"
        lede={
          d?.owner.id === null
            ? "Wren runs on its own key everywhere. What each vendor has left today and this month."
            : d?.team
              ? "Each vendor their parts read through: on our key, on theirs, or not set up yet."
              : "Each service your parts read through, on Wren's key or your own, and this month's use."
        }
      />
      {load.error && !d ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !d ? (
        <Loading lines={4} />
      ) : (
        <>
          {d.team && !d.mayMoney && d.owner.id !== null ? (
            <Callout>Shares and caps on Wren's key are money: an admin sets them.</Callout>
          ) : null}
          {act.error ? (
            <p className={ERROR} role="alert">
              {act.error}
            </p>
          ) : null}
          {d.vendors.map((v) => (
            <Vendor key={v.id} v={v} d={d} act={act} />
          ))}
        </>
      )}
    </>
  );
}
