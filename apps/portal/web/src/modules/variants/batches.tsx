/**
 * Variants › Batches (vireo D11; designs/2026-11-26-batches-actions.md): the list is the shared
 * records list over `variants.batch` (cards, tabs, Filter, picks, Close and Rename); one batch
 * whole at `?b=<subject>:<n>` or `?batch=<id>` (a card's click). A closed batch: every call, notes
 * and the idea each sample tested, read only. An open batch: blind, only his own marks, then
 * handed to Vireo.
 */
import {
  type Action,
  AskAgent,
  Button,
  cx,
  Empty,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  said,
  useSeen,
} from "@wren/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { ListPage, PageProps } from "../../module.js";
import { TemplatePage } from "../../records.js";
import { href, navigate } from "../../route.js";
import { dayLabel } from "../work/bits.js";
import { FramesProvider } from "./live-page.js";
import { type Kind, pct, type Sample } from "./marks.js";
import { MarkBatch, type Open, SampleCard, TALLY, WIDE_KINDS } from "./page.js";
import { Rename } from "./rename.js";
import { VERDICT_ON } from "./score.js";
import { Together, TogetherProvider } from "./together.js";

type Verdict = NonNullable<Sample["verdict"]>;
type Counts = Record<Verdict | "unmarked", number>;
interface Subject {
  id: number;
  slug: string;
  name: string;
  kind: Kind;
  brief: string | null;
}

/** One batch whole. `score`, `verdict`: the mean of the calls he may see. */
export interface Whole {
  ref: string;
  id: number;
  n: number;
  title: string | null;
  why: string | null;
  note: string | null;
  state: string;
  createdAt: string;
  subject: Subject;
  goodRate: number | null;
  /** who called; null while open */
  judges: string[] | null;
  newer: { n: number; ref: string } | null;
  samples: (Sample & { change: string | null })[];
}

const HERE = "/variants/batches";

/**
 * Close and Rename from the list (WA-1455). Hand to Vireo and None of these stay on the batch
 * page: each is a call on samples he must see first.
 */
const BATCH_ACTIONS: Action[] = [
  {
    id: "variants.close",
    label: "Close",
    handler: "variants/close",
    // a replaced batch has no other way to close
    when: { state: ["waiting", "replaced"] },
    bulk: true,
    confirm: "Close? The marks stay; Vireo is not told.",
    done: said("Closed"),
    sets: { state: "closed" },
  },
  {
    id: "variants.rename",
    label: "Rename",
    handler: "variants/rename",
    // unchanged text sends no name: the handler then does nothing
    ask: { field: "name", label: "Title" },
    done: said("Renamed"),
  },
];

const BATCHES_LIST: ListPage = {
  id: "batches",
  label: "Batches",
  about: "Every batch, newest first; mark an open one blind, then hand it to Vireo.",
  template: "list",
  record: "variants.batch",
  // only a subject's newest open batch waits on him (vireo store.ts:242)
  needs: { state: ["waiting"] },
  // a Vireo write anywhere pushes "variants": new batches show without a reload
  live: ["variants"],
  cardGrid: { mark: "subject", kind: "kind", foot: "marked", media: "wide" },
  empty: {
    waiting: "No batch waits on you.",
    replaced: "No open batch was replaced by a newer one.",
    closed: "No batch is closed yet.",
    all: "No batches yet. Start a subject in the chat; its batches land here.",
  },
  actions: BATCH_ACTIONS,
  head: () => <AskAgent setup="vireo" ask="Start variants for " />,
};

export function BatchesPage(props: PageProps) {
  // ?batch=<id>: a card's click and links made before refs; the server reads an id too
  const ref = props.params.get("b") ?? props.params.get("batch");
  return ref ? (
    <OneBatch key={ref} batchRef={ref} params={props.params} />
  ) : (
    <TemplatePage {...props} page={BATCHES_LIST} path={HERE} id={undefined} app="variants" />
  );
}

