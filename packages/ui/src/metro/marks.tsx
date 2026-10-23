/**
 * The metro map's marks. One component per mark, used by every map and by the glyph tables, so the
 * spec and the app cannot drift apart. Ported from designs/2026-10-20-design-language/metro-render.js.
 * Glyphs are the kit's (icons.tsx); the map's CSS (`.ic`) sets their stroke.
 */
import type { CSSProperties, ReactNode } from "react";
import { cx, initials } from "../format.js";
import { type IconName, SvgGlyph } from "../icons.js";
import {
  chipWidth,
  DOT,
  GLYPH_SIZE,
  labelOf,
  leafPath,
  markerBox,
  pillWidth,
  ruleWidth,
  TAB_ROOM,
  textWidth,
  xferWidth,
} from "./geometry.js";
import {
  type BadgeStation,
  type CapsuleStation,
  type ChipSpec,
  type FoldSpec,
  lineColour,
  type Mark,
  type MarkStation,
  type MetroScene,
  type OpenedSpec,
  type Point,
  type RingStation,
  type StationKind,
} from "./types.js";

/** The glyph each station kind wears. A split or join gate wears none. */
export const STATION_GLYPH: Record<Exclude<StationKind, "par">, IconName> = {
  hub: "inbox",
  att: "eye",
  time: "clock",
  cash: "dollar",
  exit: "exit",
  plan: "plus",
  dec: "split",
  race: "bolt",
  ab: "percent",
  ok: "approve",
  link: "shared",
};

type Colours = Pick<MetroScene, "colours">;

/** The word and the tag glyph of each diff mark. */
export const MARK_WORD: Record<Mark, string> = {
  added: "added",
  changed: "changed",
  removed: "removed",
};
export const MARK_GLYPH: Record<Mark, string> = { added: "+", changed: "~", removed: "\u2212" };

/** A name with its diff mark said at the end: "Replied, 9, added". */
const marked = (name: string, mark: Mark | undefined) =>
  mark ? `${name}, ${MARK_WORD[mark]}` : name;

/** What a mark says to a screen reader: its name, its count and its diff mark. */
const nameOf = (s: Pick<MarkStation, "n" | "s" | "t" | "mark">) =>
  marked(s.n ? (s.s ? `${s.n}, ${s.s}` : s.n) : s.t, s.mark);

/**
 * The small tag of a diff mark: a dot with + (added), ~ (changed) or the minus sign (removed).
 * It is hidden from a screen reader unless `named`: then it is the one name the part has.
 */
export function MarkTag({
  x,
  y,
  mark,
  l,
  named,
  label,
}: {
  x: number;
  y: number;
  mark: Mark;
  /** The line it sits on, so it dims with the line. */
  l?: string | undefined;
  named?: boolean | undefined;
  /** What the tag says when named, ending in the mark word. */
  label?: string | undefined;
}) {
  return (
    <g
      className="mtag"
      data-mark={mark}
      {...(l ? { "data-l": l } : {})}
      {...(named
        ? { role: "img", "aria-label": label ?? MARK_WORD[mark] }
        : { "aria-hidden": true })}
    >
      <circle cx={x} cy={y} r={8} />
      <text x={x} y={y + 4} textAnchor="middle">
        {MARK_GLYPH[mark]}
      </text>
    </g>
  );
}

/** What makes an SVG group a button: SVG has no button element, so it takes the role and focus. */
export const asButton = (label: string) =>
  ({ tabIndex: 0, role: "button", "aria-label": label }) as const;

/** Seconds a label waits after its station pops (first load): 0.8 against 0.5. */
const LABEL_LAG = 0.3;
/** Seconds into the first load when the numbers fade in: last. */
export const NUM_AT = 2.9;

/** The animation delay of a mark in the first load; none when there is no first load. */
function delay(at: number | undefined, lag = 0): { style?: CSSProperties } {
  return at === undefined ? {} : { style: { animationDelay: `${(at + lag).toFixed(2)}s` } };
}

