/**
 * Voice dictation on the Latency page: p50 and p95 per way of dictating and stage, over the last
 * 30 days of `dictate` runs (packages/voice/src/dictation-store.ts). Only Wren's team reports.
 */
import { Alert, Empty, Loading, Section } from "@wren/ui";
import type { DictationStat } from "@wren/voice/console";
import { DICTATION_STAGES } from "@wren/voice/dictation";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { SMALL } from "./bits.js";

const ADAPTER_LABEL: Record<string, string> = {
  browser: "This device",
  server: "Our server",
  speech: "Browser's speech service",
};

/** Release to last words under this feels instant; past it, people wait on the text. */
const GOAL_MS = 500;

const pct = (n: number, scale: number) => `${Math.min(100, (Math.max(0, n) / scale) * 100)}%`;
const sec = (ms: number | null) => (ms === null ? "none" : `${(ms / 1000).toFixed(1)} s`);

export function DictationLatency() {
  const got = useCall("voice:dictation", () =>
    call<{ rows: DictationStat[] }>("voice/dictation", {}),
  );
  const rows = got.data?.rows ?? [];
  const adapters = [...new Set(rows.map((r) => r.adapter))];
  return (
    <section className="mt-12 grid max-w-[880px] gap-6">
      <div>
        <h2 className="text-[17px] font-medium">Voice dictation</h2>
        <p className={SMALL}>
          From the mic press to words in the box, per way of dictating. Your team's dictations only;
          the words are never kept.
        </p>
      </div>
      {got.error && !got.data ? (
        <Alert onRetry={got.retry}>{got.error.message}</Alert>
      ) : !got.data ? (
        <Loading lines={3} />
      ) : !adapters.length ? (
        <Empty>No dictations yet. Press the mic in any draft or Ask Claude box.</Empty>
      ) : (
        adapters.map((a) => <Adapter key={a} name={a} rows={rows.filter((r) => r.adapter === a)} />)
      )}
    </section>
  );
}

function Adapter({ name, rows }: { name: string; rows: DictationStat[] }) {
  const timed = rows.filter((r) => r.stage !== "load");
  const load = rows.find((r) => r.stage === "load");
  const scale = Math.max(GOAL_MS * 1.6, ...timed.map((r) => r.p95 ?? r.p50 ?? 0));
  const count = Math.max(0, ...rows.filter((r) => r.stage === "mic").map((r) => r.n));
  return (
    <Section
      title={ADAPTER_LABEL[name] ?? name}
      note={`${count} ${count === 1 ? "dictation" : "dictations"}`}
    >
      <ol className="grid gap-3">
        {timed.map((r) => {
          const last = r.stage === "final";
          const label = DICTATION_STAGES[r.stage];
          return (
            <li
              key={r.stage}
              className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 max-[560px]:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className={last ? "text-[14px] font-medium" : "text-[14px] text-(--ui-ink-2)"}>
                {label}
              </span>
              <span
                className="relative h-3 rounded-full bg-(--ui-tile) max-[560px]:order-last max-[560px]:col-span-2"
                role="img"
                aria-label={`${label}: p50 ${r.p50 ?? "none"} ms, p95 ${r.p95 ?? "none"} ms`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--ui-accent)_30%,transparent)]"
                  style={{ width: pct(r.p95 ?? 0, scale) }}
                />
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${last ? "bg-(--ui-accent)" : "bg-(--ui-ink-2)"}`}
                  style={{ width: pct(r.p50 ?? 0, scale) }}
                />
                {last ? (
                  <span
                    aria-hidden
                    className="absolute -inset-y-1 w-px bg-(--ui-ink-3)"
                    style={{ left: pct(GOAL_MS, scale) }}
                  />
                ) : null}
              </span>
              <span className="text-right text-[13.5px] tabular-nums">
                <span className={last ? "font-medium" : ""}>{r.p50 ?? "none"}</span>
                <span className="text-(--ui-ink-3)"> / {r.p95 ?? "none"} ms</span>
              </span>
            </li>
          );
        })}
      </ol>
      {load ? (
        <p className={`mt-3 tabular-nums ${SMALL}`}>
          {DICTATION_STAGES.load} on a first press: {sec(load.p50)} p50, {sec(load.p95)} p95, over{" "}
          {load.n} {load.n === 1 ? "load" : "loads"}. The line on the last bar is {GOAL_MS} ms.
        </p>
      ) : (
        <p className={`mt-3 ${SMALL}`}>The line on the last bar is {GOAL_MS} ms.</p>
      )}
    </Section>
  );
}
