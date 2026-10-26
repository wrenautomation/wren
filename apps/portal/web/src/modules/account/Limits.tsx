/**
 * Daily limits (designs/2026-10-26-limits.md): each research bucket and daily count, what holds
 * now and where it comes from. Wren's team reads them; an admin changes one. On Wren's page every
 * limit, Wren-wide; on a client's, only those a client may have its own of.
 */
import type { LimitsView } from "@wren/core/accounts/console";
import {
  Button,
  DataTable,
  LoadFailed,
  Loading,
  Section,
  SelectField,
  type TableColumn,
  TextField,
  useEditForm,
} from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, NARROW, QUIET, trimmed } from "../work/bits.js";
import { ownerOf, useAccountsAct } from "./Accounts.js";

type Row = LimitsView["limits"][number];
type Limit = { perDay: number; burst: number | null };

const num = (n: number) => n.toLocaleString("en-US");
const limitText = (l: Limit) =>
  l.burst === null ? `${num(l.perDay)} a day` : `${num(l.perDay)} a day, ${num(l.burst)} at once`;
const FROM: Record<Row["from"], string> = {
  default: "Code default",
  wren: "Set Wren-wide",
  client: "Set for this client",
};

const COLUMNS: TableColumn<Row>[] = [
  {
    key: "limit",
    label: "Limit",
    cell: (r) => (
      <>
        <span className="block font-semibold">{r.unit}</span>
        <span className={QUIET}>{r.name}</span>
      </>
    ),
  },
  {
    key: "holds",
    label: "Holds now",
    cell: (r) => (
      <>
        <span className="block">{limitText(r.holds)}</span>
        <span className={QUIET}>{FROM[r.from]}</span>
      </>
    ),
  },
  {
    key: "default",
    label: "Code default",
    className: "hidden sm:table-cell",
    cell: (r) => limitText(r.default),
  },
  { key: "why", label: "Why", className: "hidden md:table-cell", cell: (r) => r.why },
];

function SetLimit({ d, act }: { d: LimitsView; act: ReturnType<typeof useAccountsAct> }) {
  const first = d.limits[0] as Row;
  const form = useEditForm({
    key: null,
    defaults: { name: first.name, perDay: "", burst: "" },
  });
  const name = form.watch("name");
  const row = d.limits.find((r) => r.name === name) ?? first;
  // This page's own row: Wren-wide on Wren's page, the client's on a client's.
  const own = d.wren ? row.wren !== null : row.client !== null;
  const send = (perDay: number | null, burst: number | null) =>
    act.run("setLimit", { name: row.name, perDay, burst });
  const submit = form.onSend(async (f) => {
    const burst = trimmed(f.burst);
    const ok = await send(Number(trimmed(f.perDay) ?? 0), burst ? Number(burst) : null);
    if (ok) form.forget({ name: row.name, perDay: "", burst: "" });
    return ok;
  });
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      aria-label="Change a limit"
      onSubmit={(e) => void submit(e)}
    >
      <SelectField
        form={form}
        name="name"
        label="Limit"
        options={d.limits.map((r) => [r.name, r.unit] as const)}
      />
      <TextField
        form={form}
        name="perDay"
        label={`A day (now ${num(row.holds.perDay)})`}
        className={`${NARROW} basis-[140px]`}
        type="number"
        min={0}
        step={1}
        required
      />
      {row.default.burst !== null ? (
        <TextField
          form={form}
          name="burst"
          label="At once (blank: same share)"
          className={`${NARROW} basis-[180px]`}
          type="number"
          min={1}
          step={1}
        />
      ) : null}
      <Button tone="primary" type="submit" size="dense" busy={act.busy}>
        Save
      </Button>
      {own ? (
        <Button size="dense" busy={act.busy} onClick={() => void send(null, null)}>
          Back to {d.wren ? "the code default" : "Wren-wide"}
        </Button>
      ) : null}
    </form>
  );
}

export function Limits({ client }: { client: string }) {
  const load = useCall(`limits:${client}`, () =>
    call<LimitsView>("accounts/limits", { client: ownerOf(client) }),
  );
  const act = useAccountsAct(client, load.retry);
  const d = load.data;
  if (d && !d.limits.length) return null;
  return (
    <Section title="Daily limits" note="Research's buckets. Each run reads them when it starts.">
      {load.error && !d ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !d ? (
        <Loading lines={4} />
      ) : (
        <>
          <DataTable columns={COLUMNS} data={d.limits} rowKey={(r) => r.name} stack />
          {d.money ? (
            <SetLimit d={d} act={act} />
          ) : (
            <p className={`${QUIET} mt-3`}>Limits are spend: an admin changes them.</p>
          )}
          {act.error ? (
            <p className={`${ERROR} mt-3`} role="alert">
              {act.error}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}
