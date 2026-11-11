/**
 * Research › Runs (designs/2026-11-05-research-web.md, 11-10, WA-1106): the run fills the page.
 * Live follows the side panel chat's runs; History lists every run; `?run=` opens one. The chat
 * is the shell's side panel, never a column here.
 */
import { cx, Seg } from "@wren/ui";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { LiveRuns } from "./live.js";
import { RunHistory } from "./page.js";

type View = "live" | "history";

const VIEWS = [
  { value: "live", label: "Live" },
  { value: "history", label: "History" },
] as const;
const FADE = "[animation:ui-fade_.2s_var(--ui-ease)_both]";

export function RunsPage({ params, team }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const view: View = params.get("view") === "history" ? "history" : "live";
  if (params.get("run")) return <RunHistory params={params} team={team} here={here} />;
  return (
    <div className="grid min-w-0 content-start gap-4">
      <div>
        <Seg
          label="Runs"
          items={VIEWS}
          value={view}
          onChange={(v) => navigate(href(here, { view: v === "live" ? null : v }, params))}
        />
      </div>
      {/* key: a view switch replays the fade */}
      <div key={view} className={cx("grid min-w-0", FADE)}>
        {view === "live" ? (
          <LiveRuns params={params} here={here} />
        ) : (
          <RunHistory params={params} team={team} here={here} />
        )}
      </div>
    </div>
  );
}
