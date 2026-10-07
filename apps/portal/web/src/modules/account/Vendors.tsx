/**
 * Vendors (designs/2026-10-07-setup-and-vendors.md): each vendor a client's parts read through,
 * on Wren's key (managed) or its own, today's room and the month's use. Wren's team sets the
 * mode, the key, the share and the cap; a client reads the same.
 */
import type { VendorsView } from "@wren/core/accounts/console";
import { Alert, Button, Callout, Input, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { dayLabel, ERROR, FIELD, field, QUIET, SELECT } from "../work/bits.js";
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
      `${used(own, v.units)}${own.micros ? `, billed to them by ${v.name}` : ""}`,
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
  if (v.mode === "own" && v.own === "key") rows.push(["Key", v.keySet ? "Saved" : "Not saved"]);
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
  mayMoney,
  keyStore,
  act,
}: {
  v: VendorRow;
  mayMoney: boolean;
  keyStore: boolean;
  act: Act;
}) {
  const [mode, setMode] = useState<Mode>(v.mode ?? "none");
  const managed = v.offered && mayMoney;
  const save = async (f: FormData) => {
    const body: Record<string, unknown> = { vendor: v.id, mode };
    if (mode === "own" && v.own === "key") body.key = field(f, "key") ?? "";
    if (mode === "managed") {
      body.perDay = Number(field(f, "perDay") ?? 0);
      // A free vendor has no cap: keep what's stored.
      body.capCents = v.free ? v.capCents : Math.round(Number(field(f, "cap") ?? 0) * 100);
    }
    return act.run("setVendor", body);
  };
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      aria-label={`${v.name} mode`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        void save(new FormData(form)).then((ok) => ok && form.reset());
      }}
    >
      <label className={FIELD}>
        <span>Mode</span>
        <select
          className={SELECT}
          value={mode}
          onChange={(e) => setMode(e.currentTarget.value as Mode)}
        >
          <option value="none">Not set up</option>
          {v.own ? (
            <option value="own">{v.own === "login" ? "Their login" : "Their key"}</option>
          ) : null}
          {v.managedDev ? (
            <option value="managed" disabled>
              Managed by Wren (in development)
            </option>
          ) : managed || v.mode === "managed" ? (
            <option value="managed" disabled={!managed}>
              On Wren's key
            </option>
          ) : null}
        </select>
      </label>
      {mode === "own" && v.own === "key" ? (
        keyStore ? (
          <label className={`${FIELD} grow basis-[220px]`}>
            <span>{v.keySet ? "Replace their key" : "Their key"}</span>
            <Input name="key" type="password" autoComplete="off" required maxLength={500} />
          </label>
        ) : (
          <p className={`${QUIET} basis-full`}>Saving their key here is in development.</p>
        )
      ) : null}
      {mode === "managed" && managed ? (
        <>
          {v.quota !== null ? (
            <label className={`${FIELD} basis-[140px]`}>
              <span>Daily share ({v.units})</span>
              <Input name="perDay" type="number" min={0} step={1} defaultValue={v.perDay || ""} />
            </label>
          ) : null}
          {v.free ? null : (
            <label className={`${FIELD} basis-[140px]`}>
              <span>Monthly cap ($)</span>
              <Input
                name="cap"
                type="number"
                min={0}
                step={1}
                defaultValue={v.capCents ? v.capCents / 100 : ""}
              />
            </label>
          )}
        </>
      ) : null}
      <Button
        type="submit"
        size="dense"
        busy={act.busy}
        disabled={mode === "own" && v.own === "key" && !keyStore}
      >
        Save
      </Button>
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
        <SetMode v={v} mayMoney={d.mayMoney} keyStore={d.keyStore} act={act} />
      ) : null}
    </Section>
  );
}

export function Vendors(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`vendors:${props.client}:${props.team}:${nonce}`, () =>
    call<VendorsView>("accounts/vendors", {
      client: ownerOf(props.client),
      asClient: !props.team,
    }),
  );
  const act = useAccountsAct(props.client, () => setNonce((n) => n + 1));
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
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
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
