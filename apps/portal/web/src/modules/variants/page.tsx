/**
 * Variants, its own app (designs/2026-11-05-variants.md). `MarkBatch`: one open batch, every
 * sample whole and blind; Amazing / Good / Bad, notes on a line, a region or a moment, then Hand
 * to Vireo: the batch closes and the side chat takes a turn that points at it (`agent/drive.ts`).
 * Batches: `./batches.tsx`, the open ones marked there. Subjects (in folders): batches, good rate,
 * guides under test. The agent writes through `wren variants`; these pages only judge.
 */
import {
  Button,
  cx,
  dragItem,
  Empty,
  FolderMoveMenu,
  type FolderNode,
  FolderTree,
  Icon,
  LoadFailed,
  Loading,
  Seg,
  Tag,
  Textarea,
  UnfiledDrop,
  useEdit,
} from "@wren/ui";
import { verdictOf } from "@wrenautomation/vireo/calls";
import { footageLength } from "@wrenautomation/vireo/sync";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "../../api.js";
import { useFolders } from "../../folders.js";
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
} from "./marks.js";
import { callLabel, ScoreBar, VERDICT_ON, ZONE_OF } from "./score.js";
import { FootageLanes, type SyncMode, Together, TogetherProvider } from "./together.js";
import { SubjectTree, type TreeSteer } from "./tree.js";
import { TreeGhost } from "./tree-ghost.js";

