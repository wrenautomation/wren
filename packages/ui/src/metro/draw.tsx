/**
 * `MetroSvg`: a positioned scene drawn as React SVG. Port of `draw(sc)` in the design language
 * artifact (metro-render.js). Pure: a scene in, elements out. Every mark is keyed by its id, so a
 * level switch can glide the marks that stay (map.tsx). No colour is fixed here: lines read
 * `--ui-line-N`, the rest reads the ink and paper tokens, so night comes from the tokens.
 */
import { type ReactNode, type Ref, useId } from "react";
import { cx } from "../format.js";
import { octPts, rounded } from "./geometry.js";
import {
  Badge,
  Capsule,
  Chip,
  FoldTab,
  Marker,
  Pill,
  Ring,
  XferLabel,
  xferGeometry,
} from "./marks.js";
import {
  isBadge,
  isCapsule,
  isRing,
  lineColour,
  type MetroScene,
  type MetroTrack,
  type Point,
  WEIGHT,
} from "./types.js";

export interface MetroSvgProps {
  scene: MetroScene;
  /** No dots move, whatever the scene says. */
  still?: boolean | undefined;
  /** No dot grid (a glyph in a table). */
  bare?: boolean | undefined;
  /** The picked station, group or track id. */
  selected?: string | null | undefined;
  /** First load: lines draw, stations land as the line passes, labels follow, numbers tick last. */
  intro?: boolean | undefined;
  /** A line to light; the others dim. */
  lit?: string | null | undefined;
  /** The glyph tables set the svg's own size. */
  width?: number | undefined;
  ref?: Ref<SVGSVGElement>;
}

/** Where a track starts and ends; null when it has neither station nor points. */
function ends(r: MetroTrack, at: (id: string, o: number) => Point | null): [Point, Point] | null {
  const a = r.pa ?? (r.a ? at(r.a, r.oa ?? r.o ?? 0) : r.pts?.[0]);
  const c = r.pc ?? (r.b ? at(r.b, r.ob ?? r.o ?? 0) : r.pts ? r.pts[r.pts.length - 1] : a);
  return a && c ? [a, c] : null;
}

/**
 * Seconds into the first load when the line reaches a station. As the artifact: station i pops at
 * 0.5 + i * 0.55 s, in order across the map. A map with many stations packs them into the first
 * 2.4 s the line takes, so the last lands as the line ends.
 */
export function landTimes(scene: MetroScene): (x: number) => number {
  const xs = [...new Set(scene.st.map((s) => s.x ?? 0))].sort((a, b) => a - b);
  const step = xs.length > 4 ? Math.min(0.55, 1.9 / (xs.length - 1)) : 0.55;
  return (x) => 0.5 + Math.max(0, xs.indexOf(x)) * step;
}

