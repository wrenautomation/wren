/**
 * One sample, drawn by kind, with its anchors: tap a line (text), drag a box (image, page, paused
 * video), mark a moment (video). An anchor opens the note strip: good here, bad here, why.
 * Boxes are fractions of the shown frame, so they hold at any width.
 */
import { Button, cx, Input } from "@wren/ui";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";

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
  verdict: "amazing" | "good" | "bad" | null;
  keptAt: string | null;
  notes: Note[];
}

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
        ? "Region"
        : `${clock(a.start)}${a.end != null ? `–${clock(a.end)}` : ""}${a.box ? " · region" : ""}`;

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

/** The note strip under a sample while an anchor waits for its call. */
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
  const save = (t: Note["tone"]) => onSave(t, text);
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-tile) p-2.5">
      <div className="text-[12px] text-(--ui-ink-2)">{anchorLabel(anchor)}</div>
      {/* edit-ok: lives only with its pending anchor, which a reload drops */}
      <Input
        autoFocus
        value={text}
        placeholder="Why? (optional)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(tone);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="dense"
          tone={tone === "good" ? "primary" : "secondary"}
          onClick={() => (text ? save("good") : setTone("good"))}
        >
          Good here
        </Button>
        <Button
          size="dense"
          tone={tone === "bad" ? "primary" : "secondary"}
          onClick={() => (text ? save("bad") : setTone("bad"))}
        >
          Bad here
        </Button>
        <span className="flex-1" />
        <Button size="dense" tone="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="dense" onClick={() => save(tone)} disabled={!tone && !text.trim()}>
          Save
        </Button>
      </div>
    </div>
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
  onAnchor,
}: {
  sample: Sample;
  boxing: boolean;
  live: Box | undefined;
  onAnchor: (a: Anchor) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [dur, setDur] = useState(0);
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
  if (!sample.mediaUrl) return <Missing />;
  return (
    <div>
      <div className="relative overflow-hidden rounded-(--ui-radius) bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: our own drafts under review, no captions yet */}
        <video
          ref={ref}
          src={sample.mediaUrl}
          poster={sample.posterUrl ?? undefined}
          controls={!boxing}
          playsInline
          preload="metadata"
          className="block aspect-video w-full"
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onSeeked={(e) => setT(e.currentTarget.currentTime)}
        />
        <BoxLayer
          on={boxing}
          boxes={shownBoxes}
          onBox={(box) => {
            ref.current?.pause();
            onAnchor({ type: "time", start: now(), box });
          }}
        />
      </div>
      {dur > 0 && (
        <div className="relative mt-1.5 h-2 rounded-full bg-(--ui-tile)">
          {moments.map((n) => {
            const a = n.anchor as { start: number; end?: number };
            return (
              <button
                type="button"
                key={n.id}
                aria-label={`Go to ${clock(a.start)}`}
                className={cx(
                  "absolute top-0 h-2 min-w-1.5 rounded-full",
                  n.tone === "bad"
                    ? "bg-(--ui-bad)"
                    : n.tone === "good"
                      ? "bg-(--ui-good)"
                      : "bg-(--ui-accent)",
                )}
                style={{
                  left: `${(a.start / dur) * 100}%`,
                  width: `${(((a.end ?? a.start) - a.start) / dur) * 100}%`,
                }}
                onClick={() => {
                  if (ref.current) ref.current.currentTime = a.start;
                }}
              />
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {start == null ? (
          <Button size="dense" icon="flag" onClick={() => setStart(now())}>
            Mark moment
          </Button>
        ) : (
          <>
            <Button
              size="dense"
              tone="primary"
              onClick={() => {
                const end = now();
                onAnchor(
                  end > start + 0.2 ? { type: "time", start, end } : { type: "time", start },
                );
                setStart(null);
              }}
            >
              End at here ({clock(start)} →)
            </Button>
            <Button
              size="dense"
              onClick={() => {
                onAnchor({ type: "time", start });
                setStart(null);
              }}
            >
              Just {clock(start)}
            </Button>
          </>
        )}
        <span className="text-[12px] text-(--ui-ink-3)">
          Play, then mark where it works or breaks.
        </span>
      </div>
    </div>
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
    return <VideoBody sample={sample} boxing={boxing} live={live} onAnchor={onAnchor} />;
  if (kind === "image")
    return sample.mediaUrl ? (
      <div className="relative overflow-hidden rounded-(--ui-radius) bg-(--ui-tile)">
        <img src={sample.mediaUrl} alt="" className="block w-full select-none" draggable={false} />
        <BoxLayer on={boxing} boxes={boxes} onBox={(b) => onAnchor({ type: "box", ...b })} />
      </div>
    ) : (
      <Missing />
    );
  // A page: its html in a frame with no origin of its own (scripts run, nothing of ours reachable).
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
