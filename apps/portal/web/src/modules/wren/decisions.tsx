/**
 * Agents → Decisions (designs/2026-10-16-decide.md): per kind, how often the machine's call matched
 * William's, how often he overrode a pick he saw, and what it cost. A kind moves to Gate only on
 * his yes; the table says when one qualifies.
 */
import type { KindStats } from "@wren/core/decide";
import { cx, Tag, type TagTone } from "@wren/ui";
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
const HEAD = [
  "Kind",
  "Mode",
  "Your calls",
  "Agree",
  "Overrides",
  "Asked",
  "Tokens",
  "Spent",
  "Today",
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className={QUIET}>
            <tr>
              {HEAD.map((h) => (
                <th key={h} className="whitespace-nowrap py-1 pr-4 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className="border-t border-(--ui-hair)">
                <td className="py-1 pr-4 font-medium">{r.name}</td>
                <td className="py-1 pr-4">
                  <Tag tone={MODE[r.mode].tone}>{MODE[r.mode].label}</Tag>
                </td>
                <td className="py-1 pr-4">{r.calls}</td>
                <td className="py-1 pr-4" title={`${r.agreed} of ${r.judged}`}>
                  {pct(r.rate)}
                  {r.judged ? <span className={QUIET}> of {r.judged}</span> : null}
                </td>
                <td className="py-1 pr-4">{r.overrides}</td>
                <td className="py-1 pr-4">
                  {r.decisions}
                  {r.failed ? <span className={QUIET}> ({r.failed} failed)</span> : null}
                </td>
                <td className="py-1 pr-4">{r.inputTokens.toLocaleString()}</td>
                <td className="py-1 pr-4">{usd(r.usd)}</td>
                <td className="py-1 pr-4">{usd(r.usdToday)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
