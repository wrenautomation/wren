/** A genome's lineage: its versions as a graph, React Flow loaded only when one shows. */
import { lazy, Suspense } from "react";

/** One version: what it added and retired against its parent. */
export interface LineageVersion {
  version: string;
  parent: string | null;
  at: string;
  live: boolean;
  added: { locus: string; text: string }[];
  retired: { locus: string; text: string }[];
}

const LineageGraph = lazy(() => import("./lineage-graph.js"));

export function Lineage({ versions }: { versions: readonly LineageVersion[] }) {
  if (!versions.length) return <p className="text-[14px] text-(--ui-ink-2)">No versions yet.</p>;
  return (
    <Suspense fallback={<div className="min-h-20" />}>
      <LineageGraph versions={versions} />
    </Suspense>
  );
}
