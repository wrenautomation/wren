/**
 * Agents → Decisions (designs/2026-10-16-decide.md): per kind, how often the machine's call matched
 * William's, how often he overrode a pick he saw, and what it cost. A kind moves to Gate only on
 * his yes; the table says when one qualifies.
 */
import type { KindStats } from "@wren/core/decide";
import { cx, DataTable, type TableColumn, Tag, type TagTone } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, QUIET } from "../work/bits.js";

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const MODE: Record<KindStats["mode"], { label: string; tone: TagTone }> = {
  off: { label: "Off", tone: "neutral" },
  shadow: { label: "Shadow", tone: "neutral" },
  recommend: { label: "Recommend", tone: "accent" },
  gate: { label: "Gate", tone: "green" },
};
const COLUMNS: TableColumn<KindStats>[] = [
  { key: "kind", label: "Kind", cell: (r) => <span className="font-medium">{r.name}</span> },
  {
    key: "mode",
    label: "Mode",
    cell: (r) => <Tag tone={MODE[r.mode].tone}>{MODE[r.mode].label}</Tag>,
  },
  { key: "calls", label: "Your calls", cell: (r) => r.calls },
  {
    key: "agree",
    label: "Agree",
    cell: (r) => (
      <span title={`${r.agreed} of ${r.judged}`}>
        {pct(r.rate)}
        {r.judged ? <span className={QUIET}> of {r.judged}</span> : null}
      </span>
    ),
  },
  { key: "overrides", label: "Overrides", cell: (r) => r.overrides },
  {
    key: "asked",
    label: "Asked",
    cell: (r) => (
      <>
        {r.decisions}
        {r.failed ? <span className={QUIET}> ({r.failed} failed)</span> : null}
      </>
    ),
  },
  { key: "tokens", label: "Tokens", cell: (r) => r.inputTokens.toLocaleString() },
  { key: "spent", label: "Spent", cell: (r) => usd(r.usd) },
  { key: "today", label: "Today", cell: (r) => usd(r.usdToday) },
];

export function Decisions() {
  const got = useCall("agents:decisions", () => call<KindStats[]>("console/decisions", {}));
  const rows = got.data;
  if (got.error && !rows) return <p className={ERROR}>{got.error.message}</p>;
  if (!rows) return <p className={QUIET}>Reading…</p>;
  return (
    <section className="mb-10 grid gap-2 text-[13.5px]">
      <h2 className="m-0 text-[15px] font-medium">Decisions</h2>
      <p className={cx("m-0", QUIET)}>
        Jev's call on each draft and item, next to yours. Agree counts send or keep against drop or
        skip.
      </p>
      <DataTable columns={COLUMNS} data={rows} rowKey={(r) => r.kind} />
      {rows.some((r) => r.gateReady) ? (
        <p className="m-0">
          {rows
            .filter((r) => r.gateReady)
            .map((r) => r.name)
            .join(", ")}{" "}
          agree with you often enough to filter what you see. That waits on your yes.
        </p>
      ) : (
        <p className={cx("m-0", QUIET)}>
          A kind can filter what you see once it agrees on 95% of at least 200 of your calls, and
          you say yes.
        </p>
      )}
    </section>
  );
}
