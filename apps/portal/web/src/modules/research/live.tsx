/**
 * Research › Runs, Live (designs/2026-11-05-research-web.md, 11-08, 11-10): the runs in front of
 * you now, on one round 13 graph that follows them. The open chat's runs and runs still going; with
 * none, the newest run. History holds every run.
 */
import { AskAgent, cx, Empty, Loading } from "@wren/ui";
import { useMemo } from "react";
import { useCall } from "../../load.js";
import { href } from "../../route.js";
import { useChatRuns, usePageContext, usePageRuns } from "../agent/drive.js";
import { QUIET } from "../work/bits.js";
import { RunsCanvas } from "./canvas.js";
import { NoServe } from "./page.js";
import { type RunRow, runsOf, useLive } from "./serve.js";

/** A run not stopped counts as going while it changed this recently. */
const FRESH = 30 * 60_000;

/** The chat's runs, then runs still going; with none, the newest. Oldest first. */
function liveRuns(rows: readonly RunRow[], chat: readonly string[], now: number): string[] {
  const known = new Set(rows.map((r) => r.run));
  const going = rows.filter((r) => r.next && now - Date.parse(r.updated) < FRESH).map((r) => r.run);
  const ids = new Set([...chat.filter((r) => known.has(r)), ...going]);
  const newest = rows.reduce<RunRow | null>((a, r) => (!a || r.updated > a.updated ? r : a), null);
  if (!ids.size && newest) ids.add(newest.run);
  const started = new Map(rows.map((r) => [r.run, r.started]));
  return [...ids].sort((a, b) => (started.get(a) ?? "").localeCompare(started.get(b) ?? ""));
}

export function LiveRuns({ params, here }: { params: URLSearchParams; here: string }) {
  const runs = useCall("research:runs", runsOf, { kept: false });
  useLive(() => runs.retry());
  const chat = useChatRuns();
  const rows = runs.data ?? [];
  const ids = useMemo(() => liveRuns(rows, chat, Date.now()), [rows, chat]);
  const byRun = new Map(rows.map((r) => [r.run, r]));
  usePageContext(
    ids.length ? `Research › Runs, Live, shows weaver runs ${ids.join(", ")}` : undefined,
  );
  usePageRuns(runs.data ? ids : undefined);
  if (runs.error && !runs.data) return <NoServe error={runs.error} onRetry={runs.retry} />;
  if (!runs.data) return <Loading shape="cards" lines={3} heading />;
  if (!ids.length)
    return (
      <Empty title="No runs yet" action={<AskAgent setup="weaver" ask="Research: " />}>
        Ask weaver a question; its runs draw here as they go.
      </Empty>
    );
  const from = chat.some((r) => ids.includes(r));
  return (
    <div className="grid min-w-0 gap-3">
      <header className="grid gap-1">
        <p className={cx("m-0 text-[12.5px]", QUIET)}>
          {from ? "This chat's runs" : ids.length > 1 ? "Runs going now" : "The newest run"}
          {ids.length > 1 ? `, numbered as on the graph` : ""}
        </p>
        {ids.length > 1 ? (
          <ol className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {ids.map((id, i) => (
              <li key={id} className="flex min-w-0 gap-2">
                <span className={cx("tabular-nums", QUIET)}>Run {i + 1}</span>
                <a
                  href={href(here, { run: id }, params)}
                  className="min-w-0 wrap-anywhere text-(--ui-ink) underline"
                >
                  {byRun.get(id)?.ask || id}
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </header>
      <RunsCanvas runs={ids} rows={rows} title={from ? "This chat's runs" : "Runs going now"} />
    </div>
  );
}