/** Draw a scene. */
export function MetroSvg({ scene, still, bare, intro, selected, lit, width, ref }: MetroSvgProps) {
  const uid = useId().replace(/\W/g, "");
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const at = (id: string, o: number): Point | null => {
    const s = byId.get(id);
    return s ? [s.x ?? 0, s.y + o] : null;
  };
  const colours = scene;
  /** The line that is lit keeps full strength; CSS dims every other `[data-l]` (`.mm.focus`). */
  const on = (l: string) => !!lit && l === lit;
  const click = !!scene.click;
  const isStill = still ?? scene.still;
  const land = intro ? landTimes(scene) : null;
  const H = scene.h;
  const Wd = scene.w ?? 960;

  const zones: ReactNode[] = [];
  (scene.zones ?? []).forEach(([x0, , n], i) => {
    if (i) zones.push(<line key={`zl${x0}`} className="zl" x1={x0} y1={6} x2={x0} y2={H - 22} />);
    zones.push(
      <text key={`zt${x0}`} className="zt" x={x0 + (i ? 8 : 0)} y={H - 8}>
        {n}
      </text>,
    );
  });

  const cases: ReactNode[] = [];
  const tracks: ReactNode[] = [];
  const dots: ReactNode[] = [];
  const labels: ReactNode[] = [];
  scene.tr.forEach((r, i) => {
    const e = ends(r, at);
    if (!e) return;
    const [a, c] = e;
    const k = r.id ?? `t${i}`;
    const tid = click && r.id ? r.id : undefined;
    const isSel = !!tid && selected === tid;
    const hit = (d: string, l?: string) =>
      tid ? (
        <path
          key={`h-${k}`}
          className={cx("hit", isSel && "sel", l && on(l) && "on")}
          data-tr={tid}
          {...(l ? { "data-l": l } : {})}
          d={d}
        />
      ) : null;

    if (r.k === "xfer") {
      const l = r.l ?? "out";
      const { d, m } = xferGeometry(a, c, r.f);
      cases.push(
        <path
          key={`c-${k}`}
          className={cx("case", on(l) && "on")}
          data-l={l}
          d={d}
          style={{ strokeWidth: 10 }}
        />,
      );
      tracks.push(
        <path
          key={`x-${k}`}
          className={cx("xfer", on(l) && "on")}
          data-l={l}
          d={d}
          style={{ stroke: lineColour(colours, l) }}
        />,
        hit(d, l),
      );
      labels.push(
        <XferLabel
          key={`xp-${k}`}
          m={m}
          lab={r.lab ?? ""}
          colour={lineColour(colours, l)}
          l={l}
          on={on(l)}
          id={tid}
        />,
      );
      return;
    }

    if (r.k === "exit") {
      const d = r.pts ? rounded(r.pts) : rounded(octPts(a, c));
      if (r.cond) {
        const m = r.cat ?? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        labels.push(
          <g key={`cd-${k}`} className="cond">
            <Chip x={m[0]} y={m[1]} t={r.cond} icon={r.condGlyph ?? null} />
          </g>,
        );
      }
      const bad = r.b ? (byId.get(r.b) as { bad?: boolean } | undefined)?.bad : false;
      tracks.push(<path key={`s-${k}`} className={cx("spur", bad && "bad")} d={d} />, hit(d));
      return;
    }

    const l = r.l ?? "out";
    const d = r.pts ? rounded(r.pts, r.r) : rounded(octPts(a, c));
    const w = WEIGHT[r.w ?? "front"];
    // First load: the line draws along its length (a dotted plan line fades in instead).
    const draw = intro && r.k !== "plan" ? { pathLength: 1 } : {};
    cases.push(
      <path
        key={`c-${k}`}
        className={cx("case", on(l) && "on")}
        data-l={l}
        d={d}
        {...draw}
        style={{ strokeWidth: w + 6 }}
      />,
    );
    tracks.push(
      <path
        key={`t-${k}`}
        className={cx("trk", r.k === "plan" && "plan", r.k === "ab" && "ab", on(l) && "on")}
        data-l={l}
        d={d}
        {...draw}
        style={{ stroke: lineColour(colours, l), strokeWidth: w }}
      />,
      hit(d, l),
    );
    if (r.k !== "plan" && (l !== "out" || r.mv) && !(isStill && !r.mv)) {
      const n = r.dots ?? 1;
      const du = r.dur ?? 4 + (i % 3);
      for (let j = 0; j < n; j++) {
        dots.push(
          <circle
            key={`m-${k}-${j}`}
            className={cx("mv", on(l) && "on")}
            data-l={l}
            r={r.w === "core" ? 3.4 : l === "out" ? 3 : 2.6}
          >
            <animateMotion
              dur={`${du}s`}
              begin={`${(-j * du) / n - i * 0.7}s`}
              repeatCount="indefinite"
              path={d}
            />
          </circle>,
        );
      }
    }
    if (r.cond) {
      const m = r.cat ?? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      labels.push(
        <g key={`cd-${k}`} className={cx("cond", r.cond === "else" && "else")}>
          <Chip x={m[0]} y={m[1]} t={r.cond} icon={r.condGlyph ?? null} />
        </g>,
      );
    }
    if (r.who && r.who !== "auto") {
      const m = r.at ?? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      labels.push(
        <Pill key={`p-${k}`} x={m[0]} y={m[1] + (r.bdy ?? 0)} who={r.who} late={r.late} id={tid} />,
      );
    }
  });

  const stations = scene.st.map((s) => {
    const sel = selected === s.id;
    if (isCapsule(s))
      return <Capsule key={s.id} c={s} colours={colours} selected={sel} on={on(s.l)} />;
    if (isRing(s)) return <Ring key={s.id} c={s} colours={colours} selected={sel} on={on(s.l)} />;
    if (isBadge(s)) return <Badge key={s.id} c={s} colours={colours} selected={sel} on={on(s.l)} />;
    const l = s.ln ? (scene.lines?.[s.ln]?.l ?? s.ln) : undefined;
    return (
      <Marker
        key={s.id}
        s={s}
        click={click}
        selected={sel}
        l={l}
        on={!!l && on(l)}
        at={land ? land(s.x) : undefined}
      />
    );
  });

  // A map you can act on is a group of buttons; a still picture is an image.
  const acts = click || scene.st.some((s) => !("t" in s));
  const grid = `${uid}dg`;
  return (
    <svg
      ref={ref}
      className={cx("mm", lit && "focus", intro && "ld")}
      viewBox={`0 0 ${Wd} ${H}`}
      {...(width ? { width, height: (H / Wd) * width } : {})}
      role={acts ? "group" : "img"}
      aria-label={scene.title ?? "Map"}
    >
      <title>{scene.title ?? "Map"}</title>
      {bare ? null : (
        <>
          <defs>
            <pattern id={grid} width={16} height={16} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={1} />
            </pattern>
          </defs>
          <rect width={Wd} height={H} fill={`url(#${grid})`} />
        </>
      )}
      {zones}
      {cases}
      {tracks}
      {dots}
      {(scene.frames ?? []).map((f) => (
        <g key={`fr${f.x}-${f.y}`} className="brk">
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={16} />
        </g>
      ))}
      {(scene.chips ?? []).map((c) => (
        <Chip key={`ch${c.x}-${c.y}`} {...c} />
      ))}
      {(scene.folds ?? []).map((f) => (
        <FoldTab key={`f${f.grp}`} {...f} />
      ))}
      {stations}
      {labels}
    </svg>
  );
}
