/**
 * A video's detail (`marketing.video`), edited in place (designs/2026-10-06-video-editor.md, step
 * 4): the preview; the title, description, tags, chapters, Shorts titles and thumbnail text, each
 * saved on blur; the cuts with the words they strike, Keep or Cut; a span of transcript words
 * picked and cut; Ask Claude with Undo. Step 5: the formats it renders as, the vertical cut's
 * preview, and a misheard word fixed in the transcript (one word, or every match). Step 6: the
 * caption style, stressed words behind the speaker, and stressed words marked and toggled in the
 * transcript. Every change is
 * `VideoDesk` on the record's inline actions. Render is the head action; its state shows on the
 * record.
 */

import type { Storyboard as Board } from "@wren/studio/storyboard";
import type { DraftTurnLine, RecordAct, RecordExtras } from "@wren/ui";
import {
  ACTIONS,
  answerIn,
  Button,
  cx,
  DictateField,
  DraftTurns,
  Empty,
  Input,
  SaveConflict,
  SaveStatus,
  Tag,
  Textarea,
  TextField,
  tipProps,
  useEdit,
  useEditForm,
  useSaved,
} from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ListPage } from "../../module.js";
import { href } from "../../route.js";
import { Finish, type FinishData } from "./finish.js";
import { EditorTabs, StoryboardView } from "./storyboard.js";
import { VIEWED } from "./video-patch.js";

type Word = {
  w: string;
  s: number;
  e: number;
  cut: "cut" | "proposed" | null;
  stress?: boolean;
};
type CutRow = {
  from: number;
  to: number;
  why: "silence" | "filler" | "retake" | "manual";
  state: "cut" | "proposed" | "kept";
  lengthS: number;
  words: string;
  before: string;
  after: string;
};
type Short = {
  from: number;
  to: number;
  title: string;
  card?: boolean | undefined;
  cardText?: string | undefined;
};
type Format = "long" | "vertical";
/** `long`/`short`: burned in (`screen`) or not; `on` is a row from before per-format captions. */
type Captions = {
  style: string;
  long?: "screen" | "track";
  short?: "screen" | "track";
  behind?: boolean;
  on?: boolean;
};
type Edit = {
  captions?: Captions;
  stress?: number[];
  title: string;
  description: string;
  tags: string[];
  chapters: { at: number; title: string }[];
  shorts: Short[];
  formats: Format[];
  thumbnail: { at: number; text: string } | null;
};
type Turn = Omit<DraftTurnLine, "draft"> & { fields: string[] | null };
type Video = {
  preview: string | null;
  words: Word[];
  shorts: (Short & {
    preview: string | null;
    upload: { status: string; url: string | null } | null;
  })[];
  thumbnails: { url: string | null; picked: boolean }[];
  /** The whole cut, 9:16, once rendered. */
  vertical: {
    preview: string | null;
    upload: { status: string; url: string | null } | null;
  } | null;
  edit: Edit;
  cuts: CutRow[];
  /** Its promo drafts, latest per platform; null until it's approved for YouTube. */
  promos?: Promo[] | null;
  render: { state: string; why?: string } | null;
  state: string;
  turns: Turn[];
  /** What the finishing view draws and saves (content `finishOf`). */
  finish?: FinishData;
  /** Every video run on it, oldest first (content `videoSteps`). */
  steps?: Step[];
  /** What to look at before Approve (content `videoChecks`). */
  checks?: Check[];
  /** Beside the preview: whether it shows the last change. */
  fresh?: Check | null;
  /** False while the transcript has no sentence ends. */
  punctuated?: boolean;
  /** What each look proposed, newest first (content `looksOf`). */
  looks?: Look[];
  /** The edit as frames (studio `storyboardOf`). */
  storyboard?: Board;
};
type Look = {
  by: string;
  at: string;
  summary: string;
  shorts: { from: number; to: number; title: string }[];
  chapters: { at: number; title: string }[];
  thumbnails: { at: number; why: string }[];
  moments: { at: number; why: string }[];
};
type Step = {
  id: string;
  command: string;
  by: string | null;
  at: string;
  state: "running" | "failed" | "done";
  what: string;
  error: string | null;
  reply: string | null;
  notes: string[] | null;
  note: string | null;
};
type Check = { tone: "good" | "warn" | "bad" | "neutral"; say: string };
type Promo = {
  id: string;
  platform: string;
  /** A platform's post, the X thread, or one of the carousel's two drafts. */
  kind?: "post" | "thread" | "carousel";
  status: string;
  text: string;
};

const SET = "marketing.videoSet";
const CUT = "marketing.videoCut";
const ASK = "marketing.videoAsk";
const UNDO = "marketing.videoUndo";
const AGENT = "marketing.videoAgent";
const WORDS = "marketing.videoWords";
const STRESS = "marketing.videoStress";
const PUNCTUATE = "marketing.videoPunctuate";
const POLL_MS = 4000;
const RENDER_POLL_MS = 15_000;
/** Before this it renders; after, the cut file and its upload are settled. */
const EDITABLE = ["added", "edited", "rendered"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** "1:05" or "65" as seconds; NaN when it's neither. */
const seconds = (t: string) => {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t.trim());
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : Number.NaN;
};
const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One press of an edit action: a second press while it's out gets the first's answer, and the
 * call carries a `requestId` that stays the same on a retry.
 */
const once = (act: RecordAct, action: string, input: Record<string, unknown> = {}) =>
  ACTIONS.run(`video:${action}:${JSON.stringify(input)}`, (requestId) =>
    act(action, { ...input, requestId }, VIEWED),
  );

const Player = ({ src }: { src: string | null }) =>
  src ? (
    // biome-ignore lint/a11y/useMediaCaption: captions are burned in or a YouTube CC track.
    <video controls preload="metadata" src={src} className="w-full rounded bg-black" />
  ) : (
    <Empty>The preview shows here once the video is rendered.</Empty>
  );

/**
 * One field of the edit, saved through the engine on blur, Enter (one line), a hidden tab or a
 * closed page; what he typed waits on the device until the server holds it. `patch` turns the
 * text into the change, or throws why it can't; unchanged text saves nothing.
 */