/**
 * A number or line under a station. Keyed by its value: a changed value mounts again and fades in
 * once, so a number never counts or jitters. In the first load it fades in last, at NUM_AT.
 */
export function Num({ text, on }: { text: string; on?: boolean | undefined }) {
  return (
    <tspan key={text} className="num" {...(on ? { style: { animationDelay: `${NUM_AT}s` } } : {})}>
      {text}
    </tspan>
  );
}

/** A free chip (a rounded wash with an optional glyph): retry, hold, version, branch label. */
export function Chip({ x, y, t, icon }: ChipSpec) {
  const g = icon === undefined ? "repeat" : icon;
  const w = chipWidth(t, g);
  if (!g) {
    return (
      <g className="chip">
        <rect x={x - w / 2} y={y - 10.5} width={w} height={21} rx={10.5} />
        <text x={x} y={y + 4} textAnchor="middle">
          {t}
        </text>
      </g>
    );
  }
  return (
    <g className="chip">
      <rect x={x - w / 2} y={y - 10.5} width={w} height={21} rx={10.5} />
      <SvgGlyph name={g} x={x - w / 2 + 13} y={y} size={11} />
      <text x={x - w / 2 + 22} y={y + 4}>
        {t}
      </text>
    </g>
  );
}

/** The rule of a split or join: all, any or N of M, in small caps on an ink tag. */
export function RuleTag({ x, y, t }: { x: number; y: number; t: string }) {
  const w = ruleWidth(t);
  return (
    <g className="rule">
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={5} />
      <text x={x} y={y + 3.6} textAnchor="middle">
        {t.toUpperCase()}
      </text>
    </g>
  );
}

/** A part the body does not give ("?") is said in words for a screen reader. */
const said = (v: string, none: string): string => (v === "?" || v === "" ? none : v);

/** What the avatar holds: initials ("WJ" stays, "Ada North" becomes "AN"). The name stays in the label. */
const ownerMark = (owner: string) => (owner.includes(" ") ? initials(owner) : owner);

/** A person track's pill: the owner's initials and the promise ("WJ · 4h"). Amber when late. */
export function Pill({
  x,
  y,
  who,
  late,
  id,
  mark,
}: {
  x: number;
  y: number;
  who: string;
  late?: boolean | undefined;
  mark?: Mark | undefined;
  /** The track's id: the pill takes focus and clicks. */
  id?: string | undefined;
}) {
  const [o = "", tm = ""] = who.split(" · ");
  const w = pillWidth(who);
  return (
    <g
      className={cx("pill", late && "late")}
      {...(id
        ? {
            "data-tr": id,
            ...asButton(
              marked(
                `Person task, ${said(o, "no owner")}, ${said(tm, "no promise")}${late ? ", late" : ""}`,
                mark,
              ),
            ),
          }
        : {})}
    >
      <rect x={x - w / 2} y={y - 13} width={w} height={26} rx={13} />
      <circle className="av" cx={x - w / 2 + 13} cy={y} r={10} />
      <text className="avt" x={x - w / 2 + 13} y={y + 3.5} textAnchor="middle">
        {ownerMark(o)}
      </text>
      <text className="t" x={x - w / 2 + 28} y={y + 4.5}>
        {tm}
      </text>
    </g>
  );
}

/**
 * A person track's chip folded to a dot: the track has no room for the pill. It says how many
 * tasks fold into it, keeps the pill's name for a screen reader and takes the same focus and clicks.
 */
