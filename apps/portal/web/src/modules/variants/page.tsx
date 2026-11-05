/**
 * Campaigns › Variants (designs/2026-11-05-variants.md). To pick: the oldest open batch, every
 * sample whole and blind; Amazing / Good / Bad, notes on a line, a region or a moment, one guide
 * note, then send it back to the agent. Subjects: each one's batches, good rate, guides under
 * test. Catalog: what we kept. The agent writes through `wren variants`; this page only judges.
 */
import { Button, cx, Empty, Icon, LoadFailed, Loading, Seg, Textarea, useEdit } from "@wren/ui";
import { footageLength } from "@wren/variants/sync";
import { useEffect, useMemo, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { type Live, LiveView } from "./live.js";
import {
  type Anchor,
  anchorLabel,
  type Kind,
  type Note,
  NoteStrip,
  pct,
  type Sample,
  SampleBody,
  VERDICT_ON,
} from "./marks.js";
import { FootageLanes, type SyncMode, Together, TogetherProvider } from "./together.js";

type Verdict = Sample["verdict"];
interface Open {
  batch: { id: number; createdAt: string; note: string | null };
  subject: { id: number; slug: string; name: string; kind: Kind; brief: string | null };
  samples: Sample[];
}
interface SubjectRow {
  id: number;
  slug: string;
  name: string;
  kind: Kind;
  brief: string | null;
  state: string;
  samples: number;
  kept: number;
  toPick: number;
}
interface Effect {
  with: { good: number; n: number };
  without: { good: number; n: number };
  diff: number | null;
  early: boolean;
}
interface Guide {
  id: number;
  text: string;
  source: string;
  state: "testing" | "locked" | "dropped";
  subjectId: number | null;
  kind: Kind | null;
  effect: Effect;
}
interface SubjectView {
  subject: SubjectRow;
  guides: Guide[];
  batches: {
    id: number;
    why: string;
    note: string | null;
    state: string;
    createdAt: string;
    goodRate: number | null;
    samples: (Sample & { change: string | null })[];
  }[];
  leaders: { sample: number; strength: number; se: number }[];
  live?: Live;
}
interface Kept {
  sample: Sample;
  subject: { slug: string; name: string; kind: Kind };
}

type Tab = "pick" | "subjects" | "catalog";
const TABS = [
  { value: "pick", label: "To pick" },
  { value: "subjects", label: "Subjects" },
  { value: "catalog", label: "Catalog" },
] as const;
const VERDICTS: { v: NonNullable<Verdict>; label: string; icon: "star" | "check" | "close" }[] = [
  { v: "amazing", label: "Amazing", icon: "star" },
  { v: "good", label: "Good", icon: "check" },
  { v: "bad", label: "Bad", icon: "close" },
];
const WIDE_KINDS: readonly Kind[] = ["video", "page"];

export function VariantsPage(_: PageProps) {
  const [tab, setTab] = useState<Tab>("pick");
  return (
    <div className="flex flex-col gap-4">
      <Seg label="Variants" items={TABS} value={tab} onChange={setTab} />
      {tab === "pick" && <ToPick />}
      {tab === "subjects" && <Subjects />}
      {tab === "catalog" && <Catalog />}
    </div>
  );
}

function ToPick() {
  const got = useCall("variants-queue", () => call<Open[]>("variants/queue", {}));
  const [open, setOpen] = useState<Open[] | null>(null);
  const [at, setAt] = useState(0);
  useEffect(() => setOpen(got.data), [got.data]);
  if (got.error && !open) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!open) return <Loading />;
  if (!open.length)
    return (
      <Empty title="Nothing to pick">
        The agent's next batch lands here. Ask it in chat to start a subject.
      </Empty>
    );
  const cur = open[Math.min(at, open.length - 1)] as Open;
  const patch = (sampleId: number, fn: (s: Sample) => Sample) =>
    setOpen((o) =>
      (o ?? []).map((b) => ({
        ...b,
        samples: b.samples.map((s) => (s.id === sampleId ? fn(s) : s)),
      })),
    );
  const sent = () => {
    setOpen((o) => (o ?? []).filter((b) => b.batch.id !== cur.batch.id));
    setAt(0);
  };
  return (
    <div className="flex flex-col gap-3">
      {open.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {open.map((b, i) => (
            <Button
              key={b.batch.id}
              size="dense"
              tone={i === at ? "primary" : "secondary"}
              onClick={() => setAt(i)}
            >
              {b.subject.name} · {b.samples.length}
            </Button>
          ))}
        </div>
      )}
      <Batch key={cur.batch.id} open={cur} patch={patch} onSent={sent} />
    </div>
  );
}