export const TALLY = ["amazing", "good", "okay", "bad"] as const;
export interface Open {
  batch: { id: number; n: number; title: string | null; createdAt: string; note: string | null };
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
export interface SubjectView {
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
  steers?: TreeSteer[];
  pruned?: number[];
}

export const WIDE_KINDS: readonly Kind[] = ["video", "page"];
/** A past call, read only: the kit's status tag in the call's tone. */
const TAG_OF = { amazing: "accent", good: "green", okay: "neutral", bad: "bad" } as const;

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
    `in view: ${open.subject.slug} (${open.subject.kind}), batch ${open.subject.slug}:${open.batch.n} (id ${open.batch.id}), ${judged} of ${open.samples.length} marked`,
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
        for (const s of rest) patch(s.id, (x) => ({ ...x, score: 2, verdict: "bad" }));
      }
      // the calls and notes are records; the chat gets one line that points at them
      await call("variants/close", { batch: open.batch.id, note: null });
      // first line = the chat's title
      handToChat(
        "vireo",
        none
          ? `Batch ${open.batch.n} of ${open.subject.slug}${open.batch.title ? `: ${open.batch.title}` : ""}\nNone of these: all ${open.samples.length} marked bad and closed. Read my notes, then tell me what you see.`
          : `Batch ${open.batch.n} of ${open.subject.slug}${open.batch.title ? `: ${open.batch.title}` : ""}\nMarked and closed: ${tally || "no calls"}${judged < open.samples.length ? `, ${open.samples.length - judged} unmarked` : ""}. Read my calls and notes, then tell me what you see.`,
      );
      onSent();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 @min-[720px]/main:pb-24">
      <p className="m-0 text-[12px] text-(--ui-ink-3)">
        {open.samples.length} samples, shown blind in random order. Mark what's good or bad. To say
        where, tap a line, mark an area or mark a moment.
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
            wide
              ? "grid-cols-1 @min-[1000px]/main:grid-cols-2"
              : "grid-cols-1 @min-[720px]/main:grid-cols-2",
          )}
        >
          <FramesProvider ids={open.samples.map((s) => s.id)}>
            {open.samples.map((s, i) => (
              <SampleCard key={s.id} n={i + 1} kind={open.subject.kind} sample={s} patch={patch} />
            ))}
          </FramesProvider>
        </div>
      </TogetherProvider>
      <div className="-mx-1 flex flex-col gap-2 border-t border-(--ui-hair) bg-(--ui-paper) p-3 @min-[720px]/main:sticky @min-[720px]/main:bottom-0 @min-[720px]/main:z-10 @min-[720px]/main:flex-row @min-[720px]/main:items-center @min-[720px]/main:justify-end @min-[720px]/main:pr-16">
        <span className="text-[12px] text-(--ui-ink-2) @min-[720px]/main:mr-auto">
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

  // a drag sends many scores: the last one wins, an older answer never rolls it back
  const sent = useRef(0);
  const judge = (score: number | null) => {
    const before = { score: sample.score, verdict: sample.verdict };
    const n = ++sent.current;
    patch(sample.id, (s) => ({ ...s, score, verdict: score == null ? null : verdictOf(score) }));
    call("variants/judge", { sample: sample.id, score }).catch((e) => {
      if (n !== sent.current) return;
      patch(sample.id, (s) => ({ ...s, ...before }));
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
  const shown = sample.verdict ? ZONE_OF[sample.verdict] : null;
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
        {/* number + name: one header; a long name wraps under itself, actions wrap below */}
        <span
          className={cx(
            "flex min-w-0 items-baseline gap-2",
            staged ? "flex-[0_1_auto]" : "flex-[1_1_14rem]",
          )}
        >
          <span className="text-[12px] font-semibold whitespace-nowrap tabular-nums text-(--ui-ink-2)">
            #{n}
            {staged && ` of ${frames?.ids.length}`}
          </span>
          {sample.name && (
            <span className="min-w-0 text-[14px]/[1.35] font-semibold wrap-anywhere text-(--ui-ink)">
              {sample.name}
            </span>
          )}
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
            icon="area"
            aria-pressed={boxing}
            onClick={() => setBoxing((b) => !b)}
          >
            {boxing ? "Drag over a part" : "Mark an area"}
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
                {sample.score == null ? shown.label : callLabel(sample.score)}
              </span>
            </Tag>
          </div>
        )
      ) : (
        <div className={cx("mt-auto flex flex-wrap items-start gap-2", staged && "justify-center")}>
          <ScoreBar score={sample.score} onScore={judge} staged={staged} />
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

export function SubjectsPage({ params, team }: PageProps) {
  const got = useCall("variants-subjects", () => call<SubjectRow[]>("variants/subjects", {}));
  const filed = useFolders("subject", team);
  const pick = Number(params.get("subject")) || null;
  const setPick = (id: number | null) =>
    navigate(href("/variants/subjects", { subject: id }, params));
  if (pick != null) return <SubjectDetail id={pick} params={params} onBack={() => setPick(null)} />;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading />;
  if (!got.data.length)
    return <Empty title="No subjects yet">Ask the agent in chat: “start variants for …”.</Empty>;
  const rows = got.data;
  const folders = filed.folders;
  const folderOf = (s: SubjectRow) => filed.folderOf(String(s.id));
  const row = (s: SubjectRow) => (
    <SubjectItem s={s} onOpen={() => setPick(s.id)} folders={folders} filed={filed} />
  );
  if (!folders)
    return (
      <ul className="m-0 grid max-w-[760px] list-none gap-px p-0">
        {rows.map((s) => (
          <li key={s.id}>{row(s)}</li>
        ))}
      </ul>
    );
  const loose = rows.filter((s) => folderOf(s) == null);
  return (
    <div className="grid max-w-[760px] gap-5">
      <FolderTree
        id="subjects"
        folders={folders}
        items={rows}
        keyOf={(s) => String(s.id)}
        folderOf={folderOf}
        renderItem={row}
        acts={filed.acts}
        noun={(n) => (n === 1 ? "subject" : "subjects")}
      />
      <UnfiledDrop acts={filed.acts} className="grid gap-px">
        {folders.length > 0 && loose.length > 0 && (
          <h3 className="m-0 px-2.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">No folder</h3>
        )}
        <ul className="m-0 grid list-none gap-px p-0">
          {loose.map((s) => (
            <li key={s.id} {...dragItem(String(s.id))}>
              {row(s)}
            </li>
          ))}
        </ul>
      </UnfiledDrop>
    </div>
  );
}

/** One subject: its name and counts; with folders, its ⋯ files it. */
function SubjectItem({
  s,
  onOpen,
  folders,
  filed,
}: {
  s: SubjectRow;
  onOpen: () => void;
  folders: readonly FolderNode[] | null;
  filed: ReturnType<typeof useFolders>;
}) {
  return (
    <div className="group/subject relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] border-0 bg-transparent py-2 pr-2.5 pl-3 text-left transition-[background-color] duration-150 hover:bg-(--ui-fill) focus-visible:outline-offset-[-2px]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px]/[1.4] font-medium wrap-anywhere text-(--ui-ink)">
            {s.name}
          </span>
          <span className="block text-[12px] text-(--ui-ink-3) tabular-nums">
            <span className="capitalize">{s.kind}</span> · {s.samples} samples · {s.kept} kept
            {s.toPick ? ` · ${s.toPick} open` : ""}
          </span>
        </span>
        <Icon
          name="right"
          size={14}
          className={cx(
            "flex-none text-(--ui-ink-3)",
            // ⋯ takes its place on hover
            folders &&
              "transition-opacity duration-150 group-hover/subject:opacity-0 group-focus-within/subject:opacity-0 pointer-coarse:opacity-0",
          )}
        />
      </button>
      {folders ? (
        <FolderMoveMenu
          title={s.name}
          folders={folders}
          current={filed.folderOf(String(s.id))}
          acts={filed.acts}
          itemKey={String(s.id)}
          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/subject:opacity-100 group-focus-within/subject:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
        />
      ) : null}
    </div>
  );
}

function SubjectDetail({
  id,
  params,
  onBack,
}: {
  id: number;
  params: URLSearchParams;
  onBack: () => void;
}) {
  const got = useCall(`variants-subject:${id}`, () =>
    call<SubjectView>("variants/subject", { id }),
  );
  const tip = useEdit(`variants:subject:${id}:tip`, "");
  const [guides, setGuides] = useState<Guide[]>([]);
  useEffect(() => setGuides(got.data?.guides ?? []), [got.data]);
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <TreeGhost />;
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
    <div className="vt-in flex flex-col gap-6">
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
      <SubjectTree
        subject={v.subject}
        batches={v.batches}
        guides={guides}
        params={params}
        steers={v.steers ?? []}
        pruned={v.pruned}
        onSteered={got.retry}
      />
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
