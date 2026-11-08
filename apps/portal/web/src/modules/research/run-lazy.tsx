/**
 * The run graph's parts, loaded on first draw: d3 and the graph (120 kB) stay out of the main
 * chunk (WA-1187). One place, so the page and the chat cards share the chunk.
 */
import { Loading } from "@wren/ui";
import type { RunCardProps, RunGraphProps } from "@wren/ui/research/run";
import { type ComponentProps, lazy, Suspense } from "react";

const load = () => import("@wren/ui/research/run");
const Graph = lazy(() => load().then((m) => ({ default: m.RunGraph })));
const Card = lazy(() => load().then((m) => ({ default: m.RunCard })));
const Source = lazy(() => load().then((m) => ({ default: m.SourceCard })));

export function RunGraph(p: RunGraphProps) {
  return (
    <Suspense fallback={<Loading lines={8} />}>
      <Graph {...p} />
    </Suspense>
  );
}

export function RunCard(p: RunCardProps) {
  return (
    <Suspense fallback={<Loading shape="rows" lines={3} />}>
      <Card {...p} />
    </Suspense>
  );
}

export function SourceCard(p: ComponentProps<typeof Source>) {
  return (
    <Suspense fallback={<Loading shape="rows" lines={3} />}>
      <Source {...p} />
    </Suspense>
  );
}
