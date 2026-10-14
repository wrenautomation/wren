/**
 * What waits in each app, by page: pages with a `count` in Wren's workspace, pages with a `badge`
 * in any. One read for every app on load and, on the app's pulse, each minute while the tab shows, for the sidebar
 * and Today; the open app's again on each move, so a tab drops as soon as its rows are done.
 */
import { useEffect, useRef, useState } from "react";
import { call } from "./api.js";
import type { Module, ModulePage } from "./module.js";
import { onPulse } from "./pulse.js";

/** App id → page id → rows waiting. A page with none isn't named. */
export type Waiting = Readonly<Record<string, Readonly<Record<string, number>>>>;

const counted = (p: ModulePage) =>
  "count" in p && p.count && "record" in p ? { record: p.record, where: p.count } : null;

/** Every app's waiting rows: all the counts in one read, not one per page; badges beside it. */
async function readApps(apps: readonly Module[], client: string, wren: boolean, team: boolean) {
  // A page reached by link only (Marketing's copy of To approve) would count its rows twice.
  const pages = apps.flatMap((m) =>
    m.pages.filter((p) => !p.hidden).map((p) => ({ app: m.id, page: p })),
  );
  const counts = wren
    ? pages.flatMap(({ app, page }) => {
        const c = counted(page);
        return c ? [{ app, id: page.id, ...c }] : [];
      })
    : [];
  const totals = counts.length
    ? call<{ totals: number[] }>("console/recordsCounts", {
        asks: counts.map(({ record, where }) => ({ record, where })),
      }).then(
        (r) => counts.map((c, i) => [c.app, c.id, r.totals[i] ?? 0] as const),
        () => [],
      )
    : Promise.resolve([]);
  const badges = pages.flatMap(({ app, page }) =>
    !(wren && counted(page)) && page.badge
      ? [
          page.badge(client, team).then(
            (n) => [app, page.id, n] as const,
            () => [app, page.id, 0] as const,
          ),
        ]
      : [],
  );
  const out: Record<string, Record<string, number>> = Object.fromEntries(
    apps.map((m) => [m.id, {}]),
  );
  for (const [app, id, n] of [...(await totals), ...(await Promise.all(badges))]) {
    const at = out[app];
    if (at && n > 0) at[id] = n;
  }
  return out;
}

/** The sum an app shows beside its name: all its pages' counts. */
export const appTotal = (pages: Readonly<Record<string, number>> | undefined) =>
  Object.values(pages ?? {}).reduce((n, k) => n + k, 0);

export function useWaiting(
  apps: readonly Module[],
  client: string | undefined,
  wren: boolean,
  team: boolean,
  open: string | undefined,
  at: string,
): Waiting {
  const [waiting, setWaiting] = useState<Waiting>({});
  const latest = useRef(apps);
  latest.current = apps;
  const ids = apps.map((m) => m.id).join(",");
  const key = client ? `${client}:${wren}:${team}:${ids}` : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the workspace and its apps.
  useEffect(() => {
    if (!key || !client) return void setWaiting({});
    let live = true;
    const all = () =>
      readApps(latest.current, client, wren, team).then((got) => live && setWaiting(got));
    // The app's one pulse: now, each minute while the tab shows, and on return (./pulse.ts).
    const leave = onPulse(all);
    return () => {
      live = false;
      leave();
    };
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a move reads the open app again.
  useEffect(() => {
    const m = latest.current.find((x) => x.id === open);
    if (!key || !client || !m) return;
    let live = true;
    void readApps([m], client, wren, team).then(
      (got) => live && setWaiting((w) => ({ ...w, ...got })),
    );
    return () => {
      live = false;
    };
  }, [key, open, at]);

  return waiting;
}
