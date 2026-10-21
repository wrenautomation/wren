/**
 * The sweep: a lavender line along the two round tips of a leaf panel or band (the mark's
 * feather). Faint when a band is closed, full on hover or open; an open band adds a fainter second
 * line inside each tip. Checks and avatars stay plain. It follows `--ui-sweep` (1 on, 0 off), so
 * a look with plain corners shows none. The parent must be `relative`.
 * Source: designs/2026-10-20-design-language/design-language.src.html, `sw()`.
 */
import { useId } from "react";

interface Tip {
  /** The tip's corner: top right, or bottom left. */
  corner: "tr" | "bl";
  /** The panel's round corner, px. */
  radius?: number;
  width: number;
  height: number;
  /** How far the line sits inside the edge, px. */
  inset?: number;
  stroke?: number;
}

/** The outer and inner tips, as in the artifact. */
const TIPS: Tip[] = [
  { corner: "tr", width: 170, height: 58 },
  { corner: "bl", width: 120, height: 44 },
];
const INNER: Tip[] = [
  { corner: "tr", width: 120, height: 46, inset: 5, stroke: 1.4 },
  { corner: "bl", width: 90, height: 36, inset: 5, stroke: 1.4 },
];

/** The line along one tip: out along the edge, round the corner, down the side. */
export function sweepPath({ corner, radius = 24, width: W, height: H, inset = 0 }: Tip): string {
  const a = inset + 1;
  const r = radius - inset;
  return corner === "bl"
    ? `M${W} ${H - a}H${a + r}A${r} ${r} 0 0 1 ${a} ${H - a - r}V0`
    : `M0 ${a}H${W - a - r}A${r} ${r} 0 0 1 ${W - a} ${a + r}V${H}`;
}

function TipLine({ tip, inner, uid }: { tip: Tip; inner?: boolean; uid: string }) {
  const { corner, width: W, height: H, stroke = 2 } = tip;
  const id = `${uid}${corner}${inner ? "i" : "o"}`;
  const g = corner === "bl" ? { x1: W, y1: H, x2: 0, y2: 0 } : { x1: 0, y1: 0, x2: W, y2: H };
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      data-tip={corner}
      data-inner={inner ? "" : undefined}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" {...g}>
          <stop offset="0" stopColor="var(--ui-active)" stopOpacity="0" />
          <stop offset=".72" stopColor="var(--ui-active)" />
          <stop offset="1" stopColor="var(--ui-active)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={sweepPath(tip)}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Put it first inside a `relative` panel or band. `band` makes it faint until hover or `open`;
 * an open band adds the inner line.
 */
export function Sweep({ band = false, open = false }: { band?: boolean; open?: boolean }) {
  const uid = useId().replace(/:/g, "");
  return (
    <span
      className="ui-sweep"
      aria-hidden="true"
      data-band={band ? "" : undefined}
      data-open={band && open ? "" : undefined}
    >
      {TIPS.map((t) => (
        <TipLine key={t.corner} tip={t} uid={uid} />
      ))}
      {band ? INNER.map((t) => <TipLine key={`${t.corner}i`} tip={t} inner uid={uid} />) : null}
    </span>
  );
}
