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
}

const FlowMapGraph = lazy(() => import("./flow-map-graph.js"));

export function FlowMap({ boxes, label }: { boxes: readonly MapBox[]; label: string }) {
  if (!boxes.length) return <p className="text-[14px] text-(--ui-ink-2)">Nothing to draw.</p>;
  return (
    <Suspense fallback={<div className="min-h-40" />}>
      <FlowMapGraph boxes={boxes} label={label} />
    </Suspense>
  );
}
