/** The Finish timeline: filmstrip, in and out, cut edges, text bars, caption lines, cover, playhead. */
import {
  type CaptionLine,
  FPS,
  moveCutEdge,
  OVERLAY,
  snapFrame,
  snapTime,
  type TextOverlay,
  trimCuts,
} from "@wren/studio/finish";
import type { Cut } from "@wren/studio/schema";
import { Button, cx } from "@wren/ui";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
  clamp,
  type FinishEdit,
  type Picked,
  STRIP_ACROSS,
  STRIP_FRAMES,
  short,
  stamp,
  ZOOMS,
} from "./finish-data.js";
import { drag, useWidth } from "./finish-hooks.js";
import { type LayoutRange, PartsLane, type Short } from "./finish-parts.js";

// --- the timeline ---------------------------------------------------------------------------

export function Timeline({
  dur,
  t,
  playing,
  draw,
  io,
  lines,
  shorts,
  layout,
  onShort,
  strip,
  size,
  words,
  picked,
  range,
  onSeek,
  onRange,
  onPick,
  preview,
  release,
}: {
  dur: number;
  t: number;
  playing: boolean;
  draw: FinishEdit;
  io: { in: number; out: number };
  lines: readonly CaptionLine[];
  shorts: readonly Short[];
  layout: readonly LayoutRange[];
  onShort: (i: number) => void;
  strip: string | null;
  size: [number, number];
  words: readonly { s: number; e: number }[];
  picked: Picked;
  range: [number, number] | null;
  onSeek: (t: number) => void;
  onRange: (r: [number, number] | null) => void;
  onPick: (p: Picked) => void;
  preview: (v: FinishEdit) => void;
  release: () => void;
}) {
  const [frame, viewW] = useWidth<HTMLDivElement>();
  const inner = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const W = Math.max(1, viewW * zoom);
  const x = (s: number) => (s / dur) * W;
  const tAt = (clientX: number) => {
    const r = inner.current?.getBoundingClientRect();
    return r ? clamp(((clientX - r.left) / r.width) * dur, 0, dur) : 0;
  };
  const snapped = (clientX: number) => snapTime(tAt(clientX), words, dur);

  // Keep the playhead in sight while it plays, and after a zoom.
  useEffect(() => {
    const el = frame.current;
    if (!el || zoom === 1) return;
    const px = (t / dur) * W;
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 24)
      el.scrollLeft = Math.max(0, px - (playing ? 24 : el.clientWidth / 2));
  }, [t, W, zoom, dur, playing, frame]);

  const scrub = (e: ReactPointerEvent) => {
    onSeek(tAt(e.clientX));
    drag(
      e,
      (ev) => onSeek(tAt(ev.clientX)),
      () => {},
    );
  };
  const onStrip = (e: ReactPointerEvent) => {
    const a = snapped(e.clientX);
    onPick(null);
    onRange(null);
    drag(
      e,
      (ev) => {
        const b = snapped(ev.clientX);
        onRange([Math.min(a, b), Math.max(a, b)]);
      },
      (ev, moved) => {
        if (!moved) {
          onSeek(tAt(ev.clientX));
          return;
        }
        const b = snapped(ev.clientX);
        if (Math.abs(b - a) < 1 / FPS) onRange(null);
      },
    );
  };
  const onTrim = (side: "in" | "out") => (e: ReactPointerEvent) =>
    drag(
      e,
      (ev) => {
        const at = snapped(ev.clientX);
        preview({ ...draw, cuts: trimCuts(draw.cuts, dur, { [side]: at }) });
        onSeek(side === "in" ? at : at - 1 / FPS);
      },
      () => release(),
    );
  const onEdge = (i: number, side: "from" | "to") => (e: ReactPointerEvent) => {
    onPick({ kind: "cut", i });
    drag(
      e,
      (ev) => {
        const at = snapped(ev.clientX);
        preview({ ...draw, cuts: moveCutEdge(draw.cuts, i, side, at, dur) });
        onSeek(side === "from" ? at - 1 / FPS : at);
      },
      () => release(),
    );
  };
  const onBar = (i: number, part: "body" | "from" | "to") => (e: ReactPointerEvent) => {
    const o = draw.overlays[i] as TextOverlay;
    const t0 = tAt(e.clientX);
    onPick({ kind: "overlay", i });
    drag(
      e,
      (ev) => {
        const d = tAt(ev.clientX) - t0;
        const len = o.to - o.from;
        const next =
          part === "body"
            ? (() => {
                const from = snapFrame(clamp(o.from + d, 0, dur - len));
                return { ...o, from, to: snapFrame(from + len) };
              })()
            : part === "from"
              ? { ...o, from: snapFrame(clamp(o.from + d, 0, o.to - OVERLAY.minS)) }
              : { ...o, to: snapFrame(clamp(o.to + d, o.from + OVERLAY.minS, dur)) };
        preview({ ...draw, overlays: draw.overlays.map((p, j) => (j === i ? next : p)) });
        onSeek(part === "to" ? next.to - 1 / FPS : next.from);
      },
      () => release(),
    );
  };

  // Ruler ticks: the smallest step that leaves room for its label.
  const steps = [1 / FPS, 5 / FPS, 10 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((st) => (st / dur) * W >= 72) ?? 600;
  const ticks: number[] = [];
  for (let s = 0; s <= dur + 1e-6 && ticks.length < 2000; s += step) ticks.push(s);

  // Filmstrip tiles at the picture's shape; each shows the strip frame nearest its middle.
  const rowH = 48;
  const tileW = Math.max(24, rowH * (size[0] / size[1]));
  const tiles = Math.min(3000, Math.ceil(W / tileW));
  const rows = Math.ceil(STRIP_FRAMES / STRIP_ACROSS);

  const trims = (c: Cut) => c.state === "cut" && (c.from <= 0.5 / FPS || c.to >= dur - 0.5 / FPS);
  const ph = x(t);

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-1 text-[12px] text-(--ui-ink-3)">Zoom</span>
        <Button
          size="dense"
          tone="quiet"
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z as 1) - 1)] ?? 1)}
        >
          −
        </Button>
        <Button
          size="dense"
          tone="quiet"
          aria-label="Zoom in"
          disabled={zoom >= (ZOOMS.at(-1) as number)}
          onClick={() =>
            setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z as 1) + 1)] ?? 1)
          }
        >
          +
        </Button>
      </div>
      <div
        ref={frame}
        className="min-w-0 overflow-x-auto overflow-y-hidden rounded-xl border border-(--ui-hair) bg-(--ui-fill) [scrollbar-width:thin]"
      >
        <div ref={inner} className="relative select-none" style={{ width: W }}>
          {/* Ruler: press or drag to scrub. */}
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur * FPS)}
            aria-valuenow={Math.round(t * FPS)}
            aria-valuetext={stamp(t)}
            onPointerDown={scrub}
            className="relative h-6 cursor-text border-b border-(--ui-hair)"
          >
            {ticks.map((s) => (
              <span
                key={s}
                className="absolute top-0 h-full border-l border-(--ui-hair) pl-1 text-[10.5px] leading-6 text-(--ui-ink-3) [font-variant-numeric:tabular-nums]"
                style={{ left: x(s) }}
              >
                {step < 1 ? stamp(s) : short(s)}
              </span>
            ))}
            {draw.thumbnail ? (
              <span
                {...{ title: `Cover at ${stamp(draw.thumbnail.at)}` }}
                className="absolute top-1 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-(--ui-active)"
                style={{ left: x(draw.thumbnail.at) }}
              />
            ) : null}
          </div>

          {/* Filmstrip with what's cut over it: drag across to pick a part. */}
          <div
            onPointerDown={onStrip}
            className="relative cursor-crosshair overflow-hidden bg-black/80"
            style={{ height: rowH }}
          >
            {strip
              ? Array.from({ length: tiles }, (_, i) => {
                  const mid = ((i + 0.5) * tileW * dur) / W;
                  const k = Math.min(STRIP_FRAMES - 1, Math.floor((mid / dur) * STRIP_FRAMES));
                  const col = k % STRIP_ACROSS;
                  const row = Math.floor(k / STRIP_ACROSS);
                  return (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positions.
                      key={i}
                      className="absolute top-0 h-full"
                      style={{
                        left: i * tileW,
                        width: tileW,
                        backgroundImage: `url(${strip})`,
                        backgroundSize: `${STRIP_ACROSS * 100}% ${rows * 100}%`,
                        backgroundPosition: `${(col / (STRIP_ACROSS - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
                      }}
                    />
                  );
                })
              : null}
            {draw.cuts.map((c, i) =>
              c.state === "kept" ? null : (
                <span
                  key={`${c.from}-${c.to}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onRange(null);
                    onPick({ kind: "cut", i });
                    onSeek(c.from);
                  }}
                  className={cx(
                    "absolute top-0 h-full cursor-pointer transition-colors duration-150",
                    c.state === "cut"
                      ? "bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.78)_0_6px,rgb(0_0_0/0.6)_6px_12px)]"
                      : "border-x border-dashed border-white/50 bg-white/10",
                    picked?.kind === "cut" &&
                      picked.i === i &&
                      "outline-2 -outline-offset-2 outline-(--ui-active)",
                  )}
                  style={{ left: x(c.from), width: Math.max(2, x(c.to) - x(c.from)) }}
                />
              ),
            )}
            {range ? (
              <span
                className="pointer-events-none absolute top-0 h-full bg-(--ui-active)/30 outline-2 -outline-offset-2 outline-(--ui-active)"
                style={{ left: x(range[0]), width: Math.max(2, x(range[1]) - x(range[0])) }}
              />
            ) : null}
            {draw.cuts.map((c, i) =>
              c.state !== "cut" || trims(c) ? null : (
                <span key={`e-${c.from}-${c.to}`}>
                  <Handle at={x(c.from)} label="Cut start" onDown={onEdge(i, "from")} thin />
                  <Handle at={x(c.to)} label="Cut end" onDown={onEdge(i, "to")} thin />
                </span>
              ),
            )}
            <Handle at={x(io.in)} label="Start" onDown={onTrim("in")} side="in" />
            <Handle at={x(io.out)} label="End" onDown={onTrim("out")} side="out" />
          </div>

          {/* Text on the video. */}
          <div className="relative h-7 border-t border-(--ui-hair)">
            {draw.overlays.map((o, i) => {
              const sel = picked?.kind === "overlay" && picked.i === i;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: overlays repeat text; the index is the one.
                  key={i}
                  onPointerDown={onBar(i, "body")}
                  className={cx(
                    "absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-md px-2 text-[11.5px] font-medium whitespace-nowrap transition-[background-color,box-shadow] duration-150 active:cursor-grabbing",
                    sel
                      ? "bg-(--ui-active) text-(--ui-on-accent) shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
                      : "bg-(--ui-accent-tint) text-(--ui-ink)",
                  )}
                  style={{ left: x(o.from), width: Math.max(8, x(o.to) - x(o.from)) }}
                >
                  <span
                    onPointerDown={onBar(i, "from")}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                  />
                  {o.text}
                  <span
                    onPointerDown={onBar(i, "to")}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                  />
                </span>
              );
            })}
          </div>

          {/* Caption lines. */}
          <div className="relative h-7 border-t border-(--ui-hair)">
            {lines.map((l, i) => {
              const sel = picked?.kind === "line" && picked.i === i;
              return (
                <button
                  key={l.at.join()}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    onPick({ kind: "line", i });
                    onSeek(l.s);
                  }}
                  {...{ title: l.text }}
                  className={cx(
                    "absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-[5px] border-0 px-1 text-left text-[10.5px] whitespace-nowrap transition-colors duration-150",
                    sel
                      ? "bg-(--ui-ink) text-(--ui-on-ink)"
                      : "bg-(--ui-paper) text-(--ui-ink-2) hover:text-(--ui-ink)",
                  )}
                  style={{ left: x(l.s), width: Math.max(3, x(l.e) - x(l.s) - 1) }}
                >
                  {l.text}
                </button>
              );
            })}
          </div>

          {/* The Shorts, and what the long video shows when. */}
          <PartsLane shorts={shorts} layout={layout} x={x} onShort={onShort} />

          {/* The playhead, over every row. */}
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--ui-bad)"
            style={{ left: ph }}
          >
            <span className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rounded-b-[3px] bg-(--ui-bad)" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** A grip on the timeline: the clip's start or end, or a cut's edge. */
function Handle({
  at,
  label,
  onDown,
  side,
  thin,
}: {
  at: number;
  label: string;
  onDown: (e: ReactPointerEvent) => void;
  side?: "in" | "out";
  thin?: boolean;
}) {
  return (
    <span
      onPointerDown={onDown}
      {...{ title: label }}
      className={cx(
        "group absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize justify-center",
      )}
      style={{ left: at }}
    >
      <span
        className={cx(
          "h-full transition-[width,background-color] duration-150 ease-(--ui-ease)",
          thin
            ? "w-0.5 bg-white/70 group-hover:w-1 group-hover:bg-white"
            : cx(
                "w-1.5 bg-(--ui-active) group-hover:w-2",
                side === "in" ? "rounded-l-[4px]" : "rounded-r-[4px]",
              ),
        )}
      />
    </span>
  );
}
