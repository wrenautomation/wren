/**
 * The graph kit: every graph in the portal draws through it. React Flow and elk load only when a
 * graph shows, so first paint never carries them.
 */
import { lazy, Suspense, useMemo } from "react";
import type { GraphProps } from "./canvas.js";
import { journeyOf, type Touch } from "./journey.js";
import type { WebCanvasProps } from "./web-canvas.js";

export type { GraphDot, GraphEdit, GraphProps } from "./canvas.js";
export { journeyOf, type Touch } from "./journey.js";
export {
  edgeId,
  GRAPH_DROP,
  type GraphEdge,
  type GraphKind,
  type GraphMark,
  type GraphNode,
  type GraphNumber,
  type GraphPort,
  type GraphRole,
  type GraphTone,
  percent,
  RIBBON,
  ribbonMax,
  ribbonWidth,
  wireLines,
} from "./model.js";
export type { WebCanvasProps, WebHandle } from "./web-canvas.js";
export type { WebDot, WebLink } from "./web-model.js";

const GraphCanvas = lazy(() => import("./canvas.js"));
const WebCanvasLazy = lazy(() => import("./web-canvas.js"));

/** A web of many dots at fixed places (sigma, WebGL): zoom shows detail by size. Its own chunk. */
export function WebCanvas(props: WebCanvasProps) {
  if (!props.dots.length) return <p className="text-[14px] text-(--ui-ink-2)">Nothing to draw.</p>;
  return (
    <Suspense
      fallback={<div className="h-full min-h-80 w-full bg-(--ui-canvas)" aria-busy="true" />}
    >
      <WebCanvasLazy {...props} />
    </Suspense>
  );
}

export function Graph(props: GraphProps) {
  if (!props.nodes.length) return <p className="text-[14px] text-(--ui-ink-2)">Nothing to draw.</p>;
  return (
    <Suspense
      fallback={
        <div className="h-40 w-full border border-(--ui-hair) bg-(--ui-tile)" aria-busy="true" />
      }
    >
      <GraphCanvas {...props} />
    </Suspense>
  );
}

/** A lead's touches in time order, a lane per channel: what went out, what came back, the booking. */
export function Journey({
  touches,
  label,
  zone,
}: {
  touches: readonly Touch[];
  label: string;
  zone?: string | undefined;
}) {
  const g = useMemo(() => journeyOf(touches, zone), [touches, zone]);
  if (!g.nodes.length) return <p className="text-[14px] text-(--ui-ink-2)">No touches yet.</p>;
  return <Graph {...g} label={label} layout="lanes" tools={g.nodes.length > 8} name={label} />;
}
