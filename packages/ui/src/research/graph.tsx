/**
 * A run's graph (round 4 mock): one ink, one accent. A circle is one source, larger with more
 * findings kept; its dark centre is what a claim uses. A line joins a claim to a source that backs
 * it. The names are the rows beside it: the page and the chat cards draw the same parts. Draft.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../format.js";
import { HUB_R, layRun } from "./layout.js";
import { count, type Pick, type ResearchRun } from "./model.js";

/** A source's mark in a row: the graph's circle at one size. */
export function SourceMark({
  kept,
  used,
  lit,
}: {
  kept: number;
  used: number;
  lit?: boolean | undefined;
}) {
  const ink = lit ? "var(--ui-active)" : "var(--ui-ink)";
  return (
    <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true" className="flex-none">
      {kept ? (
        <>
          <circle r="9.5" fill={ink} fillOpacity={0.12} />
          {used ? <circle r={Math.max(2.5, 9.5 * Math.sqrt(used / kept))} fill={ink} /> : null}
        </>
      ) : (
        <circle r="5" fill="none" stroke="var(--ui-ink-3)" strokeDasharray="2.5 2.5" />
      )}
    </svg>
  );
}

export interface ResearchGraphProps {
  run: ResearchRun;
  /** The claim or source in hand: its path shows in the accent, the rest dims. */
  lit?: Pick | null | undefined;
  onPoint?: ((pick: Pick | null) => void) | undefined;
  onPick?: ((pick: Pick) => void) | undefined;
  className?: string | undefined;
}

export function ResearchGraph({ run, lit = null, onPoint, onPick, className }: ResearchGraphProps) {
  const room = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = room.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const lay = useMemo(() => (width ? layRun(run, width) : null), [run, width]);
  const claimsOf = useMemo(() => {
    const m = new Map<string, readonly number[]>();
    for (const i of lay?.islands ?? []) for (const d of i.discs) m.set(d.id, d.claims);
    return m;
  }, [lay]);
  const discOn = (id: string, claims: readonly number[]) =>
    !lit ? null : "claim" in lit ? claims.includes(lit.claim) : lit.source === id;
  const hubOn = (n: number) =>
    !lit ? null : "claim" in lit ? lit.claim === n : !!claimsOf.get(lit.source)?.includes(n);
  const edgeOn = (claim: number, source: string) =>
    !lit ? null : "claim" in lit ? lit.claim === claim : lit.source === source;
  const tone = (on: boolean | null) => (on === false ? "opacity-[.16]" : "");
  const hand = (pick: Pick) => ({
    onPointerEnter: () => onPoint?.(pick),
    onPointerLeave: () => onPoint?.(null),
    onClick: () => onPick?.(pick),
  });
  return (
    <div ref={room} className={cx("min-w-0", className)}>
      {lay ? (
        <svg
          width={lay.width}
          height={lay.height}
          role="img"
          aria-label={`${run.name}: ${count(run.claims.length, "claim")} from ${count(run.sources.length, "source")}`}
          className="block select-none [&_*]:transition-[opacity,fill,stroke] [&_*]:duration-150"
        >
          {lay.islands.map((i) => (
            <path key={i.kind} d={i.path} fill="var(--ui-paper)" stroke="var(--ui-hair)" />
          ))}
          {lay.edges.map((e) => {
            const on = edgeOn(e.claim, e.source);
            return (
              <path
                key={`${e.claim}-${e.source}`}
                d={e.d}
                fill="none"
                stroke={on ? "var(--ui-active)" : "var(--ui-ink)"}
                strokeOpacity={on ? 0.9 : 0.26}
                strokeWidth={e.width}
                strokeLinecap="round"
                className={tone(on)}
              />
            );
          })}
          {lay.islands.flatMap((i) =>
            i.discs.map((d) => {
              const on = discOn(d.id, d.claims);
              const ink = on ? "var(--ui-active)" : "var(--ui-ink)";
              return (
                // pointer only: the rows under the graph pick the same source by key
                <g
                  key={d.id}
                  data-source={d.id}
                  className={cx("cursor-pointer", tone(on))}
                  {...hand({ source: d.id })}
                >
                  <circle cx={d.x} cy={d.y} r={Math.max(d.r, 10)} fill="transparent" />
                  {d.kept ? (
                    <circle cx={d.x} cy={d.y} r={d.r} fill={ink} fillOpacity={on ? 0.2 : 0.1} />
                  ) : (
                    <circle
                      cx={d.x}
                      cy={d.y}
                      r={d.r}
                      fill="none"
                      stroke="var(--ui-ink-3)"
                      strokeDasharray="2.5 2.5"
                    />
                  )}
                  {d.core ? <circle cx={d.x} cy={d.y} r={d.core} fill={ink} /> : null}
                </g>
              );
            }),
          )}
          {lay.islands.map((i) => (
            <g
              key={i.kind}
              className="pointer-events-none [paint-order:stroke] stroke-(--ui-tile) [stroke-width:4px] [stroke-linejoin:round]"
            >
              <text
                x={i.cx}
                y={i.top + 12}
                textAnchor="middle"
                className="fill-(--ui-ink) text-[12px] font-semibold"
              >
                {i.kind}
              </text>
              <text
                x={i.cx}
                y={i.top + 26}
                textAnchor="middle"
                className="fill-(--ui-ink-3) text-[11px]"
              >
                {count(i.sources, "source")} · {i.kept.toLocaleString("en-US")} kept
              </text>
            </g>
          ))}
          {lay.hubs.map((h) => {
            const on = hubOn(h.n);
            return (
              // pointer only: the claim rows pick the same claim by key
              <g
                key={h.n}
                data-claim={h.n}
                className={cx("cursor-pointer", tone(on))}
                {...hand({ claim: h.n })}
              >
                <circle
                  cx={h.x}
                  cy={h.y}
                  r={HUB_R}
                  fill="var(--ui-paper)"
                  stroke={on ? "var(--ui-active)" : "var(--ui-ink)"}
                  strokeWidth={1.3}
                />
                <text
                  x={h.x}
                  y={h.y + 4}
                  textAnchor="middle"
                  className={cx(
                    "text-[11.5px] font-semibold tabular-nums",
                    on ? "fill-(--ui-active)" : "fill-(--ui-ink)",
                  )}
                >
                  {h.n}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
