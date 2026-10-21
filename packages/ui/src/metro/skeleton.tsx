/**
 * `MetroSkeleton`: what the map shows while its first read is out (William, 10-21: no loading box,
 * no words). The map's faint dot grid with a few ghost lines and stations in muted ink, top and
 * middle of its frame, as a loaded map sits. It fills the frame it is put in, so nothing shifts
 * when the map arrives. It shows nothing for the first 150 ms (CSS delay, `.metro-skeleton`), so a
 * quick read never flashes it. A screen reader hears one word: Loading.
 */
import { cx } from "../format.js";
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

export function MetroSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div role="status" aria-label="Loading" className={cx("metro-skeleton", className)}>
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
    </div>
  );
}
