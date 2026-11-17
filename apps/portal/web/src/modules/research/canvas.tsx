/**
 * One or more runs on the round 13 graph (designs/2026-11-05-research-web.md, 11-08): Live and
 * History both draw through here. Several runs merge; a source two runs read links them.
 */
import { LoadFailed, Loading } from "@wren/ui";
import { mergeGraphs } from "@wren/ui/research/run/merge";
import { useMemo } from "react";
import { PostPlayer } from "../canon/post-detail.js";
import { boardPages } from "./board.js";
import { runGraphOf } from "./graph.js";
import { RunGraph } from "./run-lazy.js";
import { type RunRow, useViews } from "./serve.js";

export function RunsCanvas({
  runs,
  rows,
  title,
}: {
  /** oldest first: run 1 is the first */
  runs: readonly string[];
  rows: readonly RunRow[];
  /** the merged graph's head */
  title: string;
}) {
  const got = useViews(runs);
  const byRun = useMemo(() => new Map(rows.map((r) => [r.run, r])), [rows]);
  const graph = useMemo(() => {
    if (!got.views) return undefined;
    const gs = got.views.map((v) => runGraphOf(v, byRun.get(v.run) ?? null));
    return gs.length === 1 ? gs[0] : mergeGraphs(gs, title);
  }, [got.views, byRun, title]);
  // a page's post by its URL: the graph's side panel plays it in the References player
  const media = useMemo(() => {
    const posts = new Map(
      (got.views ?? []).flatMap((v) =>
        [...boardPages(v).values()].flatMap((p) => [
          [p.s.url, p.r] as const,
          ...(p.d ? [[p.d.url, p.r] as const] : []),
        ]),
      ),
    );
    return (url: string) => {
      const r = posts.get(url);
      return r ? <PostPlayer key={url} r={r} /> : null;
    };
  }, [got.views]);
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
  return <RunGraph run={graph} media={media} />;
}
