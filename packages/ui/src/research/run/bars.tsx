/** The graph's toolbar: round (or run) filter, the dock's panes, zoom, reset and full screen. */
import type { FullScreen } from "../../full-screen.js";
import { Icon } from "../../icons.js";
import type { Indexed } from "./model.js";

/** The dock's toggles; none outside the dock. detail: null while no window is open. */
export interface PaneBar {
  lists: boolean;
  detail: boolean | null;
  onLists: () => void;
  onDetail: () => void;
  onLayout: () => void;
}

export interface BarsProps {
  L: Indexed;
  round: number;
  /** "round" or "run": a merged graph counts runs */
  step: "round" | "run";
  toRound: (r: number) => void;
  zoomBy: (k: number) => void;
  reset: () => void;
  panes?: PaneBar | undefined;
  full?: FullScreen | undefined;
}

export function Bars({ L, round, step, toRound, zoomBy, reset, panes, full }: BarsProps) {
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
      {panes ? (
        <span className="grp">
          <button
            type="button"
            className="btn ib"
            aria-pressed={panes.lists}
            aria-label="Lists"
            title={panes.lists ? "Hide the lists" : "Show the lists"}
            onClick={panes.onLists}
          >
            <Icon name="panel" size={15} />
          </button>
          <button
            type="button"
            className="btn ib"
            aria-pressed={!!panes.detail}
            aria-label="Detail windows"
            title={
              panes.detail == null
                ? "Pick a mark to open a window"
                : panes.detail
                  ? "Hide the windows"
                  : "Show the windows"
            }
            disabled={panes.detail == null}
            onClick={panes.onDetail}
          >
            <Icon name="panelRight" size={15} />
          </button>
          <button
            type="button"
            className="btn ib"
            aria-label="Default layout"
            title="Default layout"
            onClick={panes.onLayout}
          >
            <Icon name="apps" size={15} />
          </button>
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
        {full ? (
          <button
            type="button"
            className="btn ib"
            aria-label={full.label}
            aria-pressed={full.full}
            title={full.full ? `${full.label} (Esc)` : full.label}
            onClick={full.toggle}
          >
            <Icon name={full.icon} size={15} />
          </button>
        ) : null}
      </span>
    </div>
  );
}
