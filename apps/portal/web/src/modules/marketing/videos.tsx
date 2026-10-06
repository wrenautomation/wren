/**
 * A video's detail (`marketing.video`), edited in place (designs/2026-10-06-video-editor.md, step
 * 4): the preview; the title, description, tags, chapters, Shorts titles and thumbnail text, each
 * saved on blur; the cuts with the words they strike, Keep or Cut; a span of transcript words
 * picked and cut; Ask Claude with Undo. Every change is `VideoDesk` on the record's inline actions.
 * Render is the head action; its state shows on the record.
 */
import type { DraftTurnLine, RecordAct, RecordExtras } from "@wren/ui";
import { Button, DraftTurns, Empty, Input, Tag, Textarea } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ListPage } from "../../module.js";

type Word = { w: string; s: number; e: number; cut: "cut" | "proposed" | null };
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
type Short = { from: number; to: number; title: string };
type Edit = {
  title: string;
  description: string;
  tags: string[];
  chapters: { at: number; title: string }[];
  shorts: Short[];
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
  edit: Edit;
  cuts: CutRow[];
  render: { state: string; why?: string } | null;
  state: string;
  turns: Turn[];
};

const SET = "marketing.videoSet";
const CUT = "marketing.videoCut";
const ASK = "marketing.videoAsk";
const UNDO = "marketing.videoUndo";
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

const Player = ({ src }: { src: string | null }) =>
  src ? (
    // biome-ignore lint/a11y/useMediaCaption: captions are burned into the render.
    <video controls preload="metadata" src={src} className="w-full rounded bg-black" />
  ) : (
    <Empty>The preview shows here once the video is rendered.</Empty>
  );

/**
 * One field of the edit, saved on blur (and Enter, one line). `patch` turns the text into the
 * change, or throws why it can't; unchanged text saves nothing.
 */
