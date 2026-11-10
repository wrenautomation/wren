/**
 * Marks in Finish (designs/2026-11-10-video-editor-pick.md, marks): a note pinned to a moment, a
 * range or a part of the picture, for the editing agent. The panel adds, closes and removes them;
 * the stage draws their boxes and takes a drag for a new one; the timeline pins them.
 */
import type { Mark } from "@wren/starling-studio/marks";
import {
  type ActPatch,
  answerIn,
  Button,
  cx,
  Empty,
  type RecordAct,
  Seg,
  tintColor,
  UnsavedMark,
  useEdit,
} from "@wren/ui";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { clamp, type Format, r3, stamp, VIEWS } from "./finish-data.js";
import { drag } from "./finish-hooks.js";

export type { Mark };
export type MarkBox = NonNullable<Mark["box"]>;
type Tone = Mark["tone"];

export const MARK = "marketing.videoMark";
export const MARK_DONE = "marketing.videoMarkDone";
export const MARK_DROP = "marketing.videoMarkDrop";
/** How long a mark at one moment stays drawn on the stage after it. */
export const MARK_HOLD_S = 2;
/** A mark's pin on the timeline, px. */
const PIN_W = 18;
/** Under this, a dragged box is a click. */
const BOX_MIN = 0.02;

/** The answer's marks over the page's (`VideoDesk` mark, markDone, markDrop answer them all). */
const marksPatch: ActPatch = (detail, answer) => {
  const marks = (answerIn(answer) as { marks?: unknown } | null)?.marks;
  const d = detail as { video?: Record<string, unknown> } | null;
  if (!Array.isArray(marks) || !d?.video) return null;
  return { detail: { ...d, video: { ...d.video, marks } } };
};
const MARKED = { patch: marksPatch };

/** Whether mark `m` is on screen at `t`: its range, or a moment and the two seconds after. */
export const markOn = (m: Mark, t: number) =>
  m.end === null ? t >= m.start - 0.02 && t < m.start + MARK_HOLD_S : t >= m.start && t < m.end;

const TONES = [
  { value: "note", label: "Note" },
  { value: "bad", label: "Fix this" },
  { value: "good", label: "Keep this" },
] as const;
/** Fix and Keep are kinds, not good and bad news: a cue tint each, never the status red or green. */
const TONE_CUE = { bad: 3, good: 1 } as const;
const toneTint = (t: Tone, pct = 22) =>
  t ? `color-mix(in srgb, ${tintColor(TONE_CUE[t])} ${pct}%, transparent)` : undefined;
/** A raw button's touch target under a coarse pointer. */
const TOUCH = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";
const toneWord = (t: Tone) => (t === "bad" ? "Fix" : t === "good" ? "Keep" : null);
const shapeWord = (f: string) => VIEWS.find(([v]) => v === f)?.[1] ?? f;
const when = (m: Pick<Mark, "start" | "end">) =>
  m.end === null ? stamp(m.start) : `${stamp(m.start)} to ${stamp(m.end)}`;

/** A box dragged on the stage, in fractions of its frame; `onBox(null)` on a plain click. */
export function boxDrag(e: ReactPointerEvent<HTMLElement>, onBox: (b: MarkBox | null) => void) {
  const r = e.currentTarget.getBoundingClientRect();
  const at = (px: number, py: number) => ({
    x: clamp((px - r.left) / r.width, 0, 1),
    y: clamp((py - r.top) / r.height, 0, 1),
  });
  const a = at(e.clientX, e.clientY);
  const boxTo = (ev: PointerEvent): MarkBox => {
    const b = at(ev.clientX, ev.clientY);
    return {
      x: r3(Math.min(a.x, b.x)),
      y: r3(Math.min(a.y, b.y)),
      w: r3(Math.abs(b.x - a.x)),
      h: r3(Math.abs(b.y - a.y)),
    };
  };
  drag(
    e,
    (ev) => onBox(boxTo(ev)),
    (ev, moved) => {
      const b = boxTo(ev);
      onBox(moved && b.w >= BOX_MIN && b.h >= BOX_MIN ? b : null);
    },
  );
}

/** The marks' boxes over the stage at `t`, on shape `view`, and the one being drawn. */
export function MarkBoxes({
  marks,
  view,
  t,
  picked,
  draft,
}: {
  marks: readonly Mark[];
  view: Format;
  t: number;
  picked: number | null;
  draft: MarkBox | null;
}) {
  const shown = marks.filter(
    (m) => m.box && m.format === view && ((!m.done && markOn(m, t)) || m.id === picked),
  );
  return (
    <div className="pointer-events-none absolute inset-0">
      {shown.map((m) => (
        <Box
          key={m.id}
          box={m.box as MarkBox}
          tone={m.tone}
          faint={!markOn(m, t)}
          label={String(marks.indexOf(m) + 1)}
          picked={m.id === picked}
        />
      ))}
      {draft ? <Box box={draft} tone={null} faint={false} label="New" picked dashed /> : null}
    </div>
  );
}

