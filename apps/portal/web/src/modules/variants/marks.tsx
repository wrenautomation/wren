/**
 * One sample, drawn by kind, with its anchors: tap a line (text), mark an area (image, page, paused
 * video), flag a moment in the video's bar (press at the start, press again at the end). An anchor
 * opens the note: works or breaks, and why. Boxes are fractions of the shown frame, so they hold
 * at any width.
 */
import { Button, cx, Icon, Input, tipProps, VIDEO_BUTTON, Video, type VideoMark } from "@wren/ui";
import type { Verdict } from "@wrenautomation/vireo/calls";
import type { Source } from "@wrenautomation/vireo/sync";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { LivePage } from "./live-page.js";
import { useTogether } from "./together.js";

export type Box = { x: number; y: number; w: number; h: number };
export type Anchor =
  | { type: "quote"; exact: string; prefix?: string; suffix?: string }
  | ({ type: "box" } & Box)
  | { type: "time"; start: number; end?: number; box?: Box };
export interface Note {
  id: number;
  anchor: Anchor | null;
  tone: "good" | "bad" | null;
  text: string | null;
}
export type Kind = "text" | "image" | "video" | "page";
export interface Sample {
  id: number;
  body: string | null;
  mediaUrl: string | null;
  posterUrl: string | null;
  /** 1-10; `verdict` is its zone (vireo D9). */
  score: number | null;
  verdict: Verdict | null;
  keptAt: string | null;
  notes: Note[];
  /** A video's footage spans: lets cuts of one footage play in step. */
  source?: Source | null;
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};
export const anchorLabel = (a: Anchor | null): string =>
  !a
    ? "Whole sample"
    : a.type === "quote"
      ? `“${a.exact.length > 60 ? `${a.exact.slice(0, 60)}…` : a.exact}”`
      : a.type === "box"
        ? "Area"
        : `${clock(a.start)}${a.end != null ? `–${clock(a.end)}` : ""}${a.box ? " · area" : ""}`;

const TONE_LINE = { good: "bg-(--ui-good-tint)", bad: "bg-(--ui-bad-tint)" } as const;
const TONE_EDGE = { good: "border-(--ui-good)", bad: "border-(--ui-bad)" } as const;

