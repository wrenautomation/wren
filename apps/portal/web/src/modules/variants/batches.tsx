/**
 * Variants › Batches (vireo D11): a page of batches the server sorts and filters, and one batch
 * whole (`?b=<subject>:<n>`). List state lives in the address: `sort`, `subject`, `folder`,
 * `kind`, `state`, `who`. A closed batch: every call, notes and the idea each sample tested, read
 * only. An open batch: blind, only his own marks, then handed to Vireo.
 */
import {
  AskAgent,
  Button,
  cx,
  Empty,
  Icon,
  Img,
  LoadFailed,
  Loading,
  PAGE_TITLE,
  Tag,
  TierLabel,
} from "@wren/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useFolders } from "../../folders.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { usePageContext } from "../agent/drive.js";
import { dayLabel, SELECT } from "../work/bits.js";
import { FramesProvider } from "./live-page.js";
import { type Kind, pct, type Sample } from "./marks.js";
import { MarkBatch, type Open, SampleCard, TALLY, WIDE_KINDS } from "./page.js";
import { Rename } from "./rename.js";
import { VERDICT_ON, ZONE_OF } from "./score.js";
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

/** One row of the list: counts, not samples. An open batch shows only his own marks. */
interface ListRow {
  ref: string;
  id: number;
  n: number;
  /** One line he sees: what the batch is. Null on a batch made before titles */
  title: string | null;
  /** Null while open: the agent's reason stays hidden until the batch closes. */
  why: string | null;
  note: string | null;
  state: string;
  createdAt: string;
  subject: Subject;
  /** open and its subject's newest */
  waits: boolean;
  samples: number;
  kept: number;
  /** open: his own marks; closed: every call */
  marked: number;
  judges: number | null;
  goodRate: number | null;
  tally: Counts | null;
  thumbs: { id: number; posterUrl: string | null; verdict: Verdict | null }[];
}
interface ListPage {
  rows: ListRow[];
  next: number | null;
  waiting: number;
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
/** A thumb's width (w-20) plus its gap (gap-1.5). */
const THUMB_STEP = 86;
const SORTS = {
  waiting: "Waiting first",
  newest: "Newest",
  oldest: "Oldest",
  subject: "By subject",
  good: "Best good rate",
} as const;
const STATES = { "": "Any state", waits: "Waiting", open: "Open", closed: "Closed" } as const;
const KIND_NAMES = { "": "Every kind", text: "Text", image: "Image", video: "Video", page: "Page" };
const WHO = { "": "Anyone's", me: "Marked by me" } as const;

export function BatchesPage({ params, team }: PageProps) {
  // ?batch=<id>: links made before refs; the server reads an id too
  const ref = params.get("b") ?? params.get("batch");
  return ref ? (
    <OneBatch key={ref} batchRef={ref} params={params} />
  ) : (
    <BatchList params={params} team={team} />
  );
}

/** The list's query from the address; a folder becomes its subjects, sub-folders included. */
function useQuery(params: URLSearchParams, team: boolean) {
  const filed = useFolders("subject", team);
  const subjects = useCall("variants-subjects", () => call<Subject[]>("variants/subjects", {}));
  const folder = Number(params.get("folder")) || null;
  const inFolder = useMemo(() => {
    if (folder == null || !filed.folders || !subjects.data) return null;
    const under = new Set([folder]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of filed.folders)
        if (f.parent != null && under.has(f.parent) && !under.has(f.id)) {
          under.add(f.id);
          grew = true;
        }
    }
    return subjects.data
      .filter((s) => under.has(filed.folderOf(String(s.id)) ?? -1))
      .map((s) => s.id);
  }, [folder, filed, subjects.data]);
  const q = {
    sort: params.get("sort") || "waiting",
    subject: params.get("subject") || null,
    kind: params.get("kind") || null,
    state: params.get("state") || null,
    who: params.get("who") || null,
    ...(inFolder ? { subjects: inFolder } : {}),
  };
  // a folder waits for the tree and the subjects before it can ask
  const ready = folder == null || inFolder != null;
  return { q, ready, folders: filed.folders, subjects: subjects.data ?? [] };
}

