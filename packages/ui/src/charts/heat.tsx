/**
 * A figure for each pair of two steps (day by hour): one hue, light for few and deep for many, a
 * 2px paper gap between cells. Hover a cell for its figure. Plain HTML, so it needs no chart chunk.
 */
import { useState } from "react";

export interface HeatProps {
  /** Down the side, top first: "Mon", "Tue". */
  rows: readonly string[];
  /** Across, left first: "0", "1" … "23". A label of "" draws no tick. */
  cols: readonly string[];
  /** `cells[row][col]`. */
  cells: readonly (readonly number[])[];
  /** What a cell counts, for its readout and the screen reader: "replies". */
  label: string;
  /** The colour at the most; the least is the paper. */
  color?: string | undefined;
  format?: ((n: number) => string) | undefined;
}

/** The share of the hue at the least, so a cell with one still reads apart from none. */
const FLOOR = 12;

export function HeatChart({
  rows,
  cols,
  cells,
  label,
  color = "var(--ui-chart-1)",
  format = (n) => n.toLocaleString("en-US"),
}: HeatProps) {
  const [at, setAt] = useState<{ r: number; c: number } | null>(null);
  const most = Math.max(0, ...cells.flat());
  const peak = (() => {
    let best = { r: 0, c: 0 };
    cells.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v > (cells[best.r]?.[best.c] ?? 0)) best = { r, c };
      });
    });
    return best;
  })();
  const shown = at ?? peak;
  const value = cells[shown.r]?.[shown.c] ?? 0;
  const fill = (v: number) =>
    v <= 0
      ? "var(--ui-fill)"
      : `color-mix(in oklab, ${color} ${Math.round(FLOOR + (v / most) * (100 - FLOOR))}%, var(--ui-paper))`;
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[13px] text-(--ui-ink-2) tabular-nums" aria-live="polite">
        <b className="font-semibold text-(--ui-ink)">
          {rows[shown.r]} {cols[shown.c] || shown.c}:00
        </b>
        {` · ${format(value)} ${label}${at ? "" : ", the most"}`}
      </p>
      <div
        role="img"
        aria-label={`${label} by ${rows.length} rows and ${cols.length} columns; the most, ${format(cells[peak.r]?.[peak.c] ?? 0)}, at ${rows[peak.r]} ${peak.c}:00`}
        className="grid gap-0.5 text-[11px] text-(--ui-ink-3)"
        style={{ gridTemplateColumns: `32px repeat(${cols.length}, minmax(0, 1fr))` }}
        // Hover is a pointer's extra: the readout above names the peak for every reader.
        onPointerOver={(e) => {
          const cell = (e.target as HTMLElement).dataset;
          if (cell.r !== undefined) setAt({ r: Number(cell.r), c: Number(cell.c) });
        }}
        onPointerLeave={() => setAt(null)}
      >
        {rows.map((name, r) => (
          <div key={name} className="contents">
            <span className="self-center">{name}</span>
            {cols.map((_, c) => {
              const v = cells[r]?.[c] ?? 0;
              const lit = at?.r === r && at.c === c;
              return (
                <i
                  // biome-ignore lint/suspicious/noArrayIndexKey: a cell is its place in the grid.
                  key={c}
                  data-r={r}
                  data-c={c}
                  className="block h-6 rounded-[1px_3px] transition-shadow duration-150 motion-reduce:transition-none"
                  style={{
                    background: fill(v),
                    boxShadow: lit ? "0 0 0 2px var(--ui-ink)" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}
        <span />
        {cols.map((name, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a tick is its column.
          <span key={c} className="text-center tabular-nums">
            {name}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-(--ui-ink-3)" aria-hidden="true">
        <span>Fewer</span>
        <span
          className="h-2 w-24 rounded-[1px_3px]"
          style={{
            background: `linear-gradient(to right, ${fill(most * 0.01 || 1)}, ${fill(most || 1)})`,
          }}
        />
        <span>More</span>
      </div>
    </div>
  );
}
