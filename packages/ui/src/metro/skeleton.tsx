/**
 * `MetroSkeleton`: what the map shows while it loads. The map's faint dot grid with a few ghost
 * lines and stations, top and middle of its frame, as a loaded map sits, and over them one card
 * that says what is out (William, 10-24: a dedicated loading screen; 10-21 had no words). It fills
 * the frame it is put in, so nothing shifts when the map arrives. It shows nothing for the first
 * 150 ms (CSS delay, `.metro-skeleton`), so a quick read never flashes it.
 * With `ghost` (a page key) and a layout drawn there before, it draws that layout's ghost instead,
 * in the map's own frame classes (`.metro-stage`, `.mm`), so the map lands on it (11-07).
 */
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { cx } from "../format.js";
import { type Ghost, readGhost } from "./ghost.js";
import "./metro.css";

/** One ghost: a line with its stations, hub column and names as muted shapes. Scene px. */
const W = 760;
const H = 330;
const LINES = [
  { d: "M130 110H300", w: 3 },
  { d: "M130 230H300", w: 3 },
  { d: "M342 150H690", w: 12 },
  { d: "M342 230H520", w: 7 },
];
const CAPSULES = [
  { x: 40, y: 96, w: 90 },
  { x: 40, y: 216, w: 90 },
];
const STATIONS = [
  { x: 430, y: 150 },
  { x: 540, y: 150 },
  { x: 650, y: 150 },
  { x: 450, y: 230 },
];
/** Name bars above the stations, the capsules and the hub, and the zone names along the foot. */
const NAMES = [
  { x: 20, y: 78, w: 50 },
  { x: 20, y: 198, w: 42 },
  { x: 290, y: 50, w: 62 },
  { x: 408, y: 116, w: 44 },
  { x: 518, y: 116, w: 44 },
  { x: 628, y: 116, w: 44 },
  { x: 428, y: 196, w: 44 },
];
const ZONES = [
  { x: 8, w: 44 },
  { x: 330, w: 36 },
  { x: 520, w: 36 },
  { x: 640, w: 30 },
];

/** The last layout drawn here, muted: rails, stops, name bars. Sized as `MetroSvg` sizes a map. */
function GhostArt({ g }: { g: Ghost }) {
  const stage = useRef<HTMLDivElement>(null);
  // chrome over the map (notes, a wrapped bar) loads with the data: drop to where the map sat
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || g.top == null || g.vw !== innerWidth) return;
    const gap = g.top - el.getBoundingClientRect().top;
    if (gap > 0) el.style.paddingTop = `${gap}px`;
  }, [g]);
  return (
    <div ref={stage} className="metro-stage">
      <svg
        className="mm metro-skeleton-art"
        viewBox={`${g.x0} ${g.y0} ${g.w} ${g.h}`}
        width={g.w}
        height={g.h}
        style={{ "--w": `${g.w}px`, "--h": `${g.h}px`, "--r": g.w / g.h } as CSSProperties}
        aria-hidden="true"
        focusable="false"
      >
        {g.tr.map(([d, w]) => (
          <path key={d} d={d} className="sk-line" strokeWidth={w} />
        ))}
        {g.st.map(([x, y, w, h, rx]) => (
          <rect
            key={`${x}-${y}-${w}`}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={rx}
            className="sk-solid"
          />
        ))}
        {g.names.map(([x, y, w]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={7} rx={3.5} className="sk-bar" />
        ))}
      </svg>
    </div>
  );
}

export function MetroSkeleton({
  className,
  label = "Loading your map",
  ghost,
}: {
  className?: string | undefined;
  /** What is out: "Reading your map" (the data), "Drawing your map" (the layout). */
  label?: string;
  /** The page's key: draws its last layout, if this browser drew one (`MetroMap ghost`). */
  ghost?: string | undefined;
}) {
  const g = readGhost(ghost);
  if (g)
    return (
      <div role="status" aria-label={label} className={cx("metro-skeleton ghosted", className)}>
        <GhostArt g={g} />
        <div className="metro-skeleton-card">
          <span className="metro-skeleton-spin" aria-hidden="true" />
          {label}
        </div>
      </div>
    );
  return (
    <div role="status" aria-label={label} className={cx("metro-skeleton", className)}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden="true"
        focusable="false"
        className="metro-skeleton-art"
      >
        {LINES.map((l) => (
          <path key={l.d} d={l.d} className="sk-line" strokeWidth={l.w} />
        ))}
        <rect x={300} y={70} width={42} height={180} rx={21} className="sk-solid" />
        {CAPSULES.map((c) => (
          <rect key={c.y} x={c.x} y={c.y} width={c.w} height={28} rx={14} className="sk-solid" />
        ))}
        {STATIONS.map((s) => (
          <circle key={`${s.x}-${s.y}`} cx={s.x} cy={s.y} r={14} className="sk-solid" />
        ))}
        {NAMES.map((n) => (
          <rect
            key={`${n.x}-${n.y}`}
            x={n.x}
            y={n.y}
            width={n.w}
            height={8}
            rx={4}
            className="sk-bar"
          />
        ))}
        {ZONES.map((z) => (
          <rect key={z.x} x={z.x} y={H - 14} width={z.w} height={6} rx={3} className="sk-bar" />
        ))}
      </svg>
      <div className="metro-skeleton-card">
        <span className="metro-skeleton-spin" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
