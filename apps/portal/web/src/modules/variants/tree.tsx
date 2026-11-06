/**
 * A subject's generation tree: rows by batch, a snapshot per sample sized by his call, the
 * strongest line in the middle. Point for a card, select to light a path; arrows walk it.
 * Port of the approved preview (artifact A5xNkRRGMoMZuH8s7mvfRL, pass 5).
 */
import { Button, Seg, Tag } from "@wren/ui";
import { type KeyboardEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { href, navigate } from "../../route.js";
import { handToChat, usePageContext } from "../agent/drive.js";
import {
  type Call,
  G,
  isGood,
  strong,
  TH,
  type TNode,
  type Tree,
  type TreeBatch,
  type TreeGuide,
  treeOf,
  VERD,
} from "./tree-model.js";
import "./tree.css";

const LEGEND: readonly Call[] = ["amazing", "good", "bad", "grew", "unmarked", "open"];
const TONE = { amazing: "accent", good: "green", bad: "bad", open: "warn" } as const;
const tone = (v: Call) => (v in TONE ? TONE[v as keyof typeof TONE] : "neutral");
const f1 = (n: number) => Number(n.toFixed(1));
/** a curve one row down, then straight */
const drop = (x1: number, y1: number, x2: number, y2: number, g: number) =>
  y2 - y1 <= g + 1
    ? `M${f1(x1)} ${f1(y1)}C${f1(x1)} ${f1(y1 + (y2 - y1) * 0.55)} ${f1(x2)} ${f1(y1 + (y2 - y1) * 0.45)} ${f1(x2)} ${f1(y2)}`
    : `M${f1(x1)} ${f1(y1)}C${f1(x1)} ${f1(y1 + g * 0.55)} ${f1(x2)} ${f1(y1 + g * 0.45)} ${f1(x2)} ${f1(y1 + g)}V${f1(y2)}`;
const HH = (v: Call | "root") => (v === "root" ? 6 : TH[v][1] / 2);
const HW = (v: Call) => TH[v][0] / 2;
function wrap(name: string, max: number) {
  if (name.length <= max) return [name];
  const w = name.split(" ");
  let a = w[0] ?? "";
  let i = 1;
  while (i < w.length - 1 && `${a} ${w[i]}`.length <= max) a += ` ${w[i++]}`;
  return i < w.length ? [a, w.slice(i).join(" ")] : [a];
}

const Lock = () => (
  <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
    <path
      d="M3 5.5V3.75a2.5 2.5 0 0 1 5 0V5.5"
      fill="none"
      stroke="var(--ui-accent)"
      strokeWidth="1.5"
    />
    <rect x=".75" y="5.25" width="9.5" height="6" rx="1.75" fill="var(--ui-accent)" />
  </svg>
);
const PIN = "M4 1h4l-.6 3.4L9.5 6.5v1h-3V11l-.5.6-.5-.6V7.5h-3v-1l2.1-2.1z";
const Pin = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    <path d={PIN} fill="currentColor" />
  </svg>
);

export interface TreeProps {
  subject: { slug: string; name: string; kind: string; brief: string | null };
  batches: readonly TreeBatch[];
  guides: readonly TreeGuide[];
}

