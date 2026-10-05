/** What feeds what, left to right: parts and what each builds on. React Flow loads only when one shows. */
import { lazy, Suspense } from "react";

export interface MapBox {
  id: string;
  label: string;
  /** One short line under the label. */
  note?: string | undefined;
  /** The boxes it builds on; ids not drawn are skipped. */
  after: string[];
  href?: string | undefined;
  /** Drawn as an input (an account, a source): dashed, no fill. */
  input?: boolean | undefined;
  /** Faded: not had, not ready. */
  dim?: boolean | undefined;
  /** Its main number, as a line ("1,204 checked leads"). */
  count?: string | undefined;
  /** Opens into more boxes (a workflow inside): drawn as a stack. */
  stacked?: boolean | undefined;
  /** What moves on the line from each box in `after`, by that box's id; a newline starts a row. */
  labels?: Readonly<Record<string, string>> | undefined;
}

/** Wiring by hand: a line dragged from one box onto another, and a line clicked. */
export interface FlowEdit {
  /** Which handles a box shows: a line starts at `from`, ends at `to`. */
  ends(id: string): { from: boolean; to: boolean };
  /** Whether a line from `from` may end at `to`. */
  fits(from: string, to: string): boolean;
  connect(from: string, to: string): void;
  pick(from: string, to: string): void;
}

const FlowMapGraph = lazy(() => import("./flow-map-graph.js"));

export function FlowMap({
  boxes,
  label,
  edit,
}: {
  boxes: readonly MapBox[];
  label: string;
  edit?: FlowEdit | undefined;
}) {
  if (!boxes.length) return <p className="text-[14px] text-(--ui-ink-2)">Nothing to draw.</p>;
  return (
    <Suspense fallback={<div className="min-h-40" />}>
      <FlowMapGraph boxes={boxes} label={label} edit={edit} />
    </Suspense>
  );
}