function Field({
  video,
  label,
  value,
  patch,
  act,
  lines = 1,
  hint,
  max,
}: {
  /** The video's id: the field's journal is per video. */
  video: string;
  label: string;
  value: string;
  patch: (text: string) => Record<string, unknown>;
  act: RecordAct;
  lines?: number;
  hint?: string;
  max?: number;
}) {
  const s = useSaved<string>({
    key: `video:${video}:${label}`,
    server: value,
    same: (a, b) => a.trim() === b.trim(),
    // One save when he leaves the field, never one per pause: each save renders a new preview.
    delay: null,
    save: async (text, { request }) => {
      const words = text.trim();
      await act(SET, { patch: patch(words), requestId: request }, VIEWED);
      return { value: words };
    },
  });
  const id = `video-${label.toLowerCase().replaceAll(" ", "-")}`;
  const common = {
    id,
    "data-edit": `video:${video}:${label}`,
    value: s.value,
    maxLength: max,
    onBlur: () => void s.flush(),
    className: "text-[14px]",
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-(--ui-ink-2)">
          {label}
        </label>
        <SaveStatus state={s} onRetry={s.retry} idle={s.dirty ? "Edited" : null} />
      </div>
      {lines > 1 ? (
        <Textarea {...common} rows={lines} onChange={(e) => s.set(e.target.value)} />
      ) : (
        <Input
          {...common}
          onChange={(e) => s.set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void s.flush();
            }
          }}
        />
      )}
      {s.conflict ? (
        <SaveConflict conflict={s.conflict} onKeepMine={s.keepMine} onTakeTheirs={s.takeTheirs} />
      ) : null}
      {hint ? <span className="text-[12px] text-(--ui-ink-3)">{hint}</span> : null}
    </div>
  );
}

/** "0:00 Intro" lines as chapters, on the raw recording's clock. */
function chaptersOf(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [t = "", ...rest] = l.split(/\s+/);
      const at = seconds(t);
      if (Number.isNaN(at) || !rest.length) throw new Error(`"${l}": write it as 1:05 Title`);
      return { at, title: rest.join(" ") };
    });
}

const FORMATS: [Format, string, string][] = [
  ["long", "Long", "16:9, the screen with your face in the corner"],
  ["vertical", "Vertical", "9:16, the whole video for Shorts and Reels"],
];

/** Which shapes Render makes; at least one. Saved on each tick. */
/** One choice of the edit saved through the engine: on a quick run of clicks, one save. */
function useChoiceSaved<T>(key: string, server: T, act: RecordAct, patch: (v: T) => object) {
  return useSaved<T>({
    key,
    server,
    delay: 600,
    save: async (value, { request }) => {
      await act(SET, { patch: patch(value), requestId: request }, VIEWED);
      return { value };
    },
  });
}

