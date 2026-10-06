/**
 * The graph kit: every graph in the portal draws through it. React Flow and elk load only when a
 * graph shows, so first paint never carries them.
 */
import { lazy, Suspense } from "react";
import type { GraphProps } from "./canvas.js";

export type { GraphDot, GraphEdit, GraphProps } from "./canvas.js";
export {
  edgeId,
  type GraphEdge,
  type GraphKind,
  type GraphNode,
  type GraphNumber,
  type GraphTone,
  percent,
  wireLines,
} from "./model.js";

const GraphCanvas = lazy(() => import("./canvas.js"));

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
