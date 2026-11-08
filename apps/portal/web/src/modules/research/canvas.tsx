/**
 * One or more runs on the round 13 graph (designs/2026-11-05-research-web.md, 11-08): Live and
 * History both draw through here. Several runs merge; a source two runs read links them.
 */
import { LoadFailed, Loading } from "@wren/ui";
import type { LayId } from "@wren/ui/research/run";
import { mergeGraphs } from "@wren/ui/research/run/merge";
import { useMemo } from "react";
import { runGraphOf } from "./graph.js";
import { RunGraph } from "./run-lazy.js";
import { type RunRow, useViews } from "./serve.js";

export function RunsCanvas({
  runs,
  rows,
  title,
  lay,
  onLay,
}: {
  /** oldest first: run 1 is the first */
  runs: readonly string[];
  rows: readonly RunRow[];
  /** the merged graph's head */
  title: string;
  lay?: LayId | undefined;
  onLay?: (l: LayId) => void;
}) {
  const got = useViews(runs);
  const byRun = useMemo(() => new Map(rows.map((r) => [r.run, r])), [rows]);
  const graph = useMemo(() => {
    if (!got.views) return undefined;
    const gs = got.views.map((v) => runGraphOf(v, byRun.get(v.run) ?? null));
    return gs.length === 1 ? gs[0] : mergeGraphs(gs, title);
  }, [got.views, byRun, title]);
  if (got.error && !got.views) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!graph)
    return (
      <Loading
        shape="cards"
        lines={3}
        heading
        label={runs.length > 1 ? `Reading runs: ${got.got} of ${runs.length}` : "Loading the run"}
      />
    );
  return <RunGraph run={graph} {...(lay ? { lay } : {})} {...(onLay ? { onLay } : {})} />;
}