function Formats({ video, formats, act }: { video: string; formats: Format[]; act: RecordAct }) {
  const s = useChoiceSaved(`video:${video}:formats`, formats, act, (formats) => ({ formats }));
  const [none, setNone] = useState(false);
  const flip = (f: Format, on: boolean) => {
    // Square and 4:5 are the finishing view's; a flip here keeps them.
    const kept = s.value.filter((x) => !FORMATS.some(([y]) => y === x));
    const next = [
      ...FORMATS.map(([x]) => x).filter((x) => (x === f ? on : s.value.includes(x))),
      ...kept,
    ];
    setNone(!next.length);
    if (next.length) s.set(next);
  };
  return (
    <fieldset className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <legend className="text-[13px] font-medium text-(--ui-ink-2)">Formats</legend>
        {none ? (
          <span aria-live="polite" className="text-[12px] text-(--ui-bad)">
            Keep at least one.
          </span>
        ) : (
          <SaveStatus state={s} onRetry={s.retry} />
        )}
      </div>
      {FORMATS.map(([f, label, hint]) => (
        <label key={f} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={s.value.includes(f)}
            onChange={(e) => flip(f, e.target.checked)}
            className="mt-1 size-4 accent-(--ui-active)"
          />
          <span className="grid gap-0.5">
            <span className="text-[14px]">{label}</span>
            <span className="text-[13px] text-(--ui-ink-2)">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const STYLES: [string, string, string][] = [
  ["word", "Word", "The word you're saying on your colour."],
  ["pill", "Pill", "The line on a dark pill. Each word lights up as you say it."],
  ["sweep", "Sweep", "Your colour sweeps in behind each word."],
  ["pop", "Pop", "Each word squeezes in as you say it."],
  ["wipe", "Wipe", "Each word wipes in from the left."],
  ["stress", "Stress", "Stressed words show bigger, in a heavier face."],
];

/** Where each format's captions show, as the render reads them (studio `onScreen`). */
const SHOWS = [
  [
    "long",
    "On screen in the long video",
    "When off, viewers turn on English subtitles with CC on YouTube.",
  ],
  ["short", "On screen in the vertical and Shorts", "Short clips are often watched muted."],
] as const;
const shown = (c: Captions, f: "long" | "short") =>
  f === "long"
    ? c.long === "screen"
    : (c.short ?? (c.on === false ? "track" : "screen")) === "screen";

/** The caption style, where they show, and the stressed words behind him. Saved as he picks. */
function CaptionStyle({
  video,
  captions: server,
  act,
}: {
  video: string;
  captions: Captions;
  act: RecordAct;
}) {
  const s = useChoiceSaved(`video:${video}:captions`, server, act, (captions) => ({ captions }));
  const captions = s.value;
  const save = (next: Captions) => s.set(next);
  return (
    <fieldset className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <legend className="text-[13px] font-medium text-(--ui-ink-2)">Captions</legend>
        <SaveStatus state={s} onRetry={s.retry} />
      </div>
      {STYLES.map(([style, label, hint]) => (
        <label key={style} className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name="caption-style"
            checked={captions.style === style}
            onChange={() => save({ ...captions, style })}
            className="mt-1 size-4 accent-(--ui-active)"
          />
          <span className="grid gap-0.5">
            <span className="text-[14px]">{label}</span>
            <span className="text-[13px] text-(--ui-ink-2)">{hint}</span>
          </span>
        </label>
      ))}
      {SHOWS.map(([f, label, hint]) => (
        <label key={f} className="mt-1 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={shown(captions, f)}
            onChange={(e) => save({ ...captions, [f]: e.target.checked ? "screen" : "track" })}
            className="mt-1 size-4 accent-(--ui-active)"
          />
          <span className="grid gap-0.5">
            <span className="text-[14px]">{label}</span>
            <span className="text-[13px] text-(--ui-ink-2)">{hint}</span>
          </span>
        </label>
      ))}
      <label className="mt-1 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={!!captions.behind}
          onChange={(e) => save({ ...captions, behind: e.target.checked })}
          className="mt-1 size-4 accent-(--ui-active)"
        />
        <span className="grid gap-0.5">
          <span className="text-[14px]">Stressed words behind you</span>
          <span className="text-[13px] text-(--ui-ink-2)">
            Each shows big, between the background and you. Mark them in the transcript.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/** `finishing`: shapes and captions are the finishing view's, so they show there only. */
function Fields({
  id,
  edit,
  act,
  finishing,
}: {
  id: string;
  edit: Edit;
  act: RecordAct;
  finishing?: boolean;
}) {
  const thumb = edit.thumbnail;
  return (
    <div className="grid gap-4">
      {finishing ? null : <Formats video={id} formats={edit.formats} act={act} />}
      {finishing ? null : (
        <CaptionStyle video={id} captions={edit.captions ?? { style: "word" }} act={act} />
      )}
      <Field
        video={id}
        label="Title"
        value={edit.title}
        max={100}
        act={act}
        patch={(title) => ({ title })}
      />
      <Field
        video={id}
        label="Description"
        value={edit.description}
        max={5000}
        lines={6}
        act={act}
        patch={(description) => ({ description })}
      />
      <Field
        video={id}
        label="Tags"
        value={edit.tags.join(", ")}
        hint="Comma between tags."
        act={act}
        patch={(t) => ({
          tags: t
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        })}
      />
      <Field
        video={id}
        label="Chapters"
        value={edit.chapters.map((c) => `${clock(c.at)} ${c.title}`).join("\n")}
        lines={4}
        hint="One a line: 1:05 Title, at the time in the recording. YouTube needs 3 or more."
        act={act}
        patch={(t) => ({ chapters: chaptersOf(t) })}
      />
      {(finishing ? [] : edit.shorts).map((s, i) => (
        <Field
          video={id}
          key={`${s.from}-${s.to}`}
          label={`Short ${i + 1} title`}
          value={s.title}
          max={100}
          hint={`${clock(s.from)} to ${clock(s.to)} in the recording`}
          act={act}
          patch={(title) => ({
            shorts: edit.shorts.map((x, j) => (j === i ? { ...x, title } : x)),
          })}
        />
      ))}
      <Field
        video={id}
        label="Thumbnail text"
        value={thumb?.text ?? ""}
        max={60}
        hint={
          thumb
            ? `On the frame at ${clock(thumb.at)}. Empty takes the thumbnail off.`
            : "Words on the thumbnail, over the first frame."
        }
        act={act}
        patch={(text) => ({ thumbnail: text ? { at: thumb?.at ?? 0, text } : null })}
      />
    </div>
  );
}

const WHY: Record<CutRow["why"], string> = {
  silence: "Silence",
  filler: "Filler",
  retake: "Retake",
  manual: "Yours",
};

/** One cut: the words it strikes between the ones either side, and Keep or Cut. */
function CutLine({ c, act }: { c: CutRow; act: RecordAct }) {
  const [busy, setBusy] = useState<"cut" | "kept" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = async (state: "cut" | "kept") => {
    setBusy(state);
    setError(null);
    try {
      await once(act, CUT, { from: c.from, to: c.to, state });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="grid min-w-0 gap-2 border-b border-(--ui-hair) py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-(--ui-ink-2)">
        <span>{clock(c.from)}</span>
        <Tag tone={c.state === "proposed" ? "accent" : "neutral"}>{WHY[c.why]}</Tag>
        <span>{c.lengthS.toFixed(1)}s</span>
        {c.state === "kept" ? (
          <span>Kept</span>
        ) : c.state === "proposed" ? (
          <span>Proposed</span>
        ) : null}
      </div>
      <p className="text-[14px] leading-[1.6] break-words">
        <span className="text-(--ui-ink-3)">…{c.before} </span>
        <span className={c.state === "kept" ? "" : "line-through decoration-(--ui-bad)"}>
          {c.words || "(a pause)"}
        </span>
        <span className="text-(--ui-ink-3)"> {c.after}…</span>
      </p>
      <div className="flex gap-2">
        {c.state !== "cut" ? (
          <Button size="dense" busy={busy === "cut"} onClick={() => void set("cut")}>
            Cut
          </Button>
        ) : null}
        {c.state !== "kept" ? (
          <Button tone="quiet" size="dense" busy={busy === "kept"} onClick={() => void set("kept")}>
            Keep
          </Button>
        ) : null}
      </div>
      {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
    </li>
  );
}

/** The proposals first; his and the kept ones next; the silence cuts folded. */
function Cuts({ cuts, act }: { cuts: CutRow[]; act: RecordAct }) {
  const proposed = cuts.filter((c) => c.state === "proposed");
  const chosen = cuts.filter((c) => c.state !== "proposed" && c.why !== "silence");
  const silence = cuts.filter((c) => c.state !== "proposed" && c.why === "silence");
  const line = (c: CutRow) => <CutLine key={`${c.from}-${c.to}`} c={c} act={act} />;
  return (
    <div className="grid gap-2">
      {proposed.length ? (
        <ol className="m-0 list-none p-0">{proposed.map(line)}</ol>
      ) : (
        <p className="text-[14px] text-(--ui-ink-2)">No proposals wait on you.</p>
      )}
      {chosen.length ? <ol className="m-0 list-none p-0">{chosen.map(line)}</ol> : null}
      {silence.length ? (
        <details>
          <summary className="w-fit cursor-pointer text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
            {silence.length} silences cut,{" "}
            {silence
              .filter((c) => c.state === "cut")
              .reduce((n, c) => n + c.lengthS, 0)
              .toFixed(1)}
            s in all
          </summary>
          <ol className="m-0 list-none p-0">{silence.map(line)}</ol>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The words, cuts struck through (proposals on the accent wash). Pick a span of words and cut it:
 * the bar under it says how many and from when.
 */
function Transcript({
  video,
  words,
  act,
  edit,
  stress = [],
}: {
  /** The video's id: a half-typed fix is kept per word. */
  video: string;
  words: Word[];
  act: RecordAct;
  edit: boolean;
  stress?: number[];
}) {
  const box = useRef<HTMLParagraphElement>(null);
  const [span, setSpan] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!edit) return;
    const index = (n: Node | null) => {
      const el = n instanceof Element ? n : n?.parentElement;
      const i = el?.closest("[data-i]")?.getAttribute("data-i");
      return i == null ? null : Number(i);
    };
    const pick = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !box.current?.contains(sel.anchorNode)) return setSpan(null);
      const a = index(sel.anchorNode);
      const b = index(sel.focusNode);
      setSpan(a === null || b === null ? null : [Math.min(a, b), Math.max(a, b)]);
    };
    document.addEventListener("selectionchange", pick);
    return () => document.removeEventListener("selectionchange", pick);
  }, [edit]);
  const first = span ? words[span[0]] : undefined;
  const last = span ? words[span[1]] : undefined;
  const cut = async () => {
    if (!first || !last) return;
    setBusy(true);
    setError(null);
    try {
      await once(act, CUT, { from: first.s, to: last.e, state: "cut" });
      document.getSelection()?.removeAllRanges();
      setSpan(null);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  const n = span ? span[1] - span[0] + 1 : 0;
  // One word picked: stress it, or take its stress off.
  const stressed = !!span && n === 1 && stress.includes(span[0]);
  const toggleStress = async () => {
    if (!span || n !== 1) return;
    setBusy(true);
    setError(null);
    try {
      const i = span[0];
      const next = stressed ? stress.filter((x) => x !== i) : [...stress, i];
      await once(act, SET, { patch: { stress: next } });
      document.getSelection()?.removeAllRanges();
      setSpan(null);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  // One word picked: fix it to what he said.
  const fix = useEdit(first ? `video:${video}:fix:${first.s}` : null, "");
  const fixOne = async () => {
    const sent = fix.value;
    if (!first || !sent.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await once(act, WORDS, { at: (first.s + first.e) / 2, text: sent.trim() });
      fix.saved(sent);
      document.getSelection()?.removeAllRanges();
      setSpan(null);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      {edit ? (
        <p className="text-[12px] text-(--ui-ink-3)">
          Select words to cut them, or one word to fix or stress it. Stressed words are underlined.
        </p>
      ) : null}
      <p ref={box} className="text-[14px] leading-7 break-words">
        {words.map((w, i) => (
          <span
            key={`${w.s}-${w.e}`}
            data-i={i}
            {...tipProps(clock(w.s), { as: "none" })}
            className={cx(
              w.cut === "cut" && "text-(--ui-ink-3) line-through",
              w.cut === "proposed" && "bg-(--ui-accent-wash) line-through",
              w.stress && "font-semibold underline decoration-(--ui-link) decoration-2",
            )}
          >
            {w.w}{" "}
          </span>
        ))}
      </p>
      {first && last ? (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-3 border border-(--ui-hair) bg-(--ui-paper) p-3 shadow-sm">
          <span className="text-[13px]">
            {n} {n === 1 ? "word" : "words"} from {clock(first.s)}
          </span>
          <Button tone="primary" size="dense" busy={busy} onClick={() => void cut()}>
            Cut {n === 1 ? "it" : "them"}
          </Button>
          {n === 1 ? (
            <Button size="dense" tone="quiet" busy={busy} onClick={() => void toggleStress()}>
              {stressed ? "Unstress" : "Stress"}
            </Button>
          ) : null}
          {n === 1 ? (
            <span className="flex min-w-0 items-center gap-2">
              <Input
                {...fix.field}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void fixOne();
                  }
                }}
                placeholder={`"${first.w}" should be`}
                aria-label="The right word"
                maxLength={60}
                className="w-44 text-[14px]"
              />
              <Button size="dense" tone="quiet" busy={busy} onClick={() => void fixOne()}>
                Fix
              </Button>
            </span>
          ) : null}
          {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
        </div>
      ) : null}
      {edit ? <FixEvery video={video} act={act} /> : null}
    </div>
  );
}

/** Whisper's mishearing fixed everywhere it says it: "drug fooding" to "dogfooding". */
function FixEvery({ video, act }: { video: string; act: RecordAct }) {
  const form = useEditForm({
    key: `video:${video}:fix-every`,
    defaults: { wrong: "", right: "" },
  });
  const [said, setSaid] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const run = form.onSend(async ({ wrong, right }) => {
    if (!wrong.trim() || !right.trim()) return false;
    setSaid(null);
    setBad(false);
    try {
      const r = answerIn(await once(act, WORDS, { wrong: wrong.trim(), right: right.trim() })) as
        | { n?: number }
        | undefined;
      setSaid(r?.n ? `Fixed in ${r.n} ${r.n === 1 ? "place" : "places"}.` : "Fixed.");
    } catch (err) {
      setSaid(errorOf(err));
      setBad(true);
      return false;
    }
  });
  return (
    <details>
      <summary className="w-fit cursor-pointer text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
        Fix a word everywhere
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TextField
          form={form}
          name="wrong"
          placeholder="What it wrote"
          aria-label="What it wrote"
          maxLength={60}
          box="w-44 text-[14px]"
        />
        <TextField
          form={form}
          name="right"
          placeholder="What you said"
          aria-label="What you said"
          maxLength={60}
          box="w-44 text-[14px]"
        />
        <Button size="dense" busy={form.formState.isSubmitting} onClick={() => void run()}>
          Fix
        </Button>
        {said ? (
          <span
            aria-live="polite"
            className={bad ? "text-[13px] text-(--ui-bad)" : "text-[13px] text-(--ui-ink-2)"}
          >
            {said}
          </span>
        ) : null}
      </div>
    </details>
  );
}

const at = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const CHECK_TONE: Record<Check["tone"], "green" | "warn" | "neutral"> = {
  good: "green",
  warn: "warn",
  bad: "warn",
  neutral: "neutral",
};
const CHECK_WORD: Record<Check["tone"], string> = {
  good: "Good",
  warn: "Look",
  bad: "Fix",
  neutral: "Note",
};

/** What to look at before Approve: each a sentence with a tag. */
const Checks = ({ checks }: { checks: Check[] }) => (
  <ul className="grid list-none gap-1.5 p-0 text-[14px]">
    {checks.map((c) => (
      <li key={c.say} className="flex min-w-0 items-baseline gap-2">
        <Tag tone={CHECK_TONE[c.tone]} className="shrink-0">
          {CHECK_WORD[c.tone]}
        </Tag>
        <span className={cx("min-w-0 break-words", c.tone === "bad" && "text-(--ui-bad)")}>
          {c.say}
        </span>
      </li>
    ))}
  </ul>
);

/** One agent pass: his note, what it did, its notes to him. */
function Pass({ p }: { p: Step }) {
  return (
    <li className="grid min-w-0 gap-1">
      <span className="text-[13px] text-(--ui-ink-2)">
        {p.note ? `${p.by ?? "Someone"} asked for changes` : "The agent's pass"} · {at(p.at)}
      </span>
      {p.note ? <span className="whitespace-pre-wrap break-words">{p.note}</span> : null}
      {p.state === "running" ? (
        <span className="animate-pulse text-(--ui-ink-3) motion-reduce:animate-none">
          The agent is working on it…
        </span>
      ) : null}
      {p.state === "done" ? <span className="text-(--ui-ink-2)">{p.what}.</span> : null}
      {p.reply ? (
        <span className="whitespace-pre-wrap break-words text-(--ui-ink-2)">{p.reply}</span>
      ) : null}
      {p.notes?.length ? (
        <ul className="grid list-disc gap-0.5 pl-5">
          {p.notes.map((n) => (
            <li key={n} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {p.error ? <span className="text-(--ui-bad)">{p.error}</span> : null}
    </li>
  );
}

/**
 * The editing agent (designs/2026-10-13-video-review.md): its passes and notes, the checks, and a
 * note it acts on. A pass that changes something renders again on the Mac.
 */
function Agent({
  video,
  steps,
  checks,
  edit,
  act,
  narrow = false,
}: {
  video: string;
  steps: Step[];
  checks: Check[];
  edit: boolean;
  act: RecordAct;
  /** A phone: Ask for changes sits right under the checks, the passes after it. */
  narrow?: boolean;
}) {
  // What he types for the agent stays on the device until it's sent.
  const form = useEditForm({ key: `video:${video}:agent`, defaults: { note: "" } });
  const note = form.watch("note");
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = form.formState.isSubmitting;
  const passes = steps.filter((s) => s.command === "video-edit");
  const running = passes.some((p) => p.state === "running");
  const send = form.onSend(async (v) => void (await once(act, AGENT, { note: v.note.trim() })), {
    clear: true,
  });
  const said = passes.length ? (
    <ol className="grid list-none gap-4 p-0 text-[14px]">
      {passes.slice(-5).map((p) => (
        <Pass key={p.id} p={p} />
      ))}
    </ol>
  ) : (
    <p className="text-[14px] text-(--ui-ink-2)">The agent hasn't worked on this one yet.</p>
  );
  return (
    <div className="grid min-w-0 gap-4">
      {checks.length ? <Checks checks={checks} /> : null}
      {narrow ? null : said}
      {edit ? (
        <div className="grid min-w-0 gap-2">
          <DictateField target={box} label="Dictate changes">
            <Textarea
              ref={box}
              data-edit="form:note"
              value={note}
              onChange={(e) => form.setValue("note", e.target.value)}
              disabled={busy || running}
              rows={3}
              maxLength={2000}
              placeholder="What to change: a better title, fix a word, cut the slow part at 4:10"
              aria-label="Ask for changes"
            />
          </DictateField>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="primary"
              size="dense"
              busy={busy}
              disabled={running}
              onClick={() => void send()}
            >
              {note.trim()
                ? "Ask for changes"
                : passes.length
                  ? "Run the agent again"
                  : "Run the agent"}
            </Button>
            <span className="text-[13px] text-(--ui-ink-3)">
              It fixes words, writes the title and chapters, then renders again.
            </span>
          </div>
          {form.error ? <span className="text-[13px] text-(--ui-bad)">{form.error}</span> : null}
        </div>
      ) : null}
      {narrow ? said : null}
    </div>
  );
}

/** Every run on the video, newest first, folded: the agent's, his and the terminal's. */
const Steps = ({ steps }: { steps: Step[] }) => (
  <details className="text-[14px]">
    <summary className="cursor-pointer text-(--ui-ink-2)">
      {steps.length} step{steps.length === 1 ? "" : "s"}
    </summary>
    <ol className="mt-2 grid list-none gap-1 p-0">
      {[...steps].reverse().map((s) => (
        <li key={s.id} className="flex min-w-0 flex-wrap gap-x-2">
          <span className="shrink-0 text-(--ui-ink-3) tabular-nums">{at(s.at)}</span>
          <span className="min-w-0 break-words">
            {s.what}
            {s.by ? ` · ${s.by}` : ""}
          </span>
          {s.state === "failed" ? (
            <span className="min-w-0 break-words text-(--ui-bad)">{s.error}</span>
          ) : s.state === "running" ? (
            <span className="text-(--ui-ink-3)">running</span>
          ) : null}
        </li>
      ))}
    </ol>
  </details>
);

/** Ask Claude on the video: his words go with the edit; Wren writes what Claude answers. */
function Ask({ video, turns, act }: { video: string; turns: Turn[]; act: RecordAct }) {
  const form = useEditForm({ key: `video:${video}:ask`, defaults: { message: "" } });
  const message = form.watch("message");
  const askBox = useRef<HTMLInputElement>(null);
  const asking = form.formState.isSubmitting;
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = form.onSend(
    async (v) => {
      if (!v.message.trim()) return false;
      setError(null);
      await once(act, ASK, { message: v.message.trim() });
    },
    { clear: true },
  );
  const undo = async () => {
    setUndoing(true);
    setError(null);
    try {
      await once(act, UNDO, {});
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setUndoing(false);
    }
  };
  // The fields a change wrote, said under it.
  const lines: DraftTurnLine[] = turns.map((t) => ({
    ...t,
    message: t.message ?? (t.fields?.length ? `Changed ${t.fields.join(", ")}` : null),
    reply: t.reply && t.fields?.length ? `${t.reply} (changed ${t.fields.join(", ")})` : t.reply,
    draft: null,
  }));
  const changed = turns.some((t) => t.state === "done" && t.fields?.length);
  return (
    <div className="grid min-w-0 gap-3">
      {lines.length ? <DraftTurns turns={lines} /> : null}
      <div className="flex min-w-0 items-center gap-2">
        <DictateField target={askBox} line label="Dictate to Claude" className="flex-1">
          <Input
            ref={askBox}
            data-edit="form:message"
            value={message}
            onChange={(e) => form.setValue("message", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask();
              }
            }}
            disabled={asking}
            placeholder="Ask Claude: a better title, chapters, what to cut"
            aria-label="Ask Claude"
            maxLength={2000}
          />
        </DictateField>
        {changed ? (
          <Button tone="quiet" size="dense" busy={undoing} onClick={() => void undo()}>
            Undo
          </Button>
        ) : null}
      </div>
      {(form.error ?? error) ? (
        <span className="text-[13px] text-(--ui-bad)">{form.error ?? error}</span>
      ) : null}
    </div>
  );
}

const Shorts = ({ shorts }: { shorts: Video["shorts"] }) => (
  <ol className="m-0 grid list-none gap-4 p-0">
    {shorts.map((s, i) => (
      <li key={`${s.from}-${s.to}`} className="grid gap-2">
        <p className="text-[14px]">
          <span className="font-medium">
            {i + 1}. {s.title}
          </span>{" "}
          <span className="text-(--ui-ink-2)">
            {clock(s.from)} to {clock(s.to)}
          </span>{" "}
          {s.upload ? <Tag tone="green">{s.upload.status}</Tag> : null}
        </p>
        {s.preview ? (
          // biome-ignore lint/a11y/useMediaCaption: captions are burned in or a YouTube CC track.
          <video
            controls
            preload="metadata"
            src={s.preview}
            className="h-80 max-w-full rounded bg-black"
          />
        ) : null}
      </li>
    ))}
  </ol>
);

const Thumbnails = ({ thumbnails }: { thumbnails: Video["thumbnails"] }) => (
  <div className="grid grid-cols-3 gap-3">
    {thumbnails.map((t, i) => (
      <figure key={t.url ?? i} className="grid gap-1">
        {t.url ? <img src={t.url} alt={`Thumbnail ${i + 1}`} className="w-full rounded" /> : null}
        <figcaption className="text-[13px]">
          {i + 1} {t.picked ? <Tag tone="accent">Picked</Tag> : null}
        </figcaption>
      </figure>
    ))}
  </div>
);

/** Each row: its name, the drafts it reads, and what Promote's pick drafts it. */
const PROMO_ROWS = [
  { name: "LinkedIn", kind: "post", platforms: ["linkedin"], pick: "A post on each channel" },
  { name: "X", kind: "post", platforms: ["x"], pick: "A post on each channel" },
  { name: "Reddit", kind: "post", platforms: ["reddit"], pick: "A post on each channel" },
  { name: "Instagram", kind: "post", platforms: ["instagram"], pick: "A post on each channel" },
  { name: "X thread", kind: "thread", platforms: ["x"], pick: "An X thread" },
  {
    name: "Carousel",
    kind: "carousel",
    platforms: ["linkedin", "instagram"],
    pick: "A carousel",
  },
] as const;
const PROMO_STATE: Record<string, { label: string; tone: "neutral" | "warn" | "green" }> = {
  draft: { label: "Waiting on you", tone: "warn" },
  approved: { label: "Scheduled", tone: "green" },
  publishing: { label: "Posting", tone: "neutral" },
  published: { label: "Posted", tone: "green" },
  failed: { label: "Failed to post", tone: "warn" },
  rejected: { label: "Rejected", tone: "neutral" },
};
/** Wider pieces of one recording, not built yet (designs/2026-10-07-content-funnel.md). */
const PROMO_LATER = [
  ["TikTok", "The vertical cut, posted as is."],
  ["Follows", "Follow the people who engage, on X and Instagram."],
] as const;
const SITE: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram" };
const firstLine = (t: string) => t.split("\n").find((l) => l.trim()) ?? "";

/**
 * Each platform's post, the X thread and the carousel: its state and first line, or what Promote
 * picks to draft it; then what's coming.
 */
function Promos({ promos }: { promos: Promo[] }) {
  return (
    <div className="grid gap-4">
      <ul className="m-0 grid list-none gap-0 p-0">
        {PROMO_ROWS.map((row) => {
          const ds = row.platforms.flatMap((p) => {
            const d = promos.find((x) => x.platform === p && (x.kind ?? "post") === row.kind);
            return d ? [d] : [];
          });
          return (
            <li
              key={row.name}
              className="grid gap-1 border-b border-(--ui-hair) py-3 first:pt-0 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[14px] font-medium">{row.name}</span>
                {ds.map((d) => {
                  const state = PROMO_STATE[d.status] ?? { label: d.status, tone: "neutral" };
                  return (
                    <span key={d.id} className="flex items-center gap-1.5">
                      {ds.length > 1 ? (
                        <span className="text-[12px] text-(--ui-ink-3)">{SITE[d.platform]}</span>
                      ) : null}
                      <Tag tone={state.tone}>{state.label}</Tag>
                    </span>
                  );
                })}
                <span className="ml-auto flex gap-3">
                  {ds.map((d) => (
                    <a
                      key={d.id}
                      href={`/content/drafts/${encodeURIComponent(d.id)}`}
                      className="text-[13px] text-(--ui-ink-2) underline underline-offset-2"
                    >
                      {ds.length > 1 ? `Open ${SITE[d.platform]}` : "Open"}
                    </a>
                  ))}
                </span>
              </div>
              <p className="m-0 line-clamp-2 text-[13px] text-(--ui-ink-2)">
                {ds[0] ? firstLine(ds[0].text) : `Not drafted. Promote, then pick "${row.pick}".`}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2 border-t border-(--ui-hair) pt-4">
        {PROMO_LATER.map(([name, what]) => (
          <div key={name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px]">{name}</span>
            <Tag tone="accent">In development</Tag>
            <span className="text-[13px] text-(--ui-ink-3)">{what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Words made from this video (designs/2026-10-14-content-types.md): Write opens about it, and what
 * it makes hangs under the video in Pieces.
 */
function WriteAbout({ id, title }: { id: string; title: string }) {
  const about = { from: `video:${id}`, about: title };
  const link = "text-[14px] text-(--ui-ink) underline underline-offset-2";
  return (
    <p className="m-0 flex flex-wrap gap-x-5 gap-y-1">
      <a className={link} href={href("/content/studio", about)}>
        Write a post about it
      </a>
      <a className={link} href={href("/content/studio", { ...about, make: "blog" })}>
        Write a blog post about it
      </a>
    </p>
  );
}

/**
 * The model's passes on the words (`wren video stress`, `wren video words --punctuate`): one
 * press each, Undo puts the words or the stress back.
 */
function ModelTools({ act, punctuated }: { act: RecordAct; punctuated: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const run = async (action: string, done: (n: number) => string) => {
    setBusy(action);
    setSaid(null);
    try {
      const r = answerIn(await once(act, action)) as { n?: number } | undefined;
      setSaid({ text: done(r?.n ?? 0), bad: false });
    } catch (err) {
      setSaid({ text: errorOf(err), bad: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {punctuated ? null : (
        <Button
          size="dense"
          tone="quiet"
          busy={busy === PUNCTUATE}
          disabled={!!busy}
          {...tipProps("The transcript has no full stops. A model adds them; the words stay.")}
          onClick={() =>
            void run(PUNCTUATE, (n) => `Punctuated ${n} ${n === 1 ? "word" : "words"}.`)
          }
        >
          Add punctuation
        </Button>
      )}
      <Button
        size="dense"
        tone="quiet"
        busy={busy === STRESS}
        disabled={!!busy}
        {...tipProps(
          "A model picks the few words a minute that carry the point. Undo puts yours back.",
        )}
        onClick={() =>
          void run(STRESS, (n) => `${n} stressed ${n === 1 ? "word" : "words"} picked.`)
        }
      >
        Propose stressed words
      </Button>
      {said ? (
        <span
          aria-live="polite"
          className={said.bad ? "text-[13px] text-(--ui-bad)" : "text-[13px] text-(--ui-ink-2)"}
        >
          {said.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * What a look proposed (`wren video look`): Shorts, chapters and cover frames, each with Use,
 * which saves it into the edit as `wren video set` would. Moments are for reading.
 */
function Suggestions({ looks, edit, act }: { looks: Look[]; edit: Edit; act: RecordAct }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const use = async (key: string, patch: Partial<Edit>, expect: Partial<Edit>, done: string) => {
    setBusy(key);
    setSaid(null);
    try {
      await once(act, SET, { patch, expect });
      setSaid({ text: done, bad: false });
    } catch (err) {
      setSaid({ text: errorOf(err), bad: true });
    } finally {
      setBusy(null);
    }
  };
  const has = (x: { from: number; to: number }) =>
    edit.shorts.some((s) => Math.abs(s.from - x.from) < 1 && Math.abs(s.to - x.to) < 1);
  const NAME: Record<string, string> = { gemini: "Gemini", twelvelabs: "TwelveLabs" };
  return (
    <div className="grid gap-5">
      {looks.map((l) => (
        <div key={l.by} className="grid gap-3">
          <p className="m-0 text-[13px] text-(--ui-ink-2)">
            {NAME[l.by] ?? l.by}, {at(l.at)}
            {l.summary ? `: ${l.summary}` : ""}
          </p>
          {l.shorts.length ? (
            <div className="grid gap-1.5">
              <h5 className="m-0 text-[13px] font-semibold">Shorts</h5>
              <ul className="m-0 grid list-none gap-1 p-0">
                {l.shorts.map((x) => (
                  <li
                    key={`${x.from}-${x.to}`}
                    className="flex flex-wrap items-center gap-2 text-[13.5px]"
                  >
                    <span className="text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
                      {clock(x.from)} to {clock(x.to)}
                    </span>
                    <span className="min-w-0 flex-1">{x.title}</span>
                    {has(x) ? (
                      <Tag tone="green">In the edit</Tag>
                    ) : (
                      <Button
                        size="dense"
                        tone="quiet"
                        busy={busy === `s${x.from}`}
                        disabled={!!busy}
                        onClick={() =>
                          void use(
                            `s${x.from}`,
                            { shorts: [...edit.shorts, x] },
                            { shorts: edit.shorts },
                            "Added as a Short.",
                          )
                        }
                      >
                        Use
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {l.chapters.length ? (
            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <h5 className="m-0 text-[13px] font-semibold">Chapters</h5>
                <Button
                  size="dense"
                  tone="quiet"
                  busy={busy === `c${l.by}`}
                  disabled={!!busy}
                  onClick={() =>
                    void use(
                      `c${l.by}`,
                      { chapters: l.chapters },
                      { chapters: edit.chapters },
                      "Chapters replaced.",
                    )
                  }
                >
                  Use these chapters
                </Button>
              </div>
              <ul className="m-0 grid list-none gap-0.5 p-0 text-[13.5px]">
                {l.chapters.map((c) => (
                  <li key={c.at}>
                    <span className="text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
                      {clock(c.at)}
                    </span>{" "}
                    {c.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {l.thumbnails.length ? (
            <div className="grid gap-1.5">
              <h5 className="m-0 text-[13px] font-semibold">Thumbnail frames</h5>
              <ul className="m-0 grid list-none gap-1 p-0">
                {l.thumbnails.map((x) => (
                  <li key={x.at} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                    <span className="text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
                      {clock(x.at)}
                    </span>
                    <span className="min-w-0 flex-1">{x.why}</span>
                    {edit.thumbnail && Math.abs(edit.thumbnail.at - x.at) < 0.5 ? (
                      <Tag tone="green">In use</Tag>
                    ) : (
                      <Button
                        size="dense"
                        tone="quiet"
                        busy={busy === `t${x.at}`}
                        disabled={!!busy}
                        onClick={() =>
                          void use(
                            `t${x.at}`,
                            { thumbnail: { at: x.at, text: edit.thumbnail?.text ?? "" } },
                            { thumbnail: edit.thumbnail },
                            "Thumbnail frame set. Render the thumbnails to see it.",
                          )
                        }
                      >
                        Use
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {l.moments.length ? (
            <details>
              <summary className="w-fit cursor-pointer text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
                {l.moments.length} moments it noticed
              </summary>
              <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-[13.5px]">
                {l.moments.map((m) => (
                  <li key={m.at}>
                    <span className="text-(--ui-ink-2) [font-variant-numeric:tabular-nums]">
                      {clock(m.at)}
                    </span>{" "}
                    {m.why}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ))}
      {said ? (
        <span
          aria-live="polite"
          className={said.bad ? "text-[13px] text-(--ui-bad)" : "text-[13px] text-(--ui-ink-2)"}
        >
          {said.text}
        </span>
      ) : null}
    </div>
  );
}

/** Below this width the record is a phone's: review first, editing folded (C5). */
const NARROW = "(max-width: 899px)";
const isNarrow = () => typeof window !== "undefined" && !!window.matchMedia?.(NARROW).matches;

/**
 * The editing sections on a phone, folded behind Edit: editing happens at the Mac, a phone
 * reviews (designs/2026-10-14-content-types.md, Phone).
 */
const EditFold = ({ sections }: { sections: [string, ReactNode][] }) => (
  <details className="group/edit min-w-0">
    <summary className="cursor-pointer py-2.5 text-[14px] text-(--ui-ink-2) hover:text-(--ui-ink)">
      Transcript, cuts and captions
    </summary>
    <div className="mt-3 grid min-w-0 gap-6">
      {sections.map(([title, body]) => (
        <section key={title} className="grid min-w-0 gap-2">
          <h4 className="m-0 font-semibold text-[13px] text-(--ui-ink-2)">{title}</h4>
          {body}
        </section>
      ))}
    </div>
  </details>
);

export const videoExtras: NonNullable<ListPage["extras"]> = (
  detail,
  { act, row, readAt, params },
) => {
  const v = (detail as { video?: Video | null } | null)?.video;
  if (!v) return {};
  const edit = EDITABLE.includes(v.state);
  const steps = v.steps ?? [];
  const narrow = isNarrow();
  // The storyboard opens first (designs/2026-10-15-storyboard.md); the timeline is a tab away.
  if (v.storyboard) {
    const timeline = params.get("editor") === "timeline";
    const top = <EditorTabs params={params} timeline={timeline} />;
    if (!timeline)
      return {
        top,
        sections: [
          [
            "Storyboard",
            <StoryboardView
              key="sb"
              id={String(row.id)}
              board={v.storyboard}
              data={v.finish}
              words={v.words}
              editable={edit}
              act={act}
            />,
          ],
        ],
        ...polled(v, steps),
      };
    return { ...timelineExtras(v, { act, row, readAt, edit, steps, narrow }), top };
  }
  return timelineExtras(v, { act, row, readAt, edit, steps, narrow });
};

/** Read again soon while Claude works; now and then while the Mac renders (or is off). */
const polled = (v: Video, steps: Step[]): Pick<RecordExtras, "poll"> =>
  v.turns.some((t) => t.state === "thinking") || steps.some((t) => t.state === "running")
    ? { poll: POLL_MS }
    : v.render && v.render.state !== "failed"
      ? { poll: RENDER_POLL_MS }
      : {};

/** The editor itself: preview, finish, agent, fields, cuts, transcript and the rest. */
function timelineExtras(
  v: Video,
  {
    act,
    row,
    readAt,
    edit,
    steps,
    narrow,
  }: {
    act: RecordAct;
    row: { id: unknown };
    readAt: number | undefined;
    edit: boolean;
    steps: Step[];
    narrow: boolean;
  },
): RecordExtras {
  // Finishing happens at the Mac: trims, text, captions, cover and crops, before the render.
  const finishing = edit && !narrow && !!v.finish;
  // Before a render the finish below is the preview: no empty box above it.
  const sections: [string, ReactNode][] =
    finishing && !v.preview
      ? []
      : [
          [
            "Preview",
            <div key="p" className="grid gap-2">
              <Player src={v.preview} />
              {v.fresh && v.preview ? <Checks checks={[v.fresh]} /> : null}
            </div>,
          ],
        ];
  if (finishing && v.finish)
    sections.push([
      "Finish",
      <Finish
        key="fin"
        id={String(row.id)}
        data={v.finish}
        words={v.words}
        act={act}
        at={readAt}
      />,
    ]);
  sections.push([
    narrow ? "Review" : "Editing agent",
    <Agent
      key="ag"
      video={String(row.id)}
      steps={steps}
      checks={v.checks ?? []}
      edit={edit}
      act={act}
      narrow={narrow}
    />,
  ]);
  // What edits the cut: in place on a wide page, folded behind Edit on a phone.
  const editing: [string, ReactNode][] = [];
  if (v.vertical)
    sections.push([
      "Vertical",
      <div key="v" className="grid gap-2">
        {v.vertical.upload ? (
          <p className="text-[14px]">
            <Tag tone="green">{v.vertical.upload.status}</Tag>
          </p>
        ) : null}
        {v.vertical.preview ? (
          // biome-ignore lint/a11y/useMediaCaption: captions are burned in or a YouTube CC track.
          <video
            controls
            preload="metadata"
            src={v.vertical.preview}
            className="h-96 max-w-full rounded bg-black"
          />
        ) : (
          <Empty>Rendered; its preview shows once it is uploaded.</Empty>
        )}
      </div>,
    ]);
  editing.push(
    edit
      ? [
          "Title, description and the rest",
          <Fields key="f" id={String(row.id)} edit={v.edit} act={act} finishing={finishing} />,
        ]
      : [
          "Title and description",
          <div key="f" className="grid gap-2 text-[14px]">
            <p className="font-medium">{v.edit.title || "No title"}</p>
            <p className="whitespace-pre-wrap">{v.edit.description || "No description"}</p>
          </div>,
        ],
  );
  if (edit) editing.push(["Cuts", <Cuts key="c" cuts={v.cuts} act={act} />]);
  editing.push([
    "Transcript",
    <div key="t" className="grid gap-2">
      {edit ? <ModelTools act={act} punctuated={v.punctuated !== false} /> : null}
      <Transcript
        video={String(row.id)}
        words={v.words}
        act={act}
        edit={edit}
        stress={v.edit.stress ?? []}
      />
    </div>,
  ]);
  if (edit && v.looks?.length)
    editing.push(["Suggestions", <Suggestions key="sg" looks={v.looks} edit={v.edit} act={act} />]);
  if (edit)
    editing.push(["Ask Claude", <Ask key="a" video={String(row.id)} turns={v.turns} act={act} />]);
  if (!narrow) sections.push(...editing);
  if (v.shorts.length) sections.push(["Shorts", <Shorts key="s" shorts={v.shorts} />]);
  if (v.promos) sections.push(["Promos", <Promos key="pr" promos={v.promos} />]);
  sections.push([
    "From this video",
    <WriteAbout key="wa" id={String(row.id)} title={v.edit.title} />,
  ]);
  if (narrow) sections.push(["Edit", <EditFold key="ed" sections={editing} />]);
  if (v.thumbnails.length)
    sections.push(["Thumbnails", <Thumbnails key="th" thumbnails={v.thumbnails} />]);
  if (steps.length) sections.push(["Steps", <Steps key="st" steps={steps} />]);
  const out: RecordExtras = { sections, ...polled(v, steps) };
  if (v.render?.state === "failed" && v.render.why)
    out.facts = [["Why the render failed", v.render.why]];
  return out;
}
