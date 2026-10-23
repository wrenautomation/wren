/**
 * `MetroSvg`: a positioned scene drawn as React SVG. Port of `draw(sc)` in the design language
 * artifact (metro-render.js). Pure: a scene in, elements out. Every mark is keyed by its id, so a
 * level switch can glide the marks that stay (map.tsx). No colour is fixed here: lines read
 * `--ui-line-N`, the rest reads the ink and paper tokens, so night comes from the tokens.
 */
import { type CSSProperties, type ReactNode, type Ref, useId } from "react";
import { cx } from "../format.js";
import {
  beside,
  octPts,
  rounded,
  routeOf,
  trackEnds,
  xferGeometry,
  xferWidth,
} from "./geometry.js";
import {
  asButton,
  Badge,
  Capsule,
  Chip,
  CountDot,
  FoldTab,
  MARK_WORD,
  Marker,
  MarkTag,
  OpenedOutline,
  OpenedTab,
  Pill,
  Ring,
  XferLabel,
} from "./marks.js";
import {
  isBadge,
  isCapsule,
  isRing,
  lineColour,
  type Mark,
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

/**
 * The stroke of a track. An added or changed track takes the mark's colour from the CSS; the rest
 * keep their line colour. (An inline stroke would win over the CSS, so the mark leaves it out.)
 */
const strokeOf = (mark: Mark | undefined, colour: string) =>
  mark === "added" || mark === "changed" ? undefined : colour;

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
  const endsOf = trackEnds(scene);
  const colours = scene;
  /** The line that is lit keeps full strength; CSS dims every other `[data-l]` (`.mm.focus`). */
  const on = (l: string) => !!lit && l === lit;
  const click = !!scene.click;
  const isStill = still ?? scene.still;
  const land = intro ? landTimes(scene) : null;
  const H = scene.h;
  const Wd = scene.w ?? 960;
  const X0 = scene.x0 ?? 0;

  const zones: ReactNode[] = [];
  (scene.zones ?? []).forEach(([x0, x1, n], i) => {
    // A cropped scene (focus) draws only the zones in view, and keeps a name on screen.
    if (x1 <= X0 || x0 >= X0 + Wd) return;
    if (i && x0 > X0)
      zones.push(<line key={`zl${x0}`} className="zl" x1={x0} y1={6} x2={x0} y2={H - 22} />);
    zones.push(
      <text key={`zt${x0}`} className="zt" x={Math.max(x0 + (i ? 8 : 0), X0 + 8)} y={H - 8}>
        {n}
      </text>,
    );
  });

  /** A track's diff tag, beside it. A track with no pill of its own is named by the tag. */
  const tag = (k: string, r: MetroTrack, pts: Point[], l: string | undefined) => {
    const named = !(r.who && r.who !== "auto");
    // A track with a pill keeps the middle; the tag sits nearer its start.
    const [x, y] = beside(pts, named ? 0.25 : 0.18, 20);
    const mark = r.mark as Mark;
    const nm = (id: string | undefined) => {
      const s = id ? byId.get(id) : undefined;
      return (s && "n" in s && s.n) || id || "?";
    };
    return (
      <MarkTag
        key={`mt-${k}`}
        mark={mark}
        x={x}
        y={y}
        l={l}
        named={named}
        label={`Track from ${nm(r.a)} to ${nm(r.b)}, ${MARK_WORD[mark]}`}
      />
    );
  };

  const cases: ReactNode[] = [];
  const tracks: ReactNode[] = [];
  const dots: ReactNode[] = [];
  const labels: ReactNode[] = [];
  scene.tr.forEach((r, i) => {
    const e = endsOf(r);
    if (!e) return;
    const [a, c] = e;
    const k = r.id ?? `t${i}`;
    const tid = click && r.id ? r.id : undefined;
    if (r.stub) {
      const l = r.l ?? "out";
      const path = rounded(octPts(a, c));
      const out = r.stub.side === "out";
      const tip = out ? c : a;
      labels.push(
        <g
          key={`stub-${k}`}
          className="stub"
          data-l={l}
          data-stub={r.stub.part.id}
          data-stub-kind={r.stub.part.kind}
          {...asButton(r.stub.label)}
        >
          <path className="stub-hit" d={path} />
          <path
            className="stub-trk"
            d={path}
            style={{ stroke: lineColour(colours, l), strokeWidth: WEIGHT[r.w ?? "front"] }}
          />
          <text
            className="stub-lab"
            x={tip[0] + (out ? 8 : -8)}
            y={tip[1] + 4}
            textAnchor={out ? "start" : "end"}
          >
            {r.stub.label}
          </text>
        </g>,
      );
      return;
    }
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
          {...(r.mark ? { "data-mark": r.mark } : {})}
          d={d}
          style={{ stroke: strokeOf(r.mark, lineColour(colours, l)) }}
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
          mark={r.mark}
        />,
      );
      if (r.mark)
        labels.push(
          <MarkTag
            key={`mt-${k}`}
            mark={r.mark}
            l={l}
            x={m[0] + xferWidth(r.lab ?? "") / 2 + 12}
            y={m[1]}
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
      tracks.push(
        <path
          key={`s-${k}`}
          className={cx("spur", bad && "bad")}
          {...(r.mark ? { "data-mark": r.mark } : {})}
          d={d}
        />,
        hit(d),
      );
      if (r.mark) labels.push(tag(k, r, r.pts ?? octPts(a, c), undefined));
      return;
    }

    const l = r.l ?? "out";
    const route = routeOf(r, a, c);
    const d = rounded(route, r.pts ? r.r : undefined);
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
        {...(r.mark ? { "data-mark": r.mark } : {})}
        d={d}
        {...draw}
        style={{ stroke: strokeOf(r.mark, lineColour(colours, l)), strokeWidth: w }}
      />,
      hit(d, l),
    );
    if (r.mark) labels.push(tag(k, r, route, l));
    if (r.mark !== "removed" && r.k !== "plan" && (l !== "out" || r.mv) && !(isStill && !r.mv)) {
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
    if (r.cond && !r.condShared) {
      // A rail's chip sits on the rail, under the row.
      const m = r.cat ?? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + (r.back ?? 0)];
      labels.push(
        <g key={`cd-${k}`} className={cx("cond", r.cond === "else" && "else")}>
          <Chip x={m[0]} y={m[1]} t={r.cond} icon={r.condGlyph ?? null} />
        </g>,
      );
    }
    if (r.who && r.who !== "auto") {
      // The layout says where the pill sits, or that it folded to a dot; a hand-made scene may not.
      const m = r.at ?? [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      labels.push(
        r.dot ? (
          <CountDot
            key={`p-${k}`}
            x={m[0]}
            y={m[1]}
            n={r.dot}
            who={r.who}
            late={r.late}
            id={tid}
            mark={r.mark}
          />
        ) : (
          <Pill
            key={`p-${k}`}
            x={m[0]}
            y={m[1] + (r.bdy ?? 0)}
            who={r.who}
            late={r.late}
            id={tid}
            mark={r.mark}
          />
        ),
      );
    }
  });

  const stations = scene.st.map((s) => {
    const sel = selected === s.id;
    if (isCapsule(s)) return <Capsule key={s.id} c={s} selected={sel} on={on(s.l)} />;
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
  const acts = click || scene.st.some((s) => !("t" in s)) || scene.tr.some((r) => r.stub);
  const grid = `${uid}dg`;
  return (
    <svg
      ref={ref}
      className={cx("mm", lit && "focus", intro && "ld")}
      viewBox={`${X0} 0 ${Wd} ${H}`}
      // One scene px is one css px, so a label reads at its real size. A glyph table sets its own.
      {...(width ? { width, height: (H / Wd) * width } : { width: Wd, height: H })}
      // The real width, for a frame that fits the map to its page (`.metro-fit`).
      style={{ "--w": `${Wd}px` } as CSSProperties}
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
          <rect x={X0} width={Wd} height={H} fill={`url(#${grid})`} />
        </>
      )}
      {zones}
      {(scene.opened ?? []).map((o) => (
        <OpenedOutline key={`on${o.grp}`} o={o} colours={colours} />
      ))}
      {/* Fold tabs sit behind the tracks, faded, until a pointer is on one. */}
      {(scene.folds ?? []).map((f) => (
        <g key={`f${f.grp}`} className="tab">
          <FoldTab {...f} />
        </g>
      ))}
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
      {stations}
      {/* An open group's fold leaf sits under its circle, as the expand leaf did: in front. */}
      {(scene.opened ?? []).map((o) => (
        <OpenedTab key={`ok${o.grp}`} o={o} />
      ))}
      {labels}
    </svg>
  );
}