export function CountDot({
  x,
  y,
  n,
  who,
  late,
  id,
  mark,
}: {
  x: number;
  y: number;
  n: number;
  who: string;
  late?: boolean | undefined;
  mark?: Mark | undefined;
  id?: string | undefined;
}) {
  const [o = "", tm = ""] = who.split(" · ");
  return (
    <g
      className={cx("pill dot", late && "late")}
      {...(id
        ? {
            "data-tr": id,
            ...asButton(
              marked(
                `Person task, ${said(o, "no owner")}, ${said(tm, "no promise")}${late ? ", late" : ""}`,
                mark,
              ),
            ),
          }
        : {})}
    >
      <circle className="dt" cx={x} cy={y} r={DOT / 2} />
      <text className="t" x={x} y={y + 4.2} textAnchor="middle">
        {n}
      </text>
    </g>
  );
}

/** The label of a transfer: a pill in the target line's colour. */
export function XferLabel({
  m,
  lab,
  colour,
  l,
  on,
  id,
  mark,
}: {
  m: Point;
  lab: string;
  colour: string;
  l: string;
  on?: boolean | undefined;
  id?: string | undefined;
  mark?: Mark | undefined;
}) {
  const w = xferWidth(lab);
  return (
    <g
      className={cx("xp", on && "on")}
      data-l={l}
      {...(id ? { "data-tr": id, ...asButton(marked(`Transfer, ${lab}`, mark)) } : {})}
    >
      <rect
        x={m[0] - w / 2}
        y={m[1] - 10.5}
        width={w}
        height={21}
        rx={10.5}
        style={{ fill: colour }}
      />
      <text x={m[0]} y={m[1] + 4} textAnchor="middle">
        {lab}
      </text>
    </g>
  );
}

/** A station marker, with its chips and its name. */
export function Marker({
  s,
  click,
  selected,
  l,
  on,
  at,
}: {
  s: MarkStation;
  click?: boolean | undefined;
  selected?: boolean | undefined;
  /** The line it sits on (a station on a line lights with it). */
  l?: string | undefined;
  on?: boolean | undefined;
  /** First load: seconds until this station lands. */
  at?: number | undefined;
}) {
  const { x, t } = s;
  const { r, cy, top, h, w, rx, d } = markerBox(s);
  const diamond = t === "dec" || t === "race";
  // Logic marks: a diamond decides (hollow: a condition; filled: the first event wins); a bar
  // splits or joins lanes.
  const shape = (c: string) =>
    diamond ? (
      <path className={c} d={`M${x} ${cy - d}L${x + d} ${cy}L${x} ${cy + d}L${x - d} ${cy}Z`} />
    ) : (
      <rect className={c} x={x - w / 2} y={top} width={w} height={h} rx={Math.min(rx, w / 2)} />
    );
  const stacked = s.bundle || t === "link";
  const rep = s.rep;
  const plans = s.plans;
  const lab = labelOf(s);
  return (
    <>
      <g
        className={cx(
          `mk m-${t}`,
          s.bad && "bad",
          s.bundle && "bundle",
          selected && "sel",
          on && "on",
        )}
        {...(s.mark ? { "data-mark": s.mark } : {})}
        {...(l ? { "data-l": l } : {})}
        {...delay(at)}
        {...(click && s.id ? { "data-id": s.id, ...asButton(nameOf(s)) } : {})}
      >
        {stacked ? (
          <rect className="stk" x={x - w / 2 + 5} y={top - 5} width={w} height={h} rx={rx} />
        ) : null}
        {shape("ring")}
        {shape("b")}
        {t === "par" ? null : (
          <SvgGlyph name={STATION_GLYPH[t]} x={x} y={cy} size={GLYPH_SIZE[t] ?? 16} />
        )}
        {s.rule ? <RuleTag x={x} y={top - 14} t={s.rule} /> : null}
      </g>
      {rep ? (
        <Chip
          x={x}
          y={s.y + r + 17}
          t={rep}
          icon={s.repGlyph === undefined ? "repeat" : s.repGlyph}
        />
      ) : null}
      {plans ? <Chip x={x} y={s.y + r + 17 + (rep ? 26 : 0)} t={plans} icon="card" /> : null}
      {s.n ? (
        <>
          <text
            className="lab"
            x={lab.x}
            y={lab.y}
            textAnchor={lab.anchor}
            {...delay(at, LABEL_LAG)}
          >
            {s.n}
          </text>
          {s.s ? (
            <text
              className="sub"
              x={lab.x}
              y={lab.sub}
              textAnchor={lab.anchor}
              {...delay(at, LABEL_LAG)}
            >
              <Num text={s.s} on={at !== undefined} />
            </text>
          ) : null}
        </>
      ) : null}
      {s.mark ? <MarkTag mark={s.mark} l={l} x={lab.tag[0]} y={lab.tag[1]} /> : null}
    </>
  );
}

