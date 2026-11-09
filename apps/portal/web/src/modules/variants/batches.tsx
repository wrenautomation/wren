/**
 * Variants › Batches: every batch, newest first, and one batch whole (`?batch=<id>`). A closed
 * batch: his calls, notes and the idea each sample tested, read only. An open batch: marked here,
 * blind (queue order, no ideas), then handed to Vireo.
 */
import {
  Button,
  CHIP,
  cx,
  Empty,
  Icon,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  Tag,
  TierLabel,
} from "@wren/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { usePageContext } from "../agent/drive.js";
import { dayLabel } from "../work/bits.js";
import { FramesProvider } from "./live-page.js";
import { type Kind, pct, type Sample } from "./marks.js";
import { MarkBatch, type Open, SampleCard, TALLY, WIDE_KINDS } from "./page.js";
import { VERDICT_ON, ZONE_OF } from "./score.js";
import { Together, TogetherProvider } from "./together.js";

interface Row {
  id: number;
  /** number within its subject */
  n: number;
  /** Null while open: the agent's reason stays hidden until he hands it back. */
  why: string | null;
  note: string | null;
  state: string;
  createdAt: string;
  goodRate: number | null;
  subject: { id: number; slug: string; name: string; kind: Kind; brief: string | null };
  samples: (Sample & { change: string | null })[];
}

const HERE = "/variants/batches";
/** `CHIP_ON` by the address: a variant outranks CHIP's own ground and ink, cx does not merge. */
const CHIP_SET =
  "aria-[current=page]:bg-(--ui-accent-tint) aria-[current=page]:text-(--ui-active) aria-[current=page]:hover:bg-(--ui-accent-tint)";
/** A thumb's width (w-20) plus its gap (gap-1.5). */
const THUMB_STEP = 86;

export function BatchesPage({ params }: PageProps) {
  const got = useCall("variants-batches", () => call<Row[]>("variants/batches", {}), {
    pollMs: POLL_MS,
  });
  const [rows, setRows] = useState<Row[] | null>(null);
  // a read with new batches or samples while he marks one: held behind a bar, not swapped in
  const [fresh, setFresh] = useState<Row[] | null>(null);
  const id = Number(params.get("batch")) || null;
  // set by Send: the next read is taken whole (the closed batch's why)
  const take = useRef(false);
  // read, not a dependency: his own marks must not trigger a merge
  const shown = useRef(rows);
  shown.current = rows;
  useEffect(() => {
    const next = got.data;
    if (!next) return;
    const rows = shown.current;
    // a batch open in front of him keeps its marks; a read with new batches or samples waits
    const held = id !== null && !take.current && !!rows?.some((r) => r.id === id);
    if (held && shapeOf(rows ?? []) !== shapeOf(next)) return setFresh(next);
    take.current = false;
    setFresh(null);
    if (!held) setRows(next);
  }, [got.data, id]);
  const bar = fresh && (
    <div
      role="status"
      className="mb-3 flex items-center justify-between gap-3 rounded-md bg-(--ui-accent-tint) px-3 py-2 text-[13px]"
    >
      <span>{freshLine(rows ?? [], fresh)}</span>
      <Button
        size="dense"
        onClick={() => {
          setRows(fresh);
          setFresh(null);
        }}
      >
        Show
      </Button>
    </div>
  );
  if (got.error && !rows) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!rows) return <Loading shape="rows" lines={4} />;
  if (id != null) {
    const row = rows.find((r) => r.id === id);
    if (!row)
      return (
        <Empty title={`No batch ${id}`}>
          <a href={HERE}>All batches</a>
        </Empty>
      );
    const patch = (sampleId: number, fn: (s: Sample) => Sample) =>
      setRows((rs) =>
        (rs ?? []).map((r) =>
          r.id !== id
            ? r
            : { ...r, samples: r.samples.map((s) => (s.id === sampleId ? { ...s, ...fn(s) } : s)) },
        ),
      );
    // closed now: the agent's why shows; a fresh read brings it
    const sent = () => {
      setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, state: "closed" } : r)));
      take.current = true;
      got.retry();
    };
    // the subject's newest open batch, when it is not this one
    const newer = rows.find(
      (r) => r.subject.slug === row.subject.slug && r.state === "open" && r.n > row.n,
    );
    return (
      <>
        {bar}
        <BatchView row={row} newer={newer} patch={patch} params={params} onSent={sent} />
      </>
    );
  }
  return <BatchList rows={rows} params={params} />;
}

