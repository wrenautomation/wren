/**
 * Research › Runs (designs/2026-11-05-research-web.md, 11-10, WA-1106): Live follows the side
 * panel chat's runs. Every run, and a run opened whole, sit in Explorer › Weaver (WA-1373); an
 * old `?run=` or History link goes on there.
 */
import { useEffect } from "react";
import type { PageProps } from "../../module.js";
import { navigate } from "../../route.js";
import { LiveRuns } from "./live.js";
import { movedRun } from "./moved-run.js";

export function RunsPage({ params }: PageProps) {
  const to = movedRun(params);
  useEffect(() => {
    if (to) navigate(to, true);
  }, [to]);
  return to ? null : <LiveRuns />;
}