function BatchList({ params, team }: { params: URLSearchParams; team: boolean }) {
  const { q, ready, folders, subjects } = useQuery(params, team);
  const key = JSON.stringify(q);
  // a Vireo write anywhere pushes "variants": new batches show without a reload
  const got = useCall(
    ready ? `variants-batches:${key}` : null,
    () => call<ListPage>("variants/batches", q),
    { live: "variants" },
  );
  // pages past the first, from Show more; held per query, so a new query starts over
  const [extra, setExtra] = useState<{ key: string; pages: ListPage[] }>({ key, pages: [] });
  const more = extra.key === key ? extra.pages : [];
  const [loading, setLoading] = useState(false);
  usePageContext(
    `in view: Variants batches, ${SORTS[q.sort as keyof typeof SORTS] ?? q.sort}${
      q.subject ? `, subject ${q.subject}` : ""
    }${q.state ? `, ${q.state}` : ""}${q.kind ? `, ${q.kind}` : ""}${q.who ? ", marked by him" : ""}`,
  );
  const set = (k: string, v: string) => navigate(href(HERE, { [k]: v || null }, params));
  const bar = (
    // phone: two to a row; wider: one line that wraps
    <div className="grid grid-cols-2 gap-2 @min-[720px]/main:flex @min-[720px]/main:flex-wrap">
      <Pick
        label="Sort"
        value={q.sort}
        options={SORTS}
        onChange={(v) => set("sort", v === "waiting" ? "" : v)}
      />
      <Pick
        label="Subject"
        value={q.subject ?? ""}
        options={{
          "": "Every subject",
          ...Object.fromEntries(subjects.map((s) => [s.slug, s.name])),
        }}
        onChange={(v) => set("subject", v)}
      />
      {folders && folders.length > 0 && (
        <Pick
          label="Folder"
          value={params.get("folder") ?? ""}
          options={{
            "": "Every folder",
            ...Object.fromEntries(folders.map((f) => [String(f.id), f.name])),
          }}
          onChange={(v) => set("folder", v)}
        />
      )}
      <Pick
        label="Kind"
        value={q.kind ?? ""}
        options={KIND_NAMES}
        onChange={(v) => set("kind", v)}
      />
      <Pick
        label="State"
        value={q.state ?? ""}
        options={STATES}
        onChange={(v) => set("state", v)}
      />
      <Pick label="Marked by" value={q.who ?? ""} options={WHO} onChange={(v) => set("who", v)} />
    </div>
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={4} />;
  const pages = [got.data, ...more];
  const rows = pages.flatMap((p) => p.rows);
  const next = pages.at(-1)?.next ?? null;
  const filtered = [...params.keys()].some((k) =>
    ["subject", "folder", "kind", "state", "who"].includes(k),
  );
  if (!rows.length && !filtered)
    return (
      <Empty title="No batches yet" action={<AskAgent setup="vireo" ask="Start variants for " />}>
        Start a subject in the chat. Its batches land here.
      </Empty>
    );
  // waiting first: what waits leads (DESIGN.md, Needs You); other sorts are one list
  const tiers =
    q.sort === "waiting"
      ? [
          { needs: true, n: got.data.waiting, rows: rows.filter((r) => r.waits) },
          { needs: false, n: null, rows: rows.filter((r) => !r.waits) },
        ].filter((t) => t.rows.length)
      : [{ needs: null, n: null, rows }];
  return (
    <div className="flex flex-col gap-3">
      {bar}
      {!rows.length ? (
        <Empty
          action={
            <a
              href={href(
                HERE,
                { subject: null, folder: null, kind: null, state: null, who: null },
                params,
              )}
            >
              Clear filters
            </a>
          }
        >
          No batch matches these filters.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tiers.map((t) => [
            t.needs != null && (
              <li
                key={t.needs ? "needs" : "info"}
                className="flex h-8 items-center bg-(--ui-band) px-2 text-[12px] font-semibold text-(--ui-ink-2)"
              >
                <TierLabel needs={t.needs} n={t.n ?? t.rows.length} />
              </li>
            ),
            ...t.rows.map((r) => (
              <li key={r.id}>
                <BatchRow row={r} params={params} />
              </li>
            )),
          ])}
        </ul>
      )}
      {next != null && (
        <span>
          <Button
            size="dense"
            tone="quiet"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                const page = await call<ListPage>("variants/batches", { ...q, after: next });
                setExtra((x) => ({ key, pages: x.key === key ? [...x.pages, page] : [page] }));
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Loading…" : "Show more"}
          </Button>
        </span>
      )}
    </div>
  );
}

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | string;
  options: Readonly<Record<string, string>>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      // a long subject name would stretch it: capped
      className={cx(SELECT, "w-full min-w-0 @min-[720px]/main:w-auto @min-[720px]/main:max-w-64")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

function BatchRow({ row: r, params }: { row: ListRow; params: URLSearchParams }) {
  const open = r.state === "open";
  const posters = r.thumbs.filter((s) => s.posterUrl);
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
  const extra = posters.length - shown.length;
  return (
    <a
      // the list's filters ride along, so Back returns to the same list
      href={href(HERE, { b: r.ref }, params)}
      className="flex flex-col gap-2 border-b border-(--ui-hair) px-1 py-3 text-(--ui-ink) no-underline hover:bg-(--ui-hover) @min-[720px]/main:flex-row @min-[720px]/main:items-start @min-[720px]/main:gap-4"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cx(
            "text-[14px]",
            r.waits ? "font-semibold text-(--ui-ink)" : "font-normal text-(--ui-ink-2)",
          )}
        >
          {r.subject.name}
        </span>
        {r.title && <span className="text-[13px] text-(--ui-ink-2)">{r.title}</span>}
        <span className="text-[12px] text-(--ui-ink-3) tabular-nums">
          Batch {r.n} · {dayLabel(r.createdAt)} · {r.samples} samples
          {r.judges != null && r.judges > 1 && ` · ${r.judges} people`}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {r.waits ? (
            // "Needs you" says it waits; the tag adds how far he got
            <Tag tone="needs" dot>
              {r.marked} of {r.samples} marked
            </Tag>
          ) : open ? (
            <Tag>
              Replaced · {r.marked} of {r.samples} marked
            </Tag>
          ) : (
            <>
              {r.goodRate != null && (
                <span className="text-[12px] font-semibold text-(--ui-ink-2)">
                  {pct(r.goodRate)} good or better
                </span>
              )}
              {r.tally && <Tally counts={r.tally} />}
              {r.kept > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-(--ui-ink-3)">
                  <Icon name="pin" size={12} />
                  {r.kept} kept
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
            <span className="text-(--ui-ink-3)">Note: </span>
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
              <Img
                src={s.posterUrl ?? ""}
                alt=""
                loading="lazy"
                className="block h-12 w-20 rounded-[4px] border border-(--ui-hair) bg-(--ui-tile) object-cover"
              />
              {s.verdict && (
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
          {extra > 0 && (
            <span className="grid h-12 w-20 flex-none place-items-center rounded-[4px] bg-(--ui-fill) text-[13px] font-medium text-(--ui-ink-2) tabular-nums">
              +{extra}
            </span>
          )}
        </span>
      )}
    </a>
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
        {r.subject.brief && <p className="m-0 text-[13px] text-(--ui-ink-2)">{r.subject.brief}</p>}
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
