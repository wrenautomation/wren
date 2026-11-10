/**
 * The tree stage's parts that sit outside the drawing: the batch rail, the hover card and the
 * open card.
 */
import { Button, Icon, Tag } from "@wren/ui";
import { type CSSProperties, type ReactNode, type Ref, useRef } from "react";
import { href } from "../../route.js";
import { fromOf, Lock, Pin, Poster, tone } from "./tree-detail.js";
import { type Call, G, strong, TH, type TNode, type Tree, VERD } from "./tree-model.js";

export const f1 = (n: number) => Number(n.toFixed(1));
export const HH = (v: Call | "root") => (v === "root" ? 6 : TH[v][1] / 2);
/** the open card's width in the world */
export const CARD_W = 380;

export interface View {
  x: number;
  y: number;
  k: number;
  w: number;
  h: number;
}

/** A sample opened in place: beside its card in the world, or a sheet at the stage's foot. */
export function OpenCard({
  at,
  maxHeight,
  ref,
  onClose,
  children,
}: {
  at?: { left: number; top: number } | undefined;
  maxHeight?: number | undefined;
  ref: Ref<HTMLDivElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={ref}
      className={`vt-open vt-dl${at ? "" : " sheet"}`}
      style={at ? { left: f1(at.left), top: f1(at.top), width: CARD_W, maxHeight } : undefined}
      aria-label="Open sample"
    >
      <Button className="vt-x" size="dense" tone="quiet" aria-label="Close" onClick={onClose}>
        <Icon name="close" className="size-3.5" />
      </Button>
      {children}
    </section>
  );
}

export function Rail({ t, slug }: { t: Tree; slug: string }) {
  const RW = G.AX - 12;
  return (
    <div className="vt-rail" style={{ "--rw": `${RW}px` } as CSSProperties}>
      {/* the batch name opens the batch */}
      {t.rounds.map((B) => (
        <a
          key={B.id}
          className="vt-ga"
          href={href("/variants/batches", { b: `${slug}:${B.num}` })}
          style={{ top: t.rowY(B.n) - 26 }}
        >
          Batch {B.num}
          <span>{B.when}</span>
        </a>
      ))}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${RW} ${t.height}`}
        preserveAspectRatio="xMinYMin slice"
        width={RW}
        height={t.height}
      >
        {t.rounds.map((B) => {
          const y = t.rowY(B.n);
          const row = t.S.filter((s) => s.r === B.n);
          return (
            <g key={B.id}>
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
    </div>
  );
}

export function Tip({
  t,
  id,
  isKept,
  view,
}: {
  t: Tree;
  id: number | null;
  isKept: (s: TNode) => boolean;
  view: View;
}) {
  const last = useRef<number | null>(null);
  if (id != null) last.current = id;
  const s = last.current != null ? t.byId.get(last.current) : undefined;
  if (!s) return <div className="vt-tip" aria-hidden="true" />;
  const p = t.pos(s);
  // the sample on screen, by the camera at hover time
  const x = view.x + p.x * view.k;
  const y = view.y + p.y * view.k;
  const r = (HH(s.v) + 8) * view.k;
  const below = y <= view.h * 0.55;
  const ch = t.kids(s.id).length;
  const gu = t.strongUnder(s.id) - (strong(s) ? 1 : 0);
  const chips = (
    <div className="vt-row">
      <Tag tone={tone(s.v)}>{VERD[s.v]}</Tag>
      <Tag>Batch {t.rounds[s.r - 1]?.num ?? s.r}</Tag>
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
        left: Math.max(8, Math.min(view.w - 308, x - 150)),
        ...(below ? { top: y + r + 8 } : { bottom: view.h - (y - r - 8) }),
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
