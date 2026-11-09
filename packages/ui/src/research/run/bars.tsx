/** The graph's toolbar: round (or run) filter, zoom and reset. */
import type { Indexed } from "./model.js";

export interface BarsProps {
  L: Indexed;
  round: number;
  /** "round" or "run": a merged graph counts runs */
  step: "round" | "run";
  toRound: (r: number) => void;
  zoomBy: (k: number) => void;
  reset: () => void;
}

export function Bars({ L, round, step, toRound, zoomBy, reset }: BarsProps) {
  const Step = step === "run" ? "Run" : "Round";
  const runs = L.run.runs;
  return (
    <div className="bar">
      <span className="sp" />
      {L.rounds.length > 1 ? (
        <span className="grp">
          <span className="lb">{Step}</span>
          {L.rounds.length > 8 ? (
            <select
              className="seg"
              aria-label={`Up to ${step}`}
              value={round}
              onChange={(e) => toRound(Number(e.target.value))}
            >
              {[0, ...L.rounds].map((r) => (
                <option key={r} value={r}>
                  {r ? `Up to ${step} ${r}${runs ? `: ${runs[r - 1]?.t ?? ""}` : ""}` : "All"}
                </option>
              ))}
            </select>
          ) : (
            <div className="seg">
              {[0, ...L.rounds].map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === round}
                  title={r && runs ? runs[r - 1]?.t : undefined}
                  onClick={() => toRound(r)}
                >
                  {r || "All"}
                </button>
              ))}
            </div>
          )}
        </span>
      ) : null}
      <span className="grp">
        <button type="button" className="btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          −
        </button>
        <button type="button" className="btn" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
          +
        </button>
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
      </span>
    </div>
  );
}