/** One batch by its ref. A read with new samples while he marks it waits behind a bar. */
function OneBatch({ batchRef, params }: { batchRef: string; params: URLSearchParams }) {
  const got = useCall(
    `variants-batch:${batchRef}`,
    () => call<Whole>("variants/batch", { ref: batchRef }),
    { live: "variants" },
  );
  const [row, setRow] = useState<Whole | null>(null);
  const [fresh, setFresh] = useState<Whole | null>(null);
  // remounts the open batch's marks after Show
  const [round, setRound] = useState(0);
  const shown = useRef(row);
  shown.current = row;
  useEffect(() => {
    const next = got.data;
    if (!next) return;
    const now = shown.current;
    const held =
      now != null &&
      now.state === "open" &&
      next.state === "open" &&
      now.samples.length !== next.samples.length;
    if (held) return setFresh(next);
    setFresh(null);
    setRow(next);
  }, [got.data]);
  if (got.error && !row)
    return got.error.message.startsWith("no batch") ? (
      <Empty title={`No batch ${batchRef}`}>
        <a href={href(HERE, { b: null, batch: null }, params)}>All batches</a>
      </Empty>
    ) : (
      <LoadFailed error={got.error} onRetry={got.retry} />
    );
  if (!row) return <Loading />;
  const patch = (sampleId: number, fn: (s: Sample) => Sample) =>
    setRow(
      (r) =>
        r && { ...r, samples: r.samples.map((s) => (s.id === sampleId ? { ...s, ...fn(s) } : s)) },
    );
  return (
    <>
      {fresh && (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-md bg-(--ui-accent-tint) px-3 py-2 text-[13px]"
        >
          <span>New samples in this batch</span>
          <Button
            size="dense"
            onClick={() => {
              setRow(fresh);
              setFresh(null);
              setRound((n) => n + 1);
            }}
          >
            Show
          </Button>
        </div>
      )}
      <BatchView
        key={round}
        row={row}
        patch={patch}
        params={params}
        // closed now: the agent's why and every call show; a fresh read brings them
        onSent={() => {
          setRow((r) => r && { ...r, state: "closed" });
          got.retry();
        }}
      />
    </>
  );
}

export const countsOf = (samples: Sample[]): Counts => ({
  ...(Object.fromEntries(
    TALLY.map((t) => [t, samples.filter((s) => s.verdict === t).length]),
  ) as Record<Verdict, number>),
  unmarked: samples.filter((s) => !s.verdict).length,
});

/** "2 amazing · 1 good · 1 okay · 3 bad", each in its call's color; unmarked last. */
export function Tally({ counts: c }: { counts: Counts }) {
  const counts = TALLY.map((t) => [t, c[t]] as const);
  const none = c.unmarked;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {counts
        .filter(([, n]) => n)
        .map(([t, n]) => (
          <span
            key={t}
            className={cx("rounded-full border px-2 py-0.5 text-[12px]", VERDICT_ON[t])}
          >
            {n} {t}
          </span>
        ))}
      {none > 0 && <span className="text-[12px] text-(--ui-ink-3)">{none} unmarked</span>}
    </span>
  );
}

