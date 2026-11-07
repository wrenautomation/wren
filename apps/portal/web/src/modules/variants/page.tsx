/**
 * Variants, its own app (designs/2026-11-05-variants.md). `MarkBatch`: one open batch, every
 * sample whole and blind; Amazing / Good / Bad, notes on a line, a region or a moment, then Hand
 * to Vireo: the batch closes and the side chat takes a turn that points at it (`agent/drive.ts`).
 * Batches: `./batches.tsx`, the open ones marked there. Subjects: each one's batches, good rate,
 * guides under test. The agent writes through `wren variants`; these pages only judge.
 */
import {
  Button,
  cx,
  Empty,
  Icon,
  LoadFailed,
  Loading,
  Seg,
  Tag,
  Textarea,
  useEdit,
} from "@wren/ui";
import { footageLength } from "@wrenautomation/vireo/sync";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { handToChat, usePageContext } from "../agent/drive.js";
import { type Live, LiveView } from "./live.js";
import { FramesProvider, useFrames, WIDTHS } from "./live-page.js";
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
import { SubjectTree } from "./tree.js";

type Verdict = Sample["verdict"];
export const TALLY = ["amazing", "good", "bad"] as const;
export interface Open {
  batch: { id: number; n: number; createdAt: string; note: string | null };
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
  decidedAt?: string | null;
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
    closedAt?: string | null;
    goodRate: number | null;
    samples: (Sample & {
      change: string | null;
      name?: string | null;
      parents?: { id: number; took: string | null }[];
    })[];
  }[];
  leaders: { sample: number; strength: number; se: number }[];
  live?: Live;
}

const VERDICTS: { v: NonNullable<Verdict>; label: string; icon: "star" | "check" | "close" }[] = [
  { v: "amazing", label: "Amazing", icon: "star" },
  { v: "good", label: "Good", icon: "check" },
  { v: "bad", label: "Bad", icon: "close" },
];
export const WIDE_KINDS: readonly Kind[] = ["video", "page"];
/** A past call, read only: the kit's status tag in the call's tone. */
const TAG_OF = { amazing: "accent", good: "green", bad: "bad" } as const;

