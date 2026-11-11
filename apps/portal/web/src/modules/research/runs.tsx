/**
 * Research › Runs (designs/2026-11-05-research-web.md, 11-10, WA-1106): the chat on the left, its
 * runs on the right. Live follows the chat's runs; History lists every run; `?run=` opens one.
 * Under 1000 px of main, one pane at a time: Chat, Live or History (`?pane=runs`).
 */
import { cx, Seg } from "@wren/ui";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { ChatColumn } from "./ask.js";
import { LiveRuns } from "./live.js";
import { RunHistory } from "./page.js";

type View = "live" | "history";
type Pane = "chat" | "runs";

const VIEWS = [
  { value: "live", label: "Live" },
  { value: "history", label: "History" },
] as const;
const PANES = [{ value: "chat", label: "Chat" }, ...VIEWS] as const;
const FADE = "[animation:ui-fade_.2s_var(--ui-ease)_both]";

export function RunsPage({ params, who, team }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const view: View = params.get("view") === "history" ? "history" : "live";
  const pane: Pane = params.get("pane") === "runs" ? "runs" : "chat";
  const open = params.get("run");
  const go = (p: Record<string, string | null>) => navigate(href(here, p, params));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 @min-[1000px]/main:grid @min-[1000px]/main:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] @min-[1000px]/main:gap-0">
      {/* narrow: one control picks the pane and the view */}
      <div className="@min-[1000px]/main:hidden">
        <Seg
          label="Show"
          items={PANES}
          value={pane === "chat" ? "chat" : view}
          onChange={(v) =>
            go(v === "chat" ? { pane: null } : { pane: "runs", view: v === "live" ? null : v })
          }
        />
      </div>
      <section
        aria-label="Chat"
        className={cx(
          "flex min-h-0 min-w-0 flex-col @min-[1000px]/main:border-(--ui-hair) @min-[1000px]/main:border-r",
          "@max-[1000px]/main:h-[calc(100dvh-220px)] @max-[1000px]/main:min-h-[420px]",
          // display none to shown replays the fade: the pane switch
          FADE,
          pane === "runs" && "@max-[1000px]/main:hidden",
        )}
      >
        <ChatColumn params={params} who={who} team={team} here={here} />
      </section>
      <section
        aria-label="Runs"
        className={cx(
          "grid min-h-0 min-w-0 content-start gap-4 @min-[1000px]/main:overflow-y-auto @min-[1000px]/main:pl-6",
          // narrow: the page reaches the tabs, as the chat pane does
          "@max-[1000px]/main:min-h-[calc(100dvh-220px)]",
          FADE,
          pane === "chat" && "@max-[1000px]/main:hidden",
        )}
      >
        {open ? (
          <RunHistory params={params} team={team} here={here} />
        ) : (
          <>
            {/* the chat head's band: both heads on one line */}
            <div className="flex min-h-[54px] items-center @max-[1000px]/main:hidden">
              <Seg
                label="Runs"
                items={VIEWS}
                value={view}
                onChange={(v) => go({ view: v === "live" ? null : v })}
              />
            </div>
            <div key={view} className={cx("grid min-w-0", FADE)}>
              {view === "live" ? (
                <LiveRuns params={params} here={here} />
              ) : (
                <RunHistory params={params} team={team} here={here} />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