/** Drag a box over whatever sits under it; `on` false lets clicks through (video controls). */
function BoxLayer({
  on,
  boxes,
  onBox,
}: {
  on: boolean;
  boxes: { box: Box; tone: Note["tone"]; live?: boolean }[];
  onBox: (b: Box) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; b: Box } | null>(null);
  const at = (e: PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  return (
    <div
      ref={ref}
      className={cx("absolute inset-0", on ? "cursor-crosshair touch-none" : "pointer-events-none")}
      onPointerDown={(e) => {
        if (!on) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const p = at(e);
        setDrag({ x0: p.x, y0: p.y, b: { x: p.x, y: p.y, w: 0, h: 0 } });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = at(e);
        setDrag({
          ...drag,
          b: {
            x: Math.min(drag.x0, p.x),
            y: Math.min(drag.y0, p.y),
            w: Math.abs(p.x - drag.x0),
            h: Math.abs(p.y - drag.y0),
          },
        });
      }}
      onPointerUp={() => {
        if (drag && drag.b.w > 0.02 && drag.b.h > 0.02) onBox(drag.b);
        setDrag(null);
      }}
    >
      {[...boxes, ...(drag ? [{ box: drag.b, tone: null, live: true }] : [])].map((b, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: boxes have no id while drawn
          key={i}
          className={cx(
            "absolute rounded-[3px] border-2",
            b.tone ? TONE_EDGE[b.tone] : "border-(--ui-accent)",
            b.live && "border-dashed",
          )}
          style={{
            left: `${b.box.x * 100}%`,
            top: `${b.box.y * 100}%`,
            width: `${b.box.w * 100}%`,
            height: `${b.box.h * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

/** A note's call on its part: works or breaks. */
const TONES = [
  { v: "good", label: "Works", icon: "check", on: "bg-(--ui-good-tint) text-(--ui-good-ink)" },
  { v: "bad", label: "Breaks", icon: "close", on: "bg-(--ui-bad-tint) text-(--ui-bad)" },
] as const;
const TONE_CHIP =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-(--ui-leaf-chip) border-0 bg-(--ui-fill) px-2.5 text-[13px] font-semibold text-(--ui-ink-2) transition-colors hover:text-(--ui-ink) pointer-coarse:h-11";

/** The note on a waiting anchor: where, works or breaks, why. Enter saves, Esc drops it. */
function NoteStrip({
  anchor,
  onSave,
  onCancel,
}: {
  anchor: Anchor | null;
  onSave: (tone: Note["tone"], text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [tone, setTone] = useState<Note["tone"]>(null);
  const ready = !!tone || !!text.trim();
  const save = () => ready && onSave(tone, text);
  return (
    <fieldset aria-label="New note" className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <p className="m-0 text-[12.5px] text-(--ui-ink-2) wrap-anywhere">
        Note on {anchorLabel(anchor)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {TONES.map((x) => (
          <button
            key={x.v}
            type="button"
            aria-pressed={tone === x.v}
            onClick={() => setTone(tone === x.v ? null : x.v)}
            className={cx(TONE_CHIP, tone === x.v && x.on)}
          >
            <Icon name={x.icon} size={13} />
            {x.label}
          </button>
        ))}
        {/* edit-ok: lives only with its pending anchor, which a reload drops */}
        <Input
          autoFocus
          aria-label="Why"
          value={text}
          placeholder="Why? Optional"
          className="h-8 min-h-8 min-w-40 flex-1 py-1 pointer-coarse:h-11"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
        />
        <Button size="dense" tone="primary" onClick={save} disabled={!ready}>
          Save
        </Button>
        <Button
          size="dense"
          tone="quiet"
          onClick={onCancel}
          {...tipProps("Drop this note", { keys: "Esc" })}
        >
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function TextBody({
  body,
  notes,
  onLine,
}: {
  body: string;
  notes: Note[];
  onLine: (a: Anchor) => void;
}) {
  const lines = body.split("\n");
  const toneOf = (line: string) =>
    notes.find((n) => n.anchor?.type === "quote" && line.includes(n.anchor.exact))?.tone ?? null;
  return (
    <div className="text-[14px] leading-[1.6] text-(--ui-ink)">
      {lines.map((line, i) =>
        line.trim() ? (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            key={i}
            className={cx(
              "-mx-1 block w-[calc(100%+8px)] cursor-pointer rounded-[4px] px-1 text-left whitespace-pre-wrap wrap-anywhere hover:bg-(--ui-hover)",
              toneOf(line) && TONE_LINE[toneOf(line) as "good" | "bad"],
            )}
            onClick={() => onLine({ type: "quote", exact: line.trim() })}
          >
            {line}
          </button>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <div key={i} className="h-3" />
        ),
      )}
    </div>
  );
}

function VideoBody({
  sample,
  boxing,
  live,
  held,
  onAnchor,
}: {
  sample: Sample;
  boxing: boolean;
  live: Box | undefined;
  /** A moment waiting for its note: dashed on the scrubber. */
  held: { start: number; end?: number } | undefined;
  onAnchor: (a: Anchor) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const cut = useTogether(sample.id, ref, sample.source?.spans ?? null);
  const [start, setStart] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const now = () => ref.current?.currentTime ?? 0;
  // a moment's box shows only over its range (a lone moment: ±1s)
  const near = (a: { start: number; end?: number }) =>
    t >= a.start - (a.end == null ? 1 : 0) && t <= (a.end ?? a.start + 1);
  const moments = sample.notes.filter((n) => n.anchor?.type === "time");
  const shownBoxes = moments
    .filter((n) => n.anchor?.type === "time" && n.anchor.box && near(n.anchor))
    .map((n) => ({ box: (n.anchor as { box: Box }).box, tone: n.tone, live: false }))
    .concat(live ? [{ box: live, tone: null, live: true }] : []);
  const marks: VideoMark[] = moments.map((n) => {
    const a = n.anchor as { start: number; end?: number };
    return { id: n.id, start: a.start, end: a.end, tone: n.tone };
  });
  if (start != null) marks.push({ id: "flag", start, end: Math.max(t, start), live: true });
  else if (held) marks.push({ id: "held", start: held.start, end: held.end, live: true });
  // first press: the start; second: the end (a moment alone when under 0.2s apart)
  const flag = () => {
    if (start == null) return setStart(now());
    const end = now();
    onAnchor(end > start + 0.2 ? { type: "time", start, end } : { type: "time", start });
    setStart(null);
  };
  if (!sample.mediaUrl) return <Missing />;
  return (
    <Video
      ref={ref}
      src={sample.mediaUrl}
      poster={sample.posterUrl}
      marks={marks}
      locked={boxing}
      onTime={setT}
      frame={
        <>
          {cut && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-[13px] font-semibold text-white">
              Cut here
            </div>
          )}
          <BoxLayer
            on={boxing}
            boxes={shownBoxes}
            onBox={(box) => {
              ref.current?.pause();
              onAnchor({ type: "time", start: now(), box });
            }}
          />
        </>
      }
      tools={
        <button
          type="button"
          className={VIDEO_BUTTON}
          aria-pressed={start != null}
          onClick={flag}
          {...tipProps(start == null ? "Mark a moment" : `End the moment from ${clock(start)}`, {
            as: "name",
          })}
        >
          <Icon name="flag" size={15} />
        </button>
      }
    />
  );
}

const Missing = () => (
  <div className="flex aspect-video items-center justify-center rounded-(--ui-radius) bg-(--ui-tile) text-[13px] text-(--ui-ink-3)">
    File not reachable here
  </div>
);

/** A sample's body by kind, with its anchors. `boxing` turns drag-a-box on (image, page, video). */
export function SampleBody({
  kind,
  sample,
  boxing,
  pending = null,
  onAnchor,
}: {
  kind: Kind;
  sample: Sample;
  boxing: boolean;
  /** The anchor waiting for its note: its box drawn dashed. */
  pending?: Anchor | null;
  onAnchor: (a: Anchor) => void;
}): ReactNode {
  const live =
    pending?.type === "box" ? pending : pending?.type === "time" ? pending.box : undefined;
  const boxes = [
    ...sample.notes
      .filter((n) => n.anchor?.type === "box")
      .map((n) => ({ box: n.anchor as Box, tone: n.tone })),
    ...(live ? [{ box: live, tone: null, live: true }] : []),
  ];
  if (kind === "text")
    return <TextBody body={sample.body ?? ""} notes={sample.notes} onLine={onAnchor} />;
  if (kind === "video")
    return (
      <VideoBody
        sample={sample}
        boxing={boxing}
        live={live}
        held={pending?.type === "time" ? pending : undefined}
        onAnchor={onAnchor}
      />
    );
  if (kind === "image")
    return sample.mediaUrl ? (
      <div className="relative overflow-hidden rounded-(--ui-radius) bg-(--ui-tile)">
        <img src={sample.mediaUrl} alt="" className="block w-full select-none" draggable={false} />
        <BoxLayer on={boxing} boxes={boxes} onBox={(b) => onAnchor({ type: "box", ...b })} />
      </div>
    ) : (
      <Missing />
    );
  // A page that runs code: a link on its own origin.
  if (sample.mediaUrl)
    return (
      <LivePage id={sample.id} url={sample.mediaUrl} still={sample.posterUrl}>
        <BoxLayer on={boxing} boxes={boxes} onBox={(b) => onAnchor({ type: "box", ...b })} />
      </LivePage>
    );
  // A static page: its html in a frame with no origin of its own (nothing of ours reachable).
  return (
    <div className="relative overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-white">
      <iframe
        title={`Sample ${sample.id}`}
        sandbox="allow-scripts"
        srcDoc={sample.body ?? ""}
        className="block h-[560px] w-full"
      />
      <BoxLayer on={boxing} boxes={boxes} onBox={(b) => onAnchor({ type: "box", ...b })} />
    </div>
  );
}

export { NoteStrip };