function Batch({
  open,
  patch,
  onSent,
}: {
  open: Open;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  onSent: () => void;
}) {
  // kept across reloads until sent
  const note = useEdit(`variants:batch:${open.batch.id}:note`, "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const judged = open.samples.filter((s) => s.verdict).length;
  const wide = WIDE_KINDS.includes(open.subject.kind);
  const group = useMemo(() => new Together(), []);
  const [mode, setMode] = useState<SyncMode>("off");
  useEffect(() => group.setMode(mode), [group, mode]);
  const videos = open.subject.kind === "video" ? open.samples.filter((s) => s.mediaUrl) : [];
  const sources = videos.flatMap((s) => (s.source ? [s.source] : []));
  // same moment needs every cut's spans over one footage
  const oneFootage =
    sources.length === videos.length && new Set(sources.map((x) => x.ref)).size === 1;
  const modes = [
    { value: "off", label: "Apart" },
    ...(oneFootage ? [{ value: "moment", label: "Same moment" }] : []),
    { value: "clock", label: "Same clock" },
  ] as { value: SyncMode; label: string }[];
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call("variants/close", { batch: open.batch.id, note: note.value.trim() || null });
      note.saved();
      onSent();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 md:pb-24">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold text-(--ui-ink)">{open.subject.name}</h2>
        {open.subject.brief && (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">{open.subject.brief}</p>
        )}
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          {open.samples.length} samples, shown blind in random order. Mark what's good or bad; tap a
          line, drag a box or mark a moment to say where.
        </p>
      </header>
      {videos.length > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Seg dense label="Play together" items={modes} value={mode} onChange={setMode} />
            <span className="text-[12px] text-(--ui-ink-3)">
              {mode === "moment"
                ? "Play or seek any cut: the others jump to the same moment of the footage."
                : mode === "clock"
                  ? "Play or seek any cut: the others match its second."
                  : oneFootage
                    ? `${videos.length} cuts of one footage. Play them together to compare a moment.`
                    : "Play them together to compare."}
            </span>
          </div>
          {mode === "moment" && (
            <FootageLanes
              group={group}
              length={footageLength(sources)}
              cuts={open.samples.flatMap((s, i) =>
                s.source ? [{ n: i + 1, spans: s.source.spans }] : [],
              )}
            />
          )}
        </div>
      )}
      <TogetherProvider value={group}>
        <div
          className={cx(
            "grid gap-4",
            wide ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 md:grid-cols-2",
          )}
        >
          {open.samples.map((s, i) => (
            <SampleCard key={s.id} n={i + 1} kind={open.subject.kind} sample={s} patch={patch} />
          ))}
        </div>
      </TogetherProvider>
      <div className="-mx-1 flex flex-col gap-2 border-t border-(--ui-hair) bg-(--ui-paper) p-3 md:sticky md:bottom-0 md:z-10 md:flex-row md:items-end md:pr-16">
        <Textarea
          {...note.field}
          rows={2}
          placeholder="Guide for the next batch: what to keep, what to change"
          className="flex-1"
        />
        <div className="flex items-center gap-3">
          <span className="text-[12px] whitespace-nowrap text-(--ui-ink-3)">
            {judged} of {open.samples.length} marked
          </span>
          <Button tone="primary" icon="send" onClick={send} disabled={busy}>
            Send to agent
          </Button>
        </div>
        {err && <div className="text-[12px] text-(--ui-bad)">{err}</div>}
      </div>
    </div>
  );
}

