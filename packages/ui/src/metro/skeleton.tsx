/**
 * `MetroSkeleton`: what the map shows while it loads. The map's faint dot grid and one card
 * that says what is out (William, 10-24: a dedicated loading screen; 10-21 had no words). It fills
 * the frame it is put in, so nothing shifts when the map arrives. It shows nothing for the first
 * 150 ms (CSS delay, `.metro-skeleton`), so a quick read never flashes it.
 * With `ghost` (a page key) and a layout drawn there before, it draws that layout's ghost instead,
 * in the map's own frame classes (`.metro-stage`, `.mm`), so the map lands on it (11-07).
 */
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { cx } from "../format.js";
import { type Ghost, type LayersGhost, readGhost } from "./ghost.js";
import "./metro.css";

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

/** The Layers view's last first fit, in view px: at its own place when the window is as wide. */
function LayersArt({ g }: { g: LayersGhost }) {
  const art = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const el = art.current;
    const at = el?.parentElement?.getBoundingClientRect();
    if (!el || !at) return;
    if (g.vw === innerWidth) {
      el.style.transform = `translate(${g.left - at.left}px, ${g.top - at.top}px)`;
      return;
    }
    // another width: the whole of it, fitted and centred
    const k = Math.min(at.width / g.bw, at.height / g.bh, 1);
    el.style.transform = `translate(${(at.width - g.bw * k) / 2}px, ${(at.height - g.bh * k) / 2}px) scale(${k})`;
  }, [g]);
  return (
    <svg
      ref={art}
      className="mm metro-skeleton-art layers"
      width={g.bw}
      height={g.bh}
      viewBox={`0 0 ${g.bw} ${g.bh}`}
      aria-hidden="true"
      focusable="false"
    >
      {g.faces.map((d, i) => (
        <polygon key={d} points={d} className={i ? "sk-face" : "sk-floor"} />
      ))}
      {g.tr.map(([d, w]) => (
        <path key={d} d={d} className="sk-line" strokeWidth={w} />
      ))}
      {g.st.map((d) => (
        <polygon key={d} points={d} className="sk-solid" />
      ))}
      {g.names.map((d) => (
        <polygon key={d} points={d} className="sk-bar" />
      ))}
    </svg>
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
  if (g && "kind" in g)
    return (
      <div role="status" aria-label={label} className={cx("metro-skeleton ghosted", className)}>
        <LayersArt g={g} />
        <div className="metro-skeleton-card">
          <span className="metro-skeleton-spin" aria-hidden="true" />
          {label}
        </div>
      </div>
    );
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
  // no layout drawn here yet: no made-up one either (11-07: it "doesn't fit the actual layout")
  return (
    <div role="status" aria-label={label} className={cx("metro-skeleton", className)}>
      <div className="metro-skeleton-card">
        <span className="metro-skeleton-spin" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