export function SubjectTree({ subject, batches, guides }: TreeProps) {
  const t = useMemo(() => treeOf(batches, guides), [batches, guides]);
  const [sel, setSel] = useState<number | null>(t.first);
  const [focus, setFocus] = useState<number | null>(t.first);
  const [mode, setMode] = useState<"all" | "line">("all");
  const [tip, setTip] = useState<number | null>(null);
  // the card sits outside the scroll box (no clip); place it by the box's scroll
  const [view, setView] = useState<{ left: number; width: number }>({ left: 0, width: G.W });
  const [kept, setKept] = useState<Record<number, boolean>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<number, SVGGElement>());
  const uid = useId().replace(/:/g, "");
  const isKept = (s: TNode) => kept[s.id] ?? s.kept;
  const s = sel != null ? (t.byId.get(sel) ?? null) : null;
  const round = s ? t.rounds[s.r - 1] : undefined;
  usePageContext(
    `in view: ${subject.slug} generation tree${s ? `, ${s.name} selected (sample ${s.id}, batch ${round?.id})` : ""}`,
  );
  // open on the selected sample, centred in the scroll box
  useLayoutEffect(() => {
    const el = scroll.current;
    const at = t.first != null ? t.byId.get(t.first) : null;
    if (!el || !at) return;
    const rw = G.AX - 12;
    el.scrollLeft = t.pos(at).x - rw - (el.clientWidth - rw) / 2;
  }, [t]);
  const marked = t.S.filter((x) => x.v === "amazing" || x.v === "good" || x.v === "bad");
  const locked = guides.filter((g) => g.state === "locked").length;
  const select = (id: number) => {
    setSel(id);
    setFocus(id);
  };
  const keys = (ev: KeyboardEvent, n: TNode) => {
    const row = t.S.filter((x) => x.r === n.r).sort((a, b) => t.pos(a).x - t.pos(b).x);
    const i = row.indexOf(n);
    let to: TNode | undefined;
    if (ev.key === "ArrowLeft") to = row[i - 1];
    else if (ev.key === "ArrowRight") to = row[i + 1];
    else if (ev.key === "ArrowUp") to = n.p[0] != null ? t.byId.get(n.p[0]) : undefined;
    else if (ev.key === "ArrowDown") to = t.tkids(n.id).sort((a, b) => t.pos(a).x - t.pos(b).x)[0];
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select(n.id);
      return;
    } else return;
    ev.preventDefault();
    if (!to) return;
    setFocus(to.id);
    nodes.current.get(to.id)?.focus();
  };
  const keep = (n: TNode) => {
    const on = !isKept(n);
    setKept((k) => ({ ...k, [n.id]: on }));
    void call("variants/keep", { sample: n.id, on }).catch(() =>
      setKept((k) => ({ ...k, [n.id]: !on })),
    );
  };
  return (
    <div className="vt">
      <div className="vt-sum">
        <span className="vt-fact">
          <b>{t.rounds.length}</b> batches
        </span>
        <span className="vt-fact">
          <b>{t.S.length}</b> samples
        </span>
        <span className="vt-fact">
          <b>{marked.filter(isGood).length}</b> good or better of {marked.length} marked
        </span>
        <span className="vt-fact">
          <b>{locked}</b> guides locked
        </span>
        <Seg
          dense
          label="Show"
          items={[
            { value: "all", label: "All samples" },
            { value: "line", label: "Good line" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="vt-stage">
        <div className="vt-scroll" ref={scroll}>
          <div className="vt-in">
            <Rail t={t} />
            <TreeSvg
              t={t}
              uid={uid}
              sel={sel}
              focus={focus}
              mode={mode}
              name={subject.name}
              isKept={isKept}
              nodes={nodes.current}
              onSelect={select}
              onKey={keys}
              onTip={(id) => {
                const el = scroll.current;
                setTip(id);
                if (id != null && el) setView({ left: el.scrollLeft, width: el.clientWidth });
              }}
            />
          </div>
        </div>
        <Tip t={t} id={tip} isKept={isKept} view={view} />
      </div>
      <div className="vt-legend">
        {LEGEND.filter((c) => t.S.some((x) => x.v === c)).map((c) => (
          <span key={c}>
            <i className={`vt-dot ${c}`} />
            {c === "grew" ? "No call, a batch grew from it" : VERD[c]}
          </span>
        ))}
        {t.S.some(isKept) && (
          <span>
            <Pin />
            Kept
          </span>
        )}
        <span>
          <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
            <path d="M1 3H25" stroke="var(--ui-ink-2)" strokeWidth="1.25" strokeLinecap="round" />
            <path d="M1 9H25" stroke="var(--ui-ink-2)" strokeWidth="4" strokeLinecap="round" />
          </svg>
          Thicker: more good samples came from it
        </span>
      </div>
      <p className="vt-cap">
        Read down from the brief. A branch that stops had no good sample. A faint snapshot with no
        line is a seed that went nowhere. Point at one for its card. Select one to light its path.
        Keys: arrows walk the tree, Enter selects.
      </p>
      {s && round && (
        <div className="vt-detail">
          <div className="vt-dl">
            <SampleDetail
              t={t}
              s={s}
              round={round}
              kept={isKept(s)}
              onGo={select}
              onKeep={() => keep(s)}
              subject={subject.slug}
            />
          </div>
          <div className="vt-dl">
            <BatchDetail t={t} n={s.r} />
          </div>
        </div>
      )}
    </div>
  );
}

function Rail({ t }: { t: Tree }) {
  const RW = G.AX - 12;
  return (
    <svg
      className="vt-rail"
      aria-hidden="true"
      viewBox={`0 0 ${RW} ${t.height}`}
      preserveAspectRatio="xMinYMin slice"
      width={RW}
      height={t.height}
    >
      {t.rounds.map((B) => {
        const y = G.TOP + B.n * G.GEN;
        const row = t.S.filter((s) => s.r === B.n);
        return (
          <g key={B.id}>
            <text className="vt-gt" x="0" y={y - 12}>
              Batch {B.n}
              <tspan className="vt-gd" dx="6">
                {B.when}
              </tspan>
            </text>
            {row.slice(0, 11).map((s, i) => {
              const x = i * 13;
              const yy = y - 2;
              if (s.v === "amazing" || s.v === "good")
                return (
                  <rect
                    key={s.id}
                    x={x}
                    y={yy}
                    width="10"
                    height="10"
                    rx="2.5"
                    fill={s.v === "amazing" ? "var(--ui-accent)" : "var(--ui-good)"}
                  />
                );
              return (
                <rect
                  key={s.id}
                  x={x + 0.5}
                  y={yy + 0.5}
                  width="9"
                  height="9"
                  rx="2.25"
                  fill="var(--ui-paper)"
                  stroke={
                    s.v === "bad"
                      ? "var(--ui-bad)"
                      : s.v === "grew"
                        ? "var(--ui-ink-2)"
                        : "var(--ui-ink-3)"
                  }
                  strokeWidth={s.v === "grew" ? 1.25 : 1}
                  strokeDasharray={s.v === "open" ? "2 2" : undefined}
                />
              );
            })}
            <text className={`vt-gc${B.open ? " w" : ""}`} x="0" y={y + 24}>
              {B.call}
            </text>
            {B.locks.length > 0 && (
              <g transform={`translate(0 ${y + 33})`}>
                <Lock />
                <text className="vt-gl" x="15" y="10">
                  {B.locks.length} guide{B.locks.length > 1 ? "s" : ""} locked
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TreeSvg({
  t,
  uid,
  sel,
  focus,
  mode,
  name,
  isKept,
  nodes,
  onSelect,
  onKey,
  onTip,
}: {
  t: Tree;
  uid: string;
  sel: number | null;
  focus: number | null;
  mode: "all" | "line";
  name: string;
  isKept: (s: TNode) => boolean;
  nodes: Map<number, SVGGElement>;
  onSelect: (id: number) => void;
  onKey: (ev: KeyboardEvent, s: TNode) => void;
  onTip: (id: number | null) => void;
}) {
  const hot = mode === "line" ? t.goodLine() : sel != null ? t.line(sel) : new Set<number>();
  const path = new Set(sel != null ? t.pathUp(sel).map((x) => x.id) : []);
  const W = G.W;
  const openRow = t.rounds.find((r) => r.open);
  const edge = (p: TNode | null, c: TNode, cross: boolean) => {
    const live = t.strongUnder(c.id);
    const on = hot.has(c.id) && (p == null || hot.has(p.id));
    const a = t.pos(p);
    const b = t.pos(c);
    const ra = HH(p ? p.v : "root") + 3;
    const rb = HH(c.v) + 4;
    return (
      <path
        key={`${p?.id ?? 0}-${c.id}`}
        className={`vt-e${cross ? " x" : ""}${live ? " live" : ""}${on ? " on" : ""}`}
        strokeWidth={cross ? 1.5 : live ? 1.5 + 0.75 * Math.min(live, 4) : 1}
        d={drop(a.x, a.y + ra, b.x, b.y - rb, G.GEN - ra - rb)}
      />
    );
  };
  const root = t.pos(null);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an svg tree of focusable nodes; no fieldset fits
    <svg
      role="group"
      aria-label={`Generation tree of ${name}`}
      viewBox={`0 0 ${W} ${t.height}`}
      width={W}
      height={t.height}
    >
      {openRow && (
        <rect
          className="vt-band"
          x={G.AX - 14}
          y={G.TOP + openRow.n * G.GEN - 30}
          width={W - G.AX + 14}
          height="60"
          rx="10"
        />
      )}
      {t.rounds.map((B) => (
        <path key={B.id} className="vt-guide" d={`M${G.AX - 8} ${G.TOP + B.n * G.GEN}H${W}`} />
      ))}
      {t.S.flatMap((c) => {
        if (c.v === "open") return [];
        const pid = c.p[0];
        const p = pid != null ? (t.byId.get(pid) ?? null) : null;
        return [
          ...(t.loose(c) ? [] : [edge(p, c, false)]),
          ...c.p.slice(1).map((id) => edge(t.byId.get(id) ?? null, c, true)),
        ];
      })}
      {mode === "all" &&
        t.S.flatMap((c) => {
          // what changed, on the selected path only
          if (c.v === "open" || !path.has(c.id)) return [];
          const pid = c.p[0];
          const pn = pid != null ? (t.byId.get(pid) ?? null) : null;
          const label = pn ? c.delta : "new seed";
          if (!label) return [];
          const a = t.pos(pn);
          const b = t.pos(c);
          const right = b.x >= a.x;
          return [
            <text
              key={`el${c.id}`}
              className="vt-el vt-halo"
              x={f1(b.x - (b.x - a.x) * 0.3 + (right ? 9 : -9))}
              y={f1(b.y - G.GEN * 0.42)}
              textAnchor={right ? "start" : "end"}
            >
              {label}
            </text>,
          ];
        })}
      <g transform={`translate(${f1(root.x)} ${f1(root.y)})`}>
        <circle r="6" fill="var(--ui-ink)" />
        <text className="vt-gt vt-halo" x="12" y="4">
          Brief
        </text>
      </g>
      {t.S.map((s) => {
        const p = t.pos(s);
        const isSel = s.id === sel;
        const dim = mode === "line" && !hot.has(s.id);
        const what =
          s.v === "open"
            ? `${s.name}, batch ${s.r}, to mark`
            : `${s.name}, batch ${s.r}, ${VERD[s.v]}`;
        const named = s.v !== "open" && (strong(s) || isSel || (mode === "all" && path.has(s.id)));
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG node; <button> cannot live in SVG.
          <g
            key={s.id}
            ref={(el) => {
              if (el) nodes.set(s.id, el);
              else nodes.delete(s.id);
            }}
            className={`vt-n${dim ? " dim" : ""}`}
            tabIndex={s.id === focus ? 0 : -1}
            role="button"
            aria-pressed={isSel}
            aria-label={what}
            transform={`translate(${f1(p.x)} ${f1(p.y)})`}
            onClick={() => onSelect(s.id)}
            onKeyDown={(ev) => onKey(ev, s)}
            onPointerEnter={() => onTip(s.id)}
            onPointerLeave={() => onTip(null)}
            onFocus={() => onTip(s.id)}
            onBlur={() => onTip(null)}
          >
            <rect
              className="vt-hit"
              x={-Math.max(HW(s.v) + 6, 22)}
              y={-Math.max(HH(s.v) + 6, 22)}
              width={Math.max(2 * HW(s.v) + 12, 44)}
              height={Math.max(2 * HH(s.v) + 12, 44)}
              rx="10"
            />
            <Thumb s={s} sel={isSel} clip={`${uid}c${s.id}`} />
            {isKept(s) && (
              <g
                transform={`translate(${f1(-HW(s.v) - 3)} ${f1(-HH(s.v) - 15)})`}
                color="var(--ui-accent)"
              >
                <path d={PIN} fill="currentColor" transform="scale(0.917)" />
              </g>
            )}
            {named && <Name t={t} s={s} sel={isSel} />}
          </g>
        );
      })}
    </svg>
  );
}

const STROKE: Record<Exclude<Call, "open">, readonly [string, number]> = {
  amazing: ["var(--ui-accent)", 1.5],
  good: ["var(--ui-good)", 1.25],
  bad: ["var(--ui-bad)", 1],
  grew: ["var(--ui-ink-2)", 1.25],
  unmarked: ["var(--ui-ink-3)", 1],
};

/** the node: a snapshot; its size, border and badge say the call */
function Thumb({ s, sel, clip }: { s: TNode; sel: boolean; clip: string }) {
  const [w, h] = TH[s.v];
  const x = -w / 2;
  const y = -h / 2;
  const ring = sel ? (
    <rect
      x={x - 5}
      y={y - 5}
      width={w + 10}
      height={h + 10}
      rx="10"
      fill="none"
      stroke="var(--ui-accent)"
      strokeWidth="1.5"
    />
  ) : s.v === "amazing" ? (
    <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx="9" fill="var(--vt-tint)" />
  ) : null;
  if (s.v === "open")
    return (
      <>
        {ring}
        <g className="vt-th">
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx="6"
            fill="var(--ui-paper)"
            stroke="var(--ui-ink-3)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text className="vt-lt" textAnchor="middle" y="3.5">
            {s.letter}
          </text>
        </g>
      </>
    );
  const [stroke, sw] = STROKE[s.v];
  const bx = w / 2 - 1;
  const by = -h / 2 + 1;
  return (
    <>
      {ring}
      <g className={`vt-th${s.v === "bad" ? " faint" : ""}`}>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} rx="6" />
        </clipPath>
        <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--ui-fill)" />
        {s.poster ? (
          <image
            href={s.poster}
            x={x}
            y={y}
            width={w}
            height={h}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
          />
        ) : (
          <text className="vt-lt" textAnchor="middle" y="3.5">
            Aa
          </text>
        )}
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="6"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        {s.v === "amazing" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="6.5" fill="var(--ui-accent)" stroke="var(--ui-paper)" strokeWidth="1.25" />
            <path
              d="M0-4.2l1.2 2.6 2.8.3-2.1 1.9.6 2.8L0 2-2.5 3.4l.6-2.8-2.1-1.9 2.8-.3z"
              fill="var(--ui-on-accent)"
            />
          </g>
        )}
        {s.v === "good" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="6" fill="var(--ui-good)" stroke="var(--ui-paper)" strokeWidth="1.25" />
            <path
              d="M-2.6 0-.8 1.9 2.8-1.9"
              fill="none"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
        {s.v === "bad" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="5" fill="var(--ui-paper)" stroke="var(--ui-bad)" strokeWidth="1" />
            <path
              d="M-1.6-1.6 1.6 1.6M1.6-1.6-1.6 1.6"
              stroke="var(--ui-bad)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </g>
        )}
      </g>
    </>
  );
}

/** strong samples and the selected one carry a name: right of a parent, under a leaf */
function Name({ t, s, sel }: { t: Tree; s: TNode; sel: boolean }) {
  const pad = sel ? 5 : s.v === "amazing" ? 4 : 0;
  const cls = `vt-nl vt-halo${strong(s) ? " k" : ""}`;
  const ls = wrap(s.name, 11);
  if (t.tkids(s.id).length) {
    const x = HW(s.v) + pad + 6;
    return (
      <text className={cls} y={ls.length > 1 ? -2.5 : 4}>
        {ls.map((l, i) => (
          <tspan key={l} x={x} dy={i ? 13 : 0}>
            {l}
          </tspan>
        ))}
      </text>
    );
  }
  return (
    <text className={cls} textAnchor="middle" y={HH(s.v) + pad + 14}>
      {ls.map((l, i) => (
        <tspan key={l} x="0" dy={i ? 13 : 0}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function Poster({ s }: { s: TNode }) {
  if (s.v === "open") return <div className="vt-poster blind">{s.letter}</div>;
  if (s.poster)
    return (
      <div className="vt-poster">
        <img src={s.poster} alt={`Snapshot of ${s.name}`} loading="lazy" />
      </div>
    );
  return <div className="vt-poster words">{s.body ?? s.change ?? s.name}</div>;
}

const fromOf = (t: Tree, s: TNode) =>
  s.p.length
    ? s.p.map((i) => t.byId.get(i)?.name ?? `sample ${i}`).join(" × ")
    : s.r === 1
      ? "the brief"
      : "a new seed";

function Tip({
  t,
  id,
  isKept,
  view,
}: {
  t: Tree;
  id: number | null;
  isKept: (s: TNode) => boolean;
  view: { left: number; width: number };
}) {
  const last = useRef<number | null>(null);
  if (id != null) last.current = id;
  const s = last.current != null ? t.byId.get(last.current) : undefined;
  if (!s) return <div className="vt-tip" aria-hidden="true" />;
  const p = t.pos(s);
  const r = HH(s.v) + 8;
  const below = p.y <= t.height * 0.55;
  const ch = t.kids(s.id).length;
  const gu = t.strongUnder(s.id) - (strong(s) ? 1 : 0);
  const chips = (
    <div className="vt-row">
      <Tag tone={tone(s.v)}>{VERD[s.v]}</Tag>
      <Tag>Batch {s.r}</Tag>
      {isKept(s) && (
        <Tag tone="accent">
          <Pin />
          Kept
        </Tag>
      )}
    </div>
  );
  return (
    <div
      className={`vt-tip${id != null ? " on" : ""}`}
      aria-hidden="true"
      style={{
        left: Math.max(0, Math.min(view.width - 300, p.x - view.left - 150)),
        ...(below ? { top: p.y + r + 8 } : { bottom: t.height - (p.y - r - 8) }),
      }}
    >
      <Poster s={s} />
      <div className="tx">
        <b>{s.name}</b>
        {chips}
        {s.v === "open" ? (
          <div className="d">Blind. Its idea and parents show after you hand batch {s.r} back.</div>
        ) : (
          <>
            {s.change && <div className="d">{s.change}</div>}
            {s.notes.map((n) => (
              <div key={n} className="d q">
                “{n}”
              </div>
            ))}
            <div className="m">
              From {fromOf(t, s)} ·{" "}
              {ch
                ? `led to ${ch} sample${ch > 1 ? "s" : ""}${gu ? `, ${gu} on the line` : ""}`
                : "nothing came from it yet"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LinkTo({ s, onGo }: { s: TNode; onGo: (id: number) => void }) {
  return (
    <button type="button" className="vt-link" onClick={() => onGo(s.id)}>
      <i className={`vt-dot ${s.v}`} />
      {s.name}
    </button>
  );
}

function SampleDetail({
  t,
  s,
  round,
  kept,
  onGo,
  onKeep,
  subject,
}: {
  t: Tree;
  s: TNode;
  round: Tree["rounds"][number];
  kept: boolean;
  onGo: (id: number) => void;
  onKeep: () => void;
  subject: string;
}) {
  if (s.v === "open")
    return (
      <>
        <Poster s={s} />
        <div className="vt-row">
          <h3>{s.name}</h3>
          <Tag>Batch {s.r}</Tag>
          <Tag tone="warn">To mark</Tag>
        </div>
        <div>
          <div className="vt-k">What it is</div>
          <div className="vt-v q">
            Blind until you hand the batch back. Its idea and parents show then.
          </div>
        </div>
        <div className="vt-row">
          <Button
            tone="primary"
            onClick={() => navigate(href("/variants/batches", { batch: round.id }))}
          >
            Mark batch {s.r}
          </Button>
        </div>
      </>
    );
  const pu = t.pathUp(s.id);
  const ch = t.kids(s.id);
  return (
    <>
      <Poster s={s} />
      <div className="vt-row">
        <h3>{s.name}</h3>
        <Tag>Batch {s.r}</Tag>
        <Tag tone={tone(s.v)}>{VERD[s.v]}</Tag>
        {kept && (
          <Tag tone="accent">
            <Pin />
            Kept
          </Tag>
        )}
      </div>
      <div>
        <div className="vt-k">Path</div>
        <div className="vt-path">
          <span>Brief</span>
          {pu.map((x) => (
            <span key={x.id} className="contents">
              <span className="sep">›</span>
              {x.id === s.id ? (
                <span className="here">{x.name}</span>
              ) : (
                <button type="button" className="vt-plain" onClick={() => onGo(x.id)}>
                  {x.name}
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {s.change && (
        <div>
          <div className="vt-k">What it tested</div>
          <div className="vt-v">{s.change}</div>
        </div>
      )}
      {s.notes.length > 0 && (
        <div>
          <div className="vt-k">Your note on it</div>
          {s.notes.map((n) => (
            <div key={n} className="vt-v q">
              {n}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="vt-k">Came from</div>
        <div className="vt-row">
          {s.p.length ? (
            s.p.flatMap((id) => {
              const x = t.byId.get(id);
              return x ? [<LinkTo key={id} s={x} onGo={onGo} />] : [];
            })
          ) : (
            <span className="vt-v q">{s.r === 1 ? "Seed from the brief" : "New seed"}</span>
          )}
        </div>
      </div>
      <div>
        <div className="vt-k">Led to</div>
        <div className="vt-row">
          {ch.length ? (
            ch.map((x) => <LinkTo key={x.id} s={x} onGo={onGo} />)
          ) : (
            <span className="vt-v q">Nothing yet</span>
          )}
        </div>
      </div>
      <div className="vt-row">
        <Button icon="pin" onClick={onKeep} aria-pressed={kept}>
          {kept ? "Kept" : "Keep"}
        </Button>
        <Button
          onClick={() =>
            handToChat(
              "vireo",
              `Branch from ${s.name} (sample ${s.id}, ${subject})\nMake the next batch with sample ${s.id} as the parent.`,
            )
          }
        >
          Branch from this
        </Button>
        {s.media && (
          <a className="vt-link" href={s.media} target="_blank" rel="noreferrer">
            Open sample ↗
          </a>
        )}
      </div>
    </>
  );
}

function BatchDetail({ t, n }: { t: Tree; n: number }) {
  const B = t.rounds[n - 1];
  if (!B) return null;
  const strip = (
    <div className="vt-strip" aria-hidden="true">
      {t.S.filter((s) => s.r === n).map((s) => (
        <i key={s.id} className={s.v} />
      ))}
    </div>
  );
  if (B.open)
    return (
      <>
        <div className="vt-row">
          <h3>Batch {B.n}</h3>
          <Tag tone="warn">To mark</Tag>
          <span className="vt-hint">{B.when}</span>
        </div>
        {strip}
        <div>
          <div className="vt-k">State</div>
          <div className="vt-v q">{B.call}. Each waits for your call.</div>
        </div>
      </>
    );
  return (
    <>
      <div className="vt-row">
        <h3>Batch {B.n}</h3>
        <span className="vt-hint">{B.when}</span>
      </div>
      <div className="vt-row">
        {strip}
        <span className="vt-v q text-[13px]">{B.call}</span>
      </div>
      {B.note && (
        <div>
          <div className="vt-k">Your note on the batch</div>
          <div className="vt-v q">{B.note}</div>
        </div>
      )}
      {B.took && (
        <div>
          <div className="vt-k">What Vireo took from it</div>
          <div className="vt-v q">{B.took}</div>
        </div>
      )}
      {B.locks.length > 0 && (
        <div>
          <div className="vt-k">Guides locked after it</div>
          <ul className="vt-locks">
            {B.locks.map((g) => (
              <li key={g}>
                <Lock />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