/** One open batch to mark, blind; Hand to Vireo closes it. */
export function MarkBatch({
  open,
  patch,
  onSent,
}: {
  open: Open;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const judged = open.samples.filter((s) => s.verdict).length;
  const tally = TALLY.map((t) => [t, open.samples.filter((s) => s.verdict === t).length] as const)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
  usePageContext(
    `in view: ${open.subject.slug} (${open.subject.kind}), batch ${open.batch.n} (id ${open.batch.id}), ${judged} of ${open.samples.length} marked`,
  );
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
  const anyGood = open.samples.some((s) => s.verdict === "amazing" || s.verdict === "good");
  /** none = "None of these": every unmarked sample bad, then close, in one action */
  const send = async (none = false) => {
    setBusy(true);
    setErr(null);
    try {
      if (none) {
        const rest = open.samples.filter((s) => !s.verdict);
        await Promise.all(
          rest.map((s) => call("variants/judge", { sample: s.id, verdict: "bad" })),
        );
        for (const s of rest) patch(s.id, (x) => ({ ...x, verdict: "bad" }));
      }
      // the calls and notes are records; the chat gets one line that points at them
      await call("variants/close", { batch: open.batch.id, note: null });
      // first line = the chat's title
      handToChat(
        "vireo",
        none
          ? `Batch ${open.batch.n} of ${open.subject.slug}\nNone of these: all ${open.samples.length} marked bad and closed. Read my notes, then tell me what you see.`
          : `Batch ${open.batch.n} of ${open.subject.slug}\nMarked and closed: ${tally || "no calls"}${judged < open.samples.length ? `, ${open.samples.length - judged} unmarked` : ""}. Read my calls and notes, then tell me what you see.`,
      );
      onSent();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 md:pb-24">
      <p className="m-0 text-[12px] text-(--ui-ink-3)">
        {open.samples.length} samples, shown blind in random order. Mark what's good or bad; tap a
        line, drag a box or mark a moment to say where.
        {open.samples.some((s) => open.subject.kind === "page" && s.mediaUrl) &&
          " One page runs at a time."}
      </p>
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
          <FramesProvider ids={open.samples.map((s) => s.id)}>
            {open.samples.map((s, i) => (
              <SampleCard key={s.id} n={i + 1} kind={open.subject.kind} sample={s} patch={patch} />
            ))}
          </FramesProvider>
        </div>
      </TogetherProvider>
      <div className="-mx-1 flex flex-col gap-2 border-t border-(--ui-hair) bg-(--ui-paper) p-3 md:sticky md:bottom-0 md:z-10 md:flex-row md:items-center md:justify-end md:pr-16">
        <span className="text-[12px] text-(--ui-ink-2) md:mr-auto">
          Your guide for the next batch goes in the chat.
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[12px] whitespace-nowrap text-(--ui-ink-3)">
            {judged} of {open.samples.length} marked
          </span>
          {!anyGood && (
            <Button tone="quiet" onClick={() => send(true)} disabled={busy}>
              None of these
            </Button>
          )}
          <Button tone="primary" icon="send" onClick={() => send()} disabled={busy || judged === 0}>
            Hand to Vireo
          </Button>
        </div>
        {err && <div className="text-[12px] text-(--ui-bad)">{err}</div>}
      </div>
    </div>
  );
}

export function SampleCard({
  n,
  kind,
  sample,
  patch,
  closed,
}: {
  n: number;
  kind: Kind;
  sample: Sample;
  patch: (id: number, fn: (s: Sample) => Sample) => void;
  /** A closed batch's sample: his call and notes read only, with the idea it tested. */
  closed?: { change: string | null };
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
  const canBox = kind !== "text" && !closed;
  const shown = VERDICTS.find((v) => v.v === sample.verdict);
  const frames = useFrames();
  const staged = frames?.stage === sample.id;
  const step = (by: number) => {
    const to =
      frames?.ids[(frames.ids.indexOf(sample.id) + by + frames.ids.length) % frames.ids.length];
    if (to != null) frames?.show(to);
  };
  // on stage: the list under it holds still; keys work while focus is ours (the frame keeps its own)
  // biome-ignore lint/correctness/useExhaustiveDependencies: bound once per stage
  useEffect(() => {
    if (!staged) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea")) return;
      if (e.key === "Escape") frames?.show(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = was;
      window.removeEventListener("keydown", key);
    };
  }, [staged]);

  const card = (
    <article
      className={cx(
        "flex min-w-0 flex-col gap-3 bg-(--ui-paper) p-3",
        staged ? "fixed inset-0 z-50" : "rounded-(--ui-radius-panel) border",
        !staged &&
          (sample.verdict ? VERDICT_ON[sample.verdict].split(" ")[0] : "border-(--ui-hair)"),
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold whitespace-nowrap text-(--ui-ink-3)">
          #{n}
          {staged && ` of ${frames?.ids.length}`}
        </span>
        {staged && (
          <>
            <Button size="dense" tone="quiet" icon="left" onClick={() => step(-1)}>
              <span className="max-sm:sr-only">Back</span>
            </Button>
            <Button size="dense" tone="quiet" icon="right" onClick={() => step(1)}>
              <span className="max-sm:sr-only">Next</span>
            </Button>
            {/* a narrow window scales both widths: nothing to choose there */}
            <span className="ml-2 max-sm:hidden">
              <Seg
                dense
                label="Width"
                items={WIDTHS}
                value={frames?.width ?? "desktop"}
                onChange={(w) => frames?.setWidth(w)}
              />
            </span>
          </>
        )}
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
        {staged && (
          <Button size="dense" icon="shrink" onClick={() => frames?.show(null)}>
            <span className="max-sm:sr-only">Exit</span>
          </Button>
        )}
      </div>
      {closed?.change && (
        <p className="m-0 text-[13px] text-(--ui-ink-2)">
          <span className="text-(--ui-ink-3)">Tested: </span>
          {closed.change}
        </p>
      )}
      <SampleBody
        kind={kind}
        sample={sample}
        boxing={boxing}
        pending={pending?.anchor ?? null}
        onAnchor={(anchor) => !closed && setPending({ anchor })}
      />
      {pending && (
        <NoteStrip anchor={pending.anchor} onSave={save} onCancel={() => setPending(null)} />
      )}
      {sample.notes.length > 0 && (
        <ul
          className={cx(
            "m-0 flex list-none flex-col gap-1 p-0",
            staged && "max-h-24 shrink-0 overflow-y-auto",
          )}
        >
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
              {!closed && (
                <button
                  type="button"
                  aria-label="Remove note"
                  className="cursor-pointer text-(--ui-ink-3) hover:text-(--ui-ink)"
                  onClick={() => unnote(x.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {closed ? (
        shown && (
          <div className={cx("mt-auto flex", staged && "justify-center")}>
            <Tag tone={TAG_OF[shown.v]}>
              <span className="inline-flex items-center gap-1">
                <Icon name={shown.icon} size={12} />
                {shown.label}
              </span>
            </Tag>
          </div>
        )
      ) : (
        <div className={cx("mt-auto flex flex-wrap gap-2", staged && "justify-center")}>
          {VERDICTS.map((v) => (
            <button
              type="button"
              key={v.v}
              aria-pressed={sample.verdict === v.v}
              onClick={() => judge(v.v)}
              className={cx(
                "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-(--ui-radius) border text-[13px] font-semibold transition-colors duration-150",
                // on stage a control hugs its words; in a card the three share the row
                staged ? "px-5 max-sm:px-3" : "flex-1 px-3",
                sample.verdict === v.v
                  ? VERDICT_ON[v.v]
                  : "border-(--ui-hair) text-(--ui-ink-2) hover:bg-(--ui-hover)",
              )}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
          <Button
            size="dense"
            tone="quiet"
            icon="note"
            onClick={() => setPending({ anchor: null })}
          >
            Note
          </Button>
        </div>
      )}
      {err && <div className="text-[12px] text-(--ui-bad)">{err}</div>}
    </article>
  );
  return staged ? createPortal(card, document.body) : card;
}

export function SubjectsPage({ params }: PageProps) {
  const got = useCall("variants-subjects", () => call<SubjectRow[]>("variants/subjects", {}));
  const pick = Number(params.get("subject")) || null;
  const setPick = (id: number | null) =>
    navigate(href("/variants/subjects", { subject: id }, params));
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
                {s.toPick ? ` · ${s.toPick} open` : ""}
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
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div>
          <Button size="dense" tone="quiet" icon="left" onClick={onBack}>
            Subjects
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <h2 className="m-0 text-[22px]/[1.2] font-bold tracking-[-0.01em] text-(--ui-ink)">
            {v.subject.name}
          </h2>
          <Tag>Vireo</Tag>
          <span className="text-[13px] text-(--ui-ink-3) capitalize">{v.subject.kind}</span>
        </div>
        {v.subject.brief && (
          <p className="m-0 max-w-[70ch] text-[13px] text-(--ui-ink-2)">{v.subject.brief}</p>
        )}
      </div>
      <SubjectTree subject={v.subject} batches={v.batches} guides={guides} />
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
    </div>
  );
}

/** Open batches, for the Batches tab's badge. */
export const openBatches = async (): Promise<number> =>
  (await call<Open[]>("variants/queue", {}).catch(() => [])).length;