/** The attributes a folded mark carries: its id and the group it opens. */
const foldedAttrs = (c: { id: string; grp?: string | undefined }) =>
  c.grp ? { "data-id": c.id, "data-grp": c.grp } : {};

/** A run of stations folded into one capsule: first to last station, with the people inside now. */
export function Capsule({
  c,
  colours,
  selected,
  on,
}: {
  c: CapsuleStation;
  colours: Colours;
  selected?: boolean | undefined;
  on?: boolean | undefined;
}) {
  const [x0, x1] = c.cap;
  // A fold is a circle in the middle of its run, wide enough for its count.
  const h = 32;
  const w = Math.max(h, textWidth(String(c.now), 13, true) + 14);
  const m = (x0 + x1) / 2;
  const X = m - w / 2;
  // Its name sits on the side the layout chose: above by default.
  const nw = textWidth(c.n);
  const lab =
    c.p === "down"
      ? { x: m, y: c.y + h / 2 + 19, anchor: "middle" as const }
      : c.p === "right"
        ? { x: X + w + 10, y: c.y + 5, anchor: "start" as const }
        : c.p === "left"
          ? { x: X - 10, y: c.y + 5, anchor: "end" as const }
          : { x: m, y: c.y - h / 2 - 10, anchor: "middle" as const };
  return (
    <g
      className={cx("cap", c.late && "late", selected && "sel", on && "on")}
      data-l={c.l}
      data-g={c.id}
      {...(c.mark ? { "data-mark": c.mark } : {})}
      {...foldedAttrs(c)}
      {...asButton(marked(`${c.n}: ${c.now} people. Open`, c.mark))}
    >
      <rect
        className="cr"
        x={X - 4}
        y={c.y - h / 2 - 4}
        width={w + 8}
        height={h + 8}
        rx={h / 2 + 4}
      />
      <rect
        className="cb"
        x={X}
        y={c.y - h / 2}
        width={w}
        height={h}
        rx={h / 2}
        style={{ stroke: lineColour(colours, c.l) }}
      />
      <text className="cn" x={m} y={c.y + 4.5} textAnchor="middle">
        {c.now}
      </text>
      <text className="lab" x={lab.x} y={lab.y} textAnchor={lab.anchor}>
        {c.n}
      </text>
      {c.mark ? (
        <MarkTag
          mark={c.mark}
          x={
            lab.anchor === "end"
              ? lab.x - nw - 12
              : lab.x + (lab.anchor === "start" ? nw : nw / 2) + 12
          }
          y={lab.y - 4}
        />
      ) : null}
    </g>
  );
}

/** A loop folded: one ring in the line colour, with the repeat glyph. */
export function Ring({
  c,
  colours,
  selected,
  on,
}: {
  c: RingStation;
  colours: Colours;
  selected?: boolean | undefined;
  on?: boolean | undefined;
}) {
  const r = c.r ?? 26;
  return (
    <g
      className={cx("cap ring", selected && "sel", on && "on")}
      data-l={c.l}
      {...foldedAttrs(c)}
      {...asButton(`${c.n}. Open`)}
    >
      <circle className="cr" cx={c.x} cy={c.y} r={r + 5} />
      <circle
        className="cb"
        cx={c.x}
        cy={c.y}
        r={r}
        style={{ stroke: lineColour(colours, c.l), strokeWidth: 7 }}
      />
      <SvgGlyph name="repeat" x={c.x} y={c.y} size={20} />
      <text className="lab" x={c.x} y={c.y - r - 26} textAnchor="middle">
        {c.n}
      </text>
      <text className="sub" x={c.x} y={c.y - r - 11} textAnchor="middle">
        {c.s ?? ""}
      </text>
    </g>
  );
}