function BatchView({
  row: r,
  patch,
  params,
  onSent,
}: {
  row: Whole;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  params: URLSearchParams;
  onSent: () => void;
}) {
  const open = r.state === "open";
  useSeen("record", {
    label: `Batch ${r.subject.slug}:${r.n}`,
    icon: "page",
    text: `batch ${r.subject.slug}:${r.n} (${r.subject.kind}, id ${r.id}), ${open ? "open" : "closed"}, ${r.samples.length} samples`,
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span>
          <Button
            size="dense"
            tone="quiet"
            icon="left"
            onClick={() => navigate(href(HERE, { b: null, batch: null }, params))}
          >
            Batches
          </Button>
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Rename
            value={r.subject.name}
            label="subject"
            max={120}
            save={(to) => call("variants/rename", { subject: r.subject.id, name: to })}
          >
            {(n) => <h2 className={cx(PAGE_TITLE, "m-0 text-(--ui-ink)")}>{n}</h2>}
          </Rename>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Rename
            value={r.title ?? ""}
            label="batch"
            field="Batch title"
            max={120}
            save={(to) => call("variants/rename", { batch: r.id, name: to })}
          >
            {(t) => (
              <p className={cx("m-0 text-[15px]", t ? "text-(--ui-ink)" : "text-(--ui-ink-3)")}>
                {t || "No title"}
              </p>
            )}
          </Rename>
        </div>
        {r.subject.brief && <p className="m-0 text-[13px] text-(--ui-ink)">{r.subject.brief}</p>}
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Batch {r.n} · {dayLabel(r.createdAt)} · {r.samples.length} samples
          {r.goodRate != null && ` · ${pct(r.goodRate)} good or better`}
          {r.judges && r.judges.length > 1 && ` · ${r.judges.length} people`}
        </p>
        {!open && (
          <div className="mt-1">
            <Tally counts={countsOf(r.samples)} />
          </div>
        )}
        {r.why && (
          <p className="m-0 mt-1 text-[13px] text-(--ui-ink)">
            <span className="text-(--ui-ink-3)">Agent: </span>
            {r.why}
          </p>
        )}
        {r.note && (
          <p className="m-0 text-[13px] text-(--ui-ink)">
            <span className="text-(--ui-ink-3)">You: </span>
            {r.note}
          </p>
        )}
      </div>
      {open ? (
        <OpenBatch row={r} patch={patch} onSent={onSent} />
      ) : (
        <ReadOnly row={r} patch={patch} />
      )}
    </div>
  );
}

/** Every sample, read only. Still open (replaced): blind, no ideas. */
function ReadOnly({
  row: r,
  patch,
}: {
  row: Whole;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
}) {
  const group = useMemo(() => new Together(), []);
  const wide = WIDE_KINDS.includes(r.subject.kind);
  const blind = r.state === "open";
  return (
    <TogetherProvider value={group}>
      <div
        className={cx(
          "grid gap-4",
          wide
            ? "grid-cols-1 @min-[1000px]/main:grid-cols-2"
            : "grid-cols-1 @min-[720px]/main:grid-cols-2",
        )}
      >
        <FramesProvider ids={r.samples.map((s) => s.id)}>
          {r.samples.map((s, i) => (
            <SampleCard
              key={s.id}
              n={i + 1}
              kind={r.subject.kind}
              sample={s}
              patch={patch}
              closed={{ change: blind ? null : s.change }}
            />
          ))}
        </FramesProvider>
      </div>
    </TogetherProvider>
  );
}

/**
 * The open batch as the queue holds it: blind, in its shuffled order, with his marks so far. The
 * queue holds each subject's newest only: a replaced batch shows read only.
 */
function OpenBatch({
  row,
  patch: patchRow,
  onSent,
}: {
  row: Whole;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  onSent: () => void;
}) {
  const id = row.id;
  const newer = row.newer;
  const got = useCall("variants-queue", () => call<Open[]>("variants/queue", {}));
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => setOpen(got.data?.find((o) => o.batch.id === id) ?? null), [got.data, id]);
  if (got.error && !open) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading />;
  if (!open)
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          {newer ? (
            <>
              Batch {newer.n} replaced this one; you mark that.{" "}
              <a href={href(HERE, { b: newer.ref })} className="text-(--ui-ink) underline">
                Open batch {newer.n}
              </a>
            </>
          ) : (
            "This batch no longer waits on you."
          )}
        </p>
        <ReadOnly row={row} patch={patchRow} />
      </div>
    );
  const patch = (sampleId: number, fn: (s: Sample) => Sample) =>
    setOpen((o) => o && { ...o, samples: o.samples.map((s) => (s.id === sampleId ? fn(s) : s)) });
  return <MarkBatch open={open} patch={patch} onSent={onSent} />;
}