function SampleCard({
  n,
  kind,
  sample,
  patch,
}: {
  n: number;
  kind: Kind;
  sample: Sample;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
}) {
  const [pending, setPending] = useState<{ anchor: Anchor | null } | null>(null);
  const [boxing, setBoxing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown) => setErr(String((e as Error).message ?? e));

  const judge = (v: NonNullable<Verdict>) => {
    const next = sample.verdict === v ? null : v;
    const before = sample.verdict;
    patch(sample.id, (s) => ({ ...s, verdict: next }));
    call("variants/judge", { sample: sample.id, verdict: next }).catch((e) => {
      patch(sample.id, (s) => ({ ...s, verdict: before }));
      fail(e);
    });
  };
  const keep = () => {
    const on = !sample.keptAt;
    patch(sample.id, (s) => ({ ...s, keptAt: on ? new Date().toISOString() : null }));
    call("variants/keep", { sample: sample.id, on }).catch(fail);
  };
  const save = async (tone: Note["tone"], text: string) => {
    const anchor = pending?.anchor ?? null;
    setPending(null);
    setBoxing(false);
    try {
      const row = await call<Note>("variants/note", {
        sample: sample.id,
        anchor,
        tone,
        text: text.trim() || null,
      });
      patch(sample.id, (s) => ({ ...s, notes: [...s.notes, row] }));
    } catch (e) {
      fail(e);
    }
  };
  const unnote = (id: number) => {
    patch(sample.id, (s) => ({ ...s, notes: s.notes.filter((x) => x.id !== id) }));
    call("variants/unnote", { id }).catch(fail);
  };
  const canBox = kind !== "text";

  return (
    <article
      className={cx(
        "flex min-w-0 flex-col gap-3 rounded-(--ui-radius-panel) border bg-(--ui-paper) p-3",
        sample.verdict ? VERDICT_ON[sample.verdict].split(" ")[0] : "border-(--ui-hair)",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-(--ui-ink-3)">#{n}</span>
        <span className="flex-1" />
        {canBox && (
          <Button
            size="dense"
            tone={boxing ? "primary" : "quiet"}
            icon="target"
            onClick={() => setBoxing((b) => !b)}
          >
            {boxing ? "Drag a box" : "Box"}
          </Button>
        )}
        <Button size="dense" tone="quiet" icon="pin" onClick={keep}>
          {sample.keptAt ? "Kept" : "Keep"}
        </Button>
      </div>
      <SampleBody
        kind={kind}
        sample={sample}
        boxing={boxing}
        pending={pending?.anchor ?? null}
        onAnchor={(anchor) => setPending({ anchor })}
      />
      {pending && (
        <NoteStrip anchor={pending.anchor} onSave={save} onCancel={() => setPending(null)} />
      )}
      {sample.notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {sample.notes.map((x) => (
            <li key={x.id} className="flex items-start gap-2 text-[13px]">
              <span
                className={cx(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  x.tone === "good"
                    ? "bg-(--ui-good)"
                    : x.tone === "bad"
                      ? "bg-(--ui-bad)"
                      : "bg-(--ui-ink-3)",
                )}
              />
              <span className="min-w-0 flex-1 wrap-anywhere text-(--ui-ink)">
                <span className="text-(--ui-ink-3)">{anchorLabel(x.anchor)}</span>
                {x.text ? ` ${x.text}` : ""}
              </span>
              <button
                type="button"
                aria-label="Remove note"
                className="cursor-pointer text-(--ui-ink-3) hover:text-(--ui-ink)"
                onClick={() => unnote(x.id)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        {VERDICTS.map((v) => (
          <button
            type="button"
            key={v.v}
            aria-pressed={sample.verdict === v.v}
            onClick={() => judge(v.v)}
            className={cx(
              "inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-(--ui-radius) border px-3 text-[13px] font-semibold transition-colors duration-150",
              sample.verdict === v.v
                ? VERDICT_ON[v.v]
                : "border-(--ui-hair) text-(--ui-ink-2) hover:bg-(--ui-hover)",
            )}
          >
            <Icon name={v.icon} size={14} />
            {v.label}
          </button>
        ))}
        <Button size="dense" tone="quiet" icon="note" onClick={() => setPending({ anchor: null })}>
          Note
        </Button>
      </div>
      {err && <div className="text-[12px] text-(--ui-bad)">{err}</div>}
    </article>
  );
}

function Subjects() {
  const got = useCall("variants-subjects", () => call<SubjectRow[]>("variants/subjects", {}));
  const [pick, setPick] = useState<number | null>(null);
  if (pick != null) return <SubjectDetail id={pick} onBack={() => setPick(null)} />;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading />;
  if (!got.data.length)
    return <Empty title="No subjects yet">Ask the agent in chat: “start variants for …”.</Empty>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {got.data.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => setPick(s.id)}
            className="flex w-full cursor-pointer items-center gap-3 border-b border-(--ui-hair) px-1 py-3 text-left hover:bg-(--ui-hover)"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-(--ui-ink)">{s.name}</span>
              <span className="block text-[12px] text-(--ui-ink-3)">
                {s.kind} · {s.samples} samples · {s.kept} kept
                {s.toPick ? ` · ${s.toPick} to pick` : ""}
              </span>
            </span>
            <Icon name="right" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SubjectDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const got = useCall(`variants-subject:${id}`, () =>
    call<SubjectView>("variants/subject", { id }),
  );
  const tip = useEdit(`variants:subject:${id}:tip`, "");
  const [guides, setGuides] = useState<Guide[]>([]);
  useEffect(() => setGuides(got.data?.guides ?? []), [got.data]);
  const leaders = useMemo(
    () => new Set(got.data?.leaders.slice(0, 3).map((l) => l.sample)),
    [got.data],
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading />;
  const v = got.data;
  const setState = (g: Guide, state: Guide["state"]) => {
    setGuides((gs) => gs.map((x) => (x.id === g.id ? { ...x, state } : x)));
    void call("variants/setGuide", { id: g.id, state });
  };
  const add = async () => {
    const text = tip.value.trim();
    if (!text) return;
    const row = await call<Guide>("variants/guide", { text, subject: v.subject.id });
    setGuides((gs) => [
      ...gs,
      {
        ...row,
        effect: { with: { good: 0, n: 0 }, without: { good: 0, n: 0 }, diff: null, early: true },
      },
    ]);
    tip.saved();
  };
  const closed = v.batches.filter((b) => b.state === "closed" && b.goodRate != null);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button size="dense" tone="quiet" icon="left" onClick={onBack}>
          Subjects
        </Button>
        <h2 className="m-0 mt-2 text-[18px] font-semibold text-(--ui-ink)">{v.subject.name}</h2>
        {v.subject.brief && <p className="m-0 text-[13px] text-(--ui-ink-2)">{v.subject.brief}</p>}
      </div>
      {closed.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">
            Good or better, per batch
          </h3>
          <div className="flex h-24 items-end gap-1.5">
            {closed.map((b) => (
              <div
                key={b.id}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                title={b.why}
              >
                <span className="text-[11px] text-(--ui-ink-3)">{pct(b.goodRate ?? 0)}</span>
                <div
                  className="w-full max-w-10 rounded-t-[3px] bg-(--ui-accent)"
                  style={{ height: `${Math.max(4, (b.goodRate ?? 0) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </section>
      )}
      {v.live && v.live.rows.length > 0 && <LiveView live={v.live} picks={v} />}
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">Guides</h3>
        {guides.map((g) => (
          <div
            key={g.id}
            className={cx(
              "flex flex-wrap items-center gap-2 border-b border-(--ui-hair) py-2",
              g.state === "dropped" && "opacity-50",
            )}
          >
            <span className="min-w-0 flex-1 text-[13px] wrap-anywhere text-(--ui-ink)">
              {g.text}
              <span className="block text-[12px] text-(--ui-ink-3)">
                {g.state === "locked"
                  ? "Locked rule"
                  : g.state === "dropped"
                    ? "Dropped"
                    : "Testing"}
                {" · "}
                {g.effect.early
                  ? `too early (${g.effect.with.n + g.effect.without.n} judged)`
                  : `good ${pct(g.effect.with.good / Math.max(1, g.effect.with.n))} with, ${pct(g.effect.without.good / Math.max(1, g.effect.without.n))} without`}
              </span>
            </span>
            {g.state !== "locked" && (
              <Button size="dense" onClick={() => setState(g, "locked")}>
                Lock
              </Button>
            )}
            {g.state !== "dropped" && (
              <Button size="dense" tone="quiet" onClick={() => setState(g, "dropped")}>
                Drop
              </Button>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Textarea
            rows={1}
            {...tip.field}
            placeholder="A tip to test on this subject"
            className="flex-1"
          />
          <Button onClick={add} disabled={!tip.value.trim()}>
            Add tip
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">Batches</h3>
        {[...v.batches].reverse().map((b) => (
          <div key={b.id} className="flex flex-col gap-1.5 border-b border-(--ui-hair) pb-3">
            <div className="text-[13px] text-(--ui-ink)">
              <span className="font-semibold">Batch {b.id}</span>
              <span className="text-(--ui-ink-3)">
                {" "}
                ·{" "}
                {b.state === "open"
                  ? "to pick"
                  : b.goodRate != null
                    ? `${pct(b.goodRate)} good`
                    : ""}
              </span>
            </div>
            <p className="m-0 text-[13px] text-(--ui-ink-2)">Agent: {b.why}</p>
            {b.note && <p className="m-0 text-[13px] text-(--ui-ink-2)">You: {b.note}</p>}
            <div className="flex flex-wrap gap-1.5">
              {b.samples.map((s) => (
                <span
                  key={s.id}
                  title={s.change ?? ""}
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[12px]",
                    s.verdict ? VERDICT_ON[s.verdict] : "border-(--ui-hair) text-(--ui-ink-3)",
                    leaders.has(s.id) && "ring-2 ring-(--ui-accent)",
                  )}
                >
                  {s.id}
                  {s.keptAt ? " · kept" : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Catalog() {
  const got = useCall("variants-catalog", () => call<Kept[]>("variants/catalog", {}));
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading />;
  if (!got.data.length)
    return <Empty title="Nothing kept yet">Tap Keep on a sample you want to reuse.</Empty>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {got.data.map((k) => (
        <article
          key={k.sample.id}
          className="flex min-w-0 flex-col gap-2 rounded-(--ui-radius-panel) border border-(--ui-hair) p-3"
        >
          <div className="text-[12px] text-(--ui-ink-3)">
            {k.subject.name} · #{k.sample.id}
          </div>
          <SampleBody
            kind={k.subject.kind}
            sample={{ ...k.sample, notes: [] }}
            boxing={false}
            onAnchor={() => {}}
          />
        </article>
      ))}
    </div>
  );
}

/** Open batches, for the tab's badge. */
export const toPick = async (): Promise<number> =>
  (await call<Open[]>("variants/queue", {}).catch(() => [])).length;
