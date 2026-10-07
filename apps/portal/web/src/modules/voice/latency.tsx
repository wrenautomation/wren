/**
 * Latency: per pipeline, how long after the caller stops each stage comes, p50 and p95 over the
 * last 30 days (`voice_latency`). "Heard" is the number a caller feels. Under it, dictation's.
 */
import type { RecordsPage } from "@wren/core/records/serve";
import { Alert, ButtonLink, Empty, Loading, PageHeader, Section } from "@wren/ui";
import { STAGES, type Stage } from "@wren/voice";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { InDevelopment, SMALL } from "./bits.js";
import { DictationLatency } from "./dictation.js";

interface StageRow {
  pipeline: string;
  stage: Stage;
  rank: number;
  p50: number | null;
  p95: number | null;
  turns: number;
}

/** Under this a reply feels instant on the phone; past it, people notice the gap. */
const GOAL_MS = 800;

export function Latency(_: PageProps) {
  const got = useCall("voice:latency", () =>
    call<RecordsPage>("console/recordsList", { record: "voice.latency", view: "all", limit: 200 }),
  );
  const rows = (got.data?.rows ?? []) as unknown as StageRow[];
  const pipelines = [...new Set(rows.map((r) => r.pipeline))];
  const scale = Math.max(GOAL_MS * 1.25, ...rows.map((r) => r.p95 ?? r.p50 ?? 0));
  return (
    <>
      <PageHeader
        title="Latency"
        lede="How long after the caller stops talking each step comes, over the last 30 days."
      />
      <InDevelopment>
        Only test calls so far. Real calls on the phone line show here once it's set up, each
        pipeline on its own.
      </InDevelopment>
      {got.error && !got.data ? (
        <Alert onRetry={got.retry}>{got.error.message}</Alert>
      ) : !got.data ? (
        <Loading lines={5} />
      ) : !pipelines.length ? (
        <Empty
          action={
            <ButtonLink size="dense" icon="phone" href="/voice/test">
              Make a test call
            </ButtonLink>
          }
        >
          No timed turns yet. A test call's turns show here when it ends.
        </Empty>
      ) : (
        <div className="grid max-w-[880px] gap-12">
          {pipelines.map((p) => (
            <Pipeline
              key={p}
              name={p}
              rows={rows.filter((r) => r.pipeline === p).sort((a, b) => a.rank - b.rank)}
              scale={scale}
            />
          ))}
          <Key />
        </div>
      )}
      <DictationLatency />
    </>
  );
}

const pct = (n: number, scale: number) => `${Math.min(100, (Math.max(0, n) / scale) * 100)}%`;

function Pipeline({ name, rows, scale }: { name: string; rows: StageRow[]; scale: number }) {
  const turns = Math.max(0, ...rows.map((r) => r.turns));
  return (
    <Section title={name} note={`${turns} ${turns === 1 ? "turn" : "turns"}`}>
      <ol className="grid gap-3">
        {rows.map((r) => {
          const heard = r.stage === "heard";
          return (
            <li
              key={r.stage}
              className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 max-[560px]:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className={heard ? "text-[14px] font-medium" : "text-[14px] text-(--ui-ink-2)"}>
                {STAGES[r.stage]}
              </span>
              <span
                className="relative h-3 rounded-full bg-(--ui-tile) max-[560px]:order-last max-[560px]:col-span-2"
                role="img"
                aria-label={`${STAGES[r.stage]}: p50 ${r.p50 ?? "none"} ms, p95 ${r.p95 ?? "none"} ms`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--ui-accent)_30%,transparent)]"
                  style={{ width: pct(r.p95 ?? 0, scale) }}
                />
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${heard ? "bg-(--ui-accent)" : "bg-(--ui-ink-2)"}`}
                  style={{ width: pct(r.p50 ?? 0, scale) }}
                />
                <span
                  aria-hidden
                  className="absolute -inset-y-1 w-px bg-(--ui-ink-3)"
                  style={{ left: pct(GOAL_MS, scale) }}
                />
              </span>
              <span className="text-right text-[13.5px] tabular-nums">
                <span className={heard ? "font-medium" : ""}>{r.p50 ?? "none"}</span>
                <span className="text-(--ui-ink-3)"> / {r.p95 ?? "none"} ms</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Key() {
  return (
    <p className={`flex flex-wrap gap-x-5 gap-y-1 ${SMALL}`}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-4 rounded-full bg-(--ui-ink-2)" /> p50
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-4 rounded-full bg-[color-mix(in_oklab,var(--ui-accent)_30%,transparent)]"
        />{" "}
        p95
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-(--ui-ink-3)" /> {GOAL_MS} ms, where a gap starts
        to feel slow
      </span>
    </p>
  );
}