/** A whole offer folded: one badge with its name, price and clients. */
export function Badge({
  c,
  colours,
  selected,
  on,
}: {
  c: BadgeStation;
  colours: Colours;
  selected?: boolean | undefined;
  on?: boolean | undefined;
}) {
  const w = c.w ?? 280;
  const h = 56;
  const X = c.x - w / 2;
  const Y = c.y - h / 2;
  const colour = lineColour(colours, c.l);
  return (
    <g
      className={cx("cap bdg", selected && "sel", on && "on")}
      data-l={c.l}
      {...foldedAttrs(c)}
      {...asButton(`${c.n}. Open`)}
    >
      <rect className="cr" x={X - 5} y={Y - 5} width={w + 10} height={h + 10} rx={17} />
      <rect
        className="cb"
        x={X}
        y={Y}
        width={w}
        height={h}
        rx={12}
        style={{ stroke: colour, strokeWidth: 4 }}
      />
      <rect x={X + 12} y={Y + 12} width={32} height={32} rx={8} style={{ fill: colour }} />
      <g className="bi">
        <SvgGlyph name={c.glyph ?? "repeat"} x={X + 28} y={c.y} size={17} />
      </g>
      <text className="bn" x={X + 56} y={c.y - 3}>
        {c.n}
      </text>
      <text className="bs" x={X + 56} y={c.y + 15}>
        {c.s}
      </text>
    </g>
  );
}

/** The leaf rect of the design language: small radius top left and bottom right, large on the others. */
export function Leaf({
  x,
  y,
  w,
  h,
  a,
  b,
  className,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
  b: number;
  className?: string;
}) {
  return <path className={className} d={leafPath(x, y, w, h, a, b)} />;
}

/**
 * A group opened by hand keeps a faint outline round its stations on the track. Same height as the
 * capsule, so it never reaches the next row's labels.
 */
export function OpenedOutline({ o, colours }: { o: OpenedSpec; colours: Colours }) {
  const [x0, x1] = o.cap;
  const h = 30;
  return (
    <rect
      className="opn"
      x={x0 - 16}
      y={o.y - h / 2}
      width={x1 - x0 + 32}
      height={h}
      rx={h / 2}
      style={{ stroke: lineColour(colours, o.l) }}
    />
  );
}

/** The fold tab of a group opened by hand: above the group, at its right end, as in the artifact. */
export function OpenedTab({ o }: { o: OpenedSpec }) {
  const w = tabWidth(o.t);
  // Right end on the outline's right end; never past the map's left edge.
  const x = Math.max(o.cap[1] + 16 - w / 2, w / 2 + 8);
  const y = (o.top ?? o.y - 40) - TAB_ROOM / 2 - 2;
  return <FoldTab x={x} y={y} t={o.t} grp={o.grp} />;
}

const tabWidth = (t: string) => t.length * 6.9 + 46;

/** A fold tab on an open group: click it to fold the group back. */
export function FoldTab({ x, y, t, grp }: FoldSpec): ReactNode {
  const w = tabWidth(t);
  return (
    <g className="fold" data-fold={grp} {...asButton(`Fold ${t}`)}>
      <Leaf x={x - w / 2} y={y - 15} w={w} h={30} a={4} b={14} className="lf" />
      <SvgGlyph name="shrink" x={x - w / 2 + 18} y={y} size={15} />
      <text x={x - w / 2 + 32} y={y + 4.5}>
        {t}
      </text>
    </g>
  );
}