function Field({
  label,
  value,
  patch,
  act,
  lines = 1,
  hint,
  max,
}: {
  label: string;
  value: string;
  patch: (text: string) => Record<string, unknown>;
  act: RecordAct;
  lines?: number;
  hint?: string;
  max?: number;
}) {
  const [text, setText] = useState(value);
  const [said, setSaid] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const dirty = text !== value;
  const live = useRef(dirty);
  live.current = dirty;
  // A new read (Claude, an undo) shows unless he is mid-edit.
  useEffect(() => {
    if (!live.current) setText(value);
  }, [value]);
  const save = async () => {
    if (text.trim() === value.trim()) return;
    setSaid("Saving…");
    setBad(false);
    try {
      await act(SET, { patch: patch(text.trim()) });
      setSaid("Saved");
    } catch (err) {
      setSaid(errorOf(err));
      setBad(true);
    }
  };
  const id = `video-${label.toLowerCase().replaceAll(" ", "-")}`;
  const common = {
    id,
    value: text,
    maxLength: max,
    onBlur: () => void save(),
    className: "text-[14px]",
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-(--ui-ink-2)">
          {label}
        </label>
        <span
          aria-live="polite"
          className={bad ? "text-[12px] text-(--ui-bad)" : "text-[12px] text-(--ui-ink-2)"}
        >
          {said ?? (dirty ? "Edited" : "")}
        </span>
      </div>
      {lines > 1 ? (
        <Textarea
          {...common}
          rows={lines}
          onChange={(e) => {
            setText(e.target.value);
            setSaid(null);
          }}
        />
      ) : (
        <Input
          {...common}
          onChange={(e) => {
            setText(e.target.value);
            setSaid(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
      )}
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

function Fields({ edit, act }: { edit: Edit; act: RecordAct }) {
  const thumb = edit.thumbnail;
  return (
    <div className="grid gap-4">
      <Field label="Title" value={edit.title} max={100} act={act} patch={(title) => ({ title })} />
      <Field
        label="Description"
        value={edit.description}
        max={5000}
        lines={6}
        act={act}
        patch={(description) => ({ description })}
      />
      <Field
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
        label="Chapters"
        value={edit.chapters.map((c) => `${clock(c.at)} ${c.title}`).join("\n")}
        lines={4}
        hint="One a line: 1:05 Title, at the time in the recording. YouTube needs 3 or more."
        act={act}
        patch={(t) => ({ chapters: chaptersOf(t) })}
      />
      {edit.shorts.map((s, i) => (
        <Field
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
      await act(CUT, { from: c.from, to: c.to, state });
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
function Transcript({ words, act, edit }: { words: Word[]; act: RecordAct; edit: boolean }) {
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
      await act(CUT, { from: first.s, to: last.e, state: "cut" });
      document.getSelection()?.removeAllRanges();
      setSpan(null);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  const n = span ? span[1] - span[0] + 1 : 0;
  return (
    <div className="grid gap-2">
      {edit ? <p className="text-[12px] text-(--ui-ink-3)">Select words to cut them.</p> : null}
      <p ref={box} className="text-[14px] leading-7 break-words">
        {words.map((w, i) => (
          <span
            key={`${w.s}-${w.e}`}
            data-i={i}
            title={clock(w.s)}
            className={
              w.cut === "cut"
                ? "text-(--ui-ink-3) line-through"
                : w.cut === "proposed"
                  ? "bg-(--ui-accent-wash) line-through"
                  : undefined
            }
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
          <Button size="dense" busy={busy} onClick={() => void cut()}>
            Cut {n === 1 ? "it" : "them"}
          </Button>
          {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Ask Claude on the video: his words go with the edit; Wren writes what Claude answers. */
function Ask({ turns, act }: { turns: Turn[]; act: RecordAct }) {
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: "ask" | "undo") => {
    const said = message.trim();
    if (what === "ask" && !said) return;
    (what === "ask" ? setAsking : setUndoing)(true);
    setError(null);
    try {
      await act(what === "ask" ? ASK : UNDO, what === "ask" ? { message: said } : {});
      if (what === "ask") setMessage("");
    } catch (err) {
      setError(errorOf(err));
    } finally {
      (what === "ask" ? setAsking : setUndoing)(false);
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
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run("ask");
            }
          }}
          disabled={asking}
          placeholder="Ask Claude: a better title, chapters, what to cut"
          aria-label="Ask Claude"
          maxLength={2000}
          className="min-w-0 flex-1"
        />
        {changed ? (
          <Button tone="quiet" size="dense" busy={undoing} onClick={() => void run("undo")}>
            Undo
          </Button>
        ) : null}
      </div>
      {error ? <span className="text-[13px] text-(--ui-bad)">{error}</span> : null}
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
          // biome-ignore lint/a11y/useMediaCaption: captions are burned into the render.
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

export const videoExtras: NonNullable<ListPage["extras"]> = (detail, { act }) => {
  const v = (detail as { video?: Video | null } | null)?.video;
  if (!v) return {};
  const edit = EDITABLE.includes(v.state);
  const sections: [string, ReactNode][] = [["Preview", <Player key="p" src={v.preview} />]];
  sections.push(
    edit
      ? ["Title, description and the rest", <Fields key="f" edit={v.edit} act={act} />]
      : [
          "Title and description",
          <div key="f" className="grid gap-2 text-[14px]">
            <p className="font-medium">{v.edit.title || "No title"}</p>
            <p className="whitespace-pre-wrap">{v.edit.description || "No description"}</p>
          </div>,
        ],
  );
  if (edit) sections.push(["Cuts", <Cuts key="c" cuts={v.cuts} act={act} />]);
  sections.push(["Transcript", <Transcript key="t" words={v.words} act={act} edit={edit} />]);
  if (edit) sections.push(["Ask Claude", <Ask key="a" turns={v.turns} act={act} />]);
  if (v.shorts.length) sections.push(["Shorts", <Shorts key="s" shorts={v.shorts} />]);
  if (v.thumbnails.length)
    sections.push(["Thumbnails", <Thumbnails key="th" thumbnails={v.thumbnails} />]);
  const out: RecordExtras = { sections };
  if (v.render?.state === "failed" && v.render.why)
    out.facts = [["Why the render failed", v.render.why]];
  // While Claude works, read again soon; while the Mac renders (or is off), now and then.
  if (v.turns.some((t) => t.state === "thinking")) out.poll = POLL_MS;
  else if (v.render && v.render.state !== "failed") out.poll = RENDER_POLL_MS;
  return out;
};