function Box({
  box,
  tone,
  faint,
  label,
  picked,
  dashed,
}: {
  box: MarkBox;
  tone: Tone;
  faint: boolean;
  label: string;
  picked: boolean;
  dashed?: boolean;
}) {
  // White and black outlines together read on any picture; the tone is a tint inside.
  return (
    <div
      className={cx(
        "absolute rounded-md outline-2 outline-white shadow-[0_0_0_3.5px_rgb(0_0_0/0.45)] transition-opacity duration-150",
        dashed && "outline-dashed",
        !tone && "bg-white/10",
        faint ? "opacity-50" : "opacity-100",
      )}
      style={{
        background: toneTint(tone, 30),
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
    >
      <span
        className={cx(
          "absolute -top-2.5 -left-2.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold ring-[1.5px] [font-variant-numeric:tabular-nums]",
          picked ? "bg-white text-black ring-black/60" : "bg-black/75 text-white ring-white",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** The marks on the timeline: a pin at each moment, a bar across each range. */
export function MarksLane({
  marks,
  x,
  picked,
  onPick,
}: {
  marks: readonly Mark[];
  x: (s: number) => number;
  picked: number | null;
  onPick: (m: Mark) => void;
}) {
  if (!marks.length) return null;
  // pins in time order: one that would cover the last sits after it
  let free = 0;
  const place = marks.map((m) => {
    const w = m.end === null ? PIN_W : Math.max(PIN_W, x(m.end) - x(m.start));
    const left = Math.max(free, m.end === null ? x(m.start) - PIN_W / 2 : x(m.start));
    free = left + (m.end === null ? PIN_W + 2 : 0);
    return { left, w };
  });
  return (
    <div className="relative h-6 border-t border-(--ui-hair)">
      {marks.map((m, i) => {
        const sel = m.id === picked;
        const ink = m.done
          ? "bg-(--ui-paper) text-(--ui-ink-3) outline outline-1 -outline-offset-1 outline-(--ui-hair)"
          : m.tone
            ? "text-(--ui-ink)"
            : "bg-(--ui-accent-tint) text-(--ui-ink)";
        return (
          <button
            key={m.id}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(m)}
            {...{ title: `${when(m)}: ${m.text}` }}
            aria-label={`Mark ${i + 1} at ${when(m)}${m.done ? ", closed" : ""}`}
            className={cx(
              "absolute top-1 bottom-1 cursor-pointer rounded-[5px] border-0 px-1 text-left text-[10.5px] font-semibold [font-variant-numeric:tabular-nums] transition-colors duration-150",
              sel ? "bg-(--ui-ink) text-(--ui-on-ink)" : ink,
            )}
            style={{
              left: place[i]?.left,
              width: place[i]?.w,
              background: sel || m.done ? undefined : toneTint(m.tone, 30),
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

/** Add a mark at the playhead or the picked range; the list, open first. */
export function MarksPanel({
  id,
  marks,
  t,
  range,
  view,
  draft,
  onDraft,
  picked,
  onPick,
  onSeek,
  act,
}: {
  /** The video: unsent words keep per video across a page switch. */
  id: string;
  marks: readonly Mark[];
  t: number;
  range: [number, number] | null;
  view: Format;
  /** The box drawn on the stage for the next mark. */
  draft: MarkBox | null;
  onDraft: (b: MarkBox | null) => void;
  picked: number | null;
  onPick: (id: number | null) => void;
  onSeek: (t: number) => void;
  act: RecordAct;
}) {
  const words = useEdit(`video:${id}:mark`, "");
  const text = words.value;
  const [tone, setTone] = useState<Tone>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  /** The mark just removed, for the Undo line. */
  const [removed, setRemoved] = useState<{ id: number; n: number } | null>(null);
  const open = marks.filter((m) => !m.done);
  const closed = marks.filter((m) => m.done);
  const at = range ? { start: range[0], end: range[1] } : { start: t, end: null };

  const run = async (key: string, action: string, input: Record<string, unknown>) => {
    setBusy(key);
    setSaid(null);
    try {
      await act(action, input, MARKED);
      return true;
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    const note = text.trim();
    if (!note) return setSaid("Say what to change, or what to keep.");
    const ok = await run("add", MARK, {
      start: r3(at.start),
      end: at.end === null ? null : r3(at.end),
      box: draft,
      format: view,
      tone,
      text: note,
    });
    if (ok) {
      words.discard();
      onDraft(null);
    }
  };

  const row = (m: Mark) => {
    const n = marks.indexOf(m) + 1;
    const sel = m.id === picked;
    const tw = toneWord(m.tone);
    return (
      <li
        key={m.id}
        className={cx(
          "grid gap-1.5 rounded-lg border p-2.5 transition-colors duration-150",
          m.done && "text-(--ui-ink-2)",
          sel ? "border-(--ui-active) bg-(--ui-fill)" : "border-(--ui-hair)",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => {
              onPick(sel ? null : m.id);
              onSeek(m.start);
            }}
            aria-pressed={sel}
            className={cx(
              "cursor-pointer rounded-md border-0 bg-transparent p-0 text-left text-[12.5px] font-semibold text-(--ui-link) [font-variant-numeric:tabular-nums] hover:underline",
              TOUCH,
            )}
          >
            {n}. {when(m)}
          </button>
          {tw ? (
            <span
              className="rounded-full px-1.5 text-[11.5px] font-medium text-(--ui-ink)"
              style={{ background: toneTint(m.tone) }}
            >
              {tw}
            </span>
          ) : null}
          {m.box ? (
            <span className="text-[12px] text-(--ui-ink-3)">
              part of the {shapeWord(m.format)} picture
            </span>
          ) : null}
          <span className="text-[12px] text-(--ui-ink-3)">{m.by}</span>
          <div className="ml-auto flex gap-1.5">
            {m.done ? null : (
              <Button
                size="dense"
                tone="quiet"
                disabled={!!busy}
                onClick={() => void run(`done-${m.id}`, MARK_DONE, { mark: m.id })}
              >
                {busy === `done-${m.id}` ? "Closing…" : "Close"}
              </Button>
            )}
            <Button
              size="dense"
              tone="quiet"
              disabled={!!busy}
              onClick={async () => {
                if (await run(`drop-${m.id}`, MARK_DROP, { mark: m.id })) {
                  setRemoved({ id: m.id, n });
                  if (sel) onPick(null);
                }
              }}
            >
              {busy === `drop-${m.id}` ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
        <p
          className={cx(
            "m-0 text-[13.5px] whitespace-pre-wrap",
            m.done ? "text-(--ui-ink-2)" : "text-(--ui-ink)",
          )}
        >
          {m.text}
        </p>
        {m.done ? (
          <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
            Closed by {m.done.by ?? "someone"}
            {m.done.why ? `: ${m.done.why}` : "."}
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <div className="grid max-w-[720px] gap-4">
      <div className="grid gap-2">
        <label
          htmlFor="mark-text"
          className="text-[13px] font-medium text-(--ui-ink) [font-variant-numeric:tabular-nums]"
        >
          Mark {when(at)} for the editing agent
        </label>
        <textarea
          {...words.field}
          id="mark-text"
          rows={2}
          maxLength={2000}
          placeholder="Zoom in here. Cut this pause. Keep this joke."
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add();
            }
          }}
          className="min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-[13.5px] text-(--ui-ink) placeholder:text-(--ui-ink-3)"
        />
        {draft ? (
          <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
            {`A part of the ${shapeWord(view)} picture is marked. `}
            <button
              type="button"
              onClick={() => onDraft(null)}
              className={cx(
                "cursor-pointer border-0 bg-transparent p-0 text-(--ui-link) hover:underline",
                TOUCH,
              )}
            >
              Clear the part
            </button>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            label="Kind"
            items={TONES}
            value={tone ?? "note"}
            onChange={(v) => setTone(v === "note" ? null : v)}
            className="max-sm:w-full max-sm:[&>button]:flex-1"
          />
          <Button
            size="sm"
            className="ml-auto max-sm:w-full"
            disabled={!!busy}
            onClick={() => void add()}
          >
            {busy === "add" ? "Adding…" : "Add mark"}
          </Button>
        </div>
        <UnsavedMark edit={words} />
        {said ? (
          <p role="alert" className="m-0 text-[12.5px] text-(--ui-bad)">
            {said}
          </p>
        ) : null}
      </div>

      {removed ? (
        <p role="status" className="m-0 text-[13px] text-(--ui-ink-2)">
          {`Mark ${removed.n} is removed. `}
          <button
            type="button"
            disabled={!!busy}
            onClick={async () => {
              if (await run("undo", MARK_DROP, { mark: removed.id, undo: true })) setRemoved(null);
            }}
            className={cx(
              "cursor-pointer border-0 bg-transparent p-0 font-medium text-(--ui-link) hover:underline",
              TOUCH,
            )}
          >
            {busy === "undo" ? "Putting it back…" : "Undo"}
          </button>
        </p>
      ) : null}

      {open.length ? (
        <section className="grid gap-2" aria-label="Open marks">
          <h3 className="m-0 text-[13px] font-semibold text-(--ui-ink)">
            Open <span className="font-normal text-(--ui-ink-3)">{open.length}</span>
          </h3>
          <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
            The editing agent acts on these on its next pass, then closes each with what it did.
          </p>
          <ol className="m-0 grid list-none gap-2 p-0">{open.map(row)}</ol>
        </section>
      ) : (
        <Empty title="No open marks">
          A mark tells the editing agent what to change at a moment, or what to keep. Play to the
          moment, say it above, then Add mark.
        </Empty>
      )}

      {closed.length ? (
        <section className="grid gap-2" aria-label="Closed marks">
          <button
            type="button"
            aria-expanded={closedOpen}
            onClick={() => setClosedOpen((v) => !v)}
            className={cx(
              "w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-(--ui-ink)",
              TOUCH,
            )}
          >
            Closed <span className="font-normal text-(--ui-ink-3)">{closed.length}</span>{" "}
            <span className="font-normal text-(--ui-link)">{closedOpen ? "Hide" : "Show"}</span>
          </button>
          {closedOpen ? <ol className="m-0 grid list-none gap-2 p-0">{closed.map(row)}</ol> : null}
        </section>
      ) : null}
    </div>
  );
}
