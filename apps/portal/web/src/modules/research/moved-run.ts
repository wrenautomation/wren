/** Research › Runs' old addresses (`?run=`, History) in Explorer › Weaver (WA-1373). */
import { explorerHref, wholeHref } from "../explorer/href.js";

/** An old address's place in Explorer: one run whole, several or all on one graph, or the list. */
export function movedRun(params: URLSearchParams): string | null {
  const run = params.get("run");
  if (run) {
    const one = run !== "all" && !run.includes(",");
    return wholeHref(one ? `weaver/${run}` : "weaver", {
      run: one ? null : run,
      tab: params.get("tab"),
      open: params.get("open"),
    });
  }
  return params.get("view") === "history" ? explorerHref("weaver") : null;
}