/** New batches show on their own while he is away from one; the Vireo agent adds them. */
const POLL_MS = 15_000;
/** What a read adds: batches and samples, not his marks on them. */
const shapeOf = (rows: Row[]) => rows.map((r) => `${r.id}:${r.state}:${r.samples.length}`).join();
function freshLine(now: Row[], next: Row[]): string {
  const had = new Set(now.map((r) => r.id));
  const added = next.filter((r) => !had.has(r.id));
  const [one] = added;
  if (one && added.length === 1) return `New batch: ${one.subject.name} ${one.n}`;
  if (added.length) return `${added.length} new batches`;
  return "This batch changed";
}

function BatchList({ rows, params }: { rows: Row[]; params: URLSearchParams }) {
  const subjects = useMemo(
    () => [...new Map(rows.map((r) => [r.subject.slug, r.subject.name])).entries()],
    [rows],
  );
  const pick = params.get("subject") ?? "";
  const shown = pick ? rows.filter((r) => r.subject.slug === pick) : rows;
  // only a subject's newest open batch waits on him (vireo's queue); it leads (DESIGN.md, Needs You)
  const waits = waitingOf(rows);
  const tiers = [
    { needs: true, rows: shown.filter((r) => waits.has(r.id)) },
    { needs: false, rows: shown.filter((r) => !waits.has(r.id)) },
  ].filter((t) => t.rows.length);
  usePageContext(`in view: every Variants batch${pick ? ` of ${pick}` : ""}, newest first`);
  if (!rows.length)
    return (
      <Empty title="No batches yet">
        Ask the agent in chat to start a subject. Its batches land here.
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      {subjects.length > 1 && (
        <nav aria-label="Subject" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {[["", "All"] as const, ...subjects].map(([slug, name]) => (
            <a
              key={slug}
              href={href(HERE, { subject: slug }, params)}
              aria-current={pick === slug ? "page" : undefined}
              className={cx(CHIP, CHIP_SET)}
            >
              {name}
            </a>
          ))}
        </nav>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {tiers.map((t) => [
          <li
            key={t.needs ? "needs" : "info"}
            className="flex h-8 items-center bg-(--ui-band) px-2 text-[12px] font-semibold text-(--ui-ink-2)"
          >
            <TierLabel needs={t.needs} n={t.rows.length} />
          </li>,
          ...t.rows.map((r) => (
            <li key={r.id}>
              <BatchRow row={r} waits={waits.has(r.id)} />
            </li>
          )),
        ])}
      </ul>
    </div>
  );
}

/** Ids of open batches that are their subject's newest: a newer batch replaces an unmarked one. */
function waitingOf(rows: Row[]): Set<number> {
  const newest = new Map<string, number>();
  for (const r of rows) newest.set(r.subject.slug, Math.max(newest.get(r.subject.slug) ?? 0, r.n));
  return new Set(
    rows.filter((r) => r.state === "open" && r.n === newest.get(r.subject.slug)).map((r) => r.id),
  );
}

function BatchRow({ row: r, waits }: { row: Row; waits: boolean }) {
  const open = r.state === "open";
  const kept = r.samples.filter((s) => s.keptAt).length;
  const posters = r.samples.filter((s) => s.posterUrl);
  const box = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(posters.length);
  // as many as the row holds; past that the last slot says +N
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setFit(Math.max(1, Math.floor((el.clientWidth + 6) / THUMB_STEP))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = posters.length > fit ? posters.slice(0, fit - 1) : posters;
  const more = posters.length - shown.length;
  return (
    <a
      href={href(HERE, { batch: r.id })}
      className="flex flex-col gap-2 border-b border-(--ui-hair) px-1 py-3 text-(--ui-ink) no-underline hover:bg-(--ui-hover) @min-[720px]/main:flex-row @min-[720px]/main:items-start @min-[720px]/main:gap-4"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cx(
            "text-[14px]",
            waits ? "font-semibold text-(--ui-ink)" : "font-normal text-(--ui-ink-2)",
          )}
        >
          {r.subject.name}
        </span>
        <span className="text-[12px] text-(--ui-ink-3) tabular-nums">
          Batch {r.n} · {dayLabel(r.createdAt)} · {r.samples.length} samples
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {waits ? (
            // "Needs you" says it waits; the tag adds how far he got
            <Tag tone="needs" dot>
              {r.samples.filter((s) => s.verdict).length} of {r.samples.length} marked
            </Tag>
          ) : open ? (
            <Tag>
              Replaced · {r.samples.filter((s) => s.verdict).length} of {r.samples.length} marked
            </Tag>
          ) : (
            <>
              {r.goodRate != null && (
                <span className="text-[12px] font-semibold text-(--ui-ink-2)">
                  {pct(r.goodRate)} good or better
                </span>
              )}
              <Tally samples={r.samples} />
              {kept > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-(--ui-ink-3)">
                  <Icon name="pin" size={12} />
                  {kept} kept
                </span>
              )}
            </>
          )}
        </span>
        {r.why && (
          <span className="text-[13px] text-(--ui-ink-2)">
            <span className="text-(--ui-ink-3)">Agent: </span>
            {r.why}
          </span>
        )}
        {r.note && (
          <span className="text-[13px] text-(--ui-ink)">
            <span className="text-(--ui-ink-3)">You: </span>
            {r.note}
          </span>
        )}
      </span>
      {posters.length > 0 && (
        <span
          ref={box}
          // wants every thumb; capped by the row, then counted
          style={{ width: posters.length * THUMB_STEP - 6 }}
          className="flex h-12 max-w-full min-w-0 shrink-0 items-center gap-1.5 @min-[720px]/main:max-w-[55%] @min-[720px]/main:justify-end"
        >
          {shown.map((s) => (
            <span key={s.id} className="relative block flex-none">
              <img
                src={s.posterUrl ?? ""}
                alt=""
                loading="lazy"
                className="block h-12 w-20 rounded-[4px] border border-(--ui-hair) bg-(--ui-tile) object-cover"
              />
              {!open && s.verdict && (
                <span
                  role="img"
                  aria-label={s.verdict}
                  className={cx(
                    "absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border",
                    VERDICT_ON[s.verdict],
                  )}
                >
                  <Icon name={ZONE_OF[s.verdict].icon} size={10} />
                </span>
              )}
            </span>
          ))}
          {more > 0 && (
            <span className="grid h-12 w-20 flex-none place-items-center rounded-[4px] bg-(--ui-fill) text-[13px] font-medium text-(--ui-ink-2) tabular-nums">
              +{more}
            </span>
          )}
        </span>
      )}
    </a>
  );
}

/** "2 amazing · 1 good · 1 okay · 3 bad", each in its call's color; unmarked last. */
function Tally({ samples }: { samples: Sample[] }) {
  const counts = TALLY.map((t) => [t, samples.filter((s) => s.verdict === t).length] as const);
  const none = samples.filter((s) => !s.verdict).length;
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
  newer,
  patch,
  params,
  onSent,
}: {
  row: Row;
  newer: Row | undefined;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  params: URLSearchParams;
  onSent: () => void;
}) {
  const open = r.state === "open";
  usePageContext(
    `in view: batch ${r.subject.slug}:${r.n} (${r.subject.kind}, id ${r.id}), ${open ? "open" : "closed"}, ${r.samples.length} samples`,
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span>
          <Button
            size="dense"
            tone="quiet"
            icon="left"
            onClick={() => navigate(href(HERE, { batch: null }, params))}
          >
            Batches
          </Button>
        </span>
        <h2 className={cx(PAGE_TITLE, "m-0 mt-1 text-(--ui-ink)")}>{r.subject.name}</h2>
        {r.subject.brief && <p className="m-0 text-[13px] text-(--ui-ink-2)">{r.subject.brief}</p>}
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Batch {r.n} · {dayLabel(r.createdAt)} · {r.samples.length} samples
          {r.goodRate != null && ` · ${pct(r.goodRate)} good or better`}
        </p>
        {!open && (
          <div className="mt-1">
            <Tally samples={r.samples} />
          </div>
        )}
        {r.why && (
          <p className="m-0 mt-1 text-[13px] text-(--ui-ink-2)">
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
        <OpenBatch row={r} newer={newer} patch={patch} onSent={onSent} />
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
  row: Row;
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
  newer,
  patch: patchRow,
  onSent,
}: {
  row: Row;
  newer: Row | undefined;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  onSent: () => void;
}) {
  const id = row.id;
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
              <a href={href(HERE, { batch: newer.id })} className="text-(--ui-ink) underline">
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
