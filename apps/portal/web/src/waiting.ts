/**
 * What waits in each app, by page: pages with a `count` in Wren's workspace, pages with a `badge`
 * in any. One read for every app on load and, on the app's pulse, each minute while the tab shows, for the sidebar
 * and Today; the open app's again on each move, so a tab drops as soon as its rows are done.
 * Wren's moves (`./moves.ts`) are read here too, from the pages that count them, so the sidebar,
 * the dock and Today never disagree. A parked app is neither counted nor read.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./api.js";
import { useCall } from "./load.js";
import type { Module, ModulePage } from "./module.js";
import { MOVE_RECORDS, type Moves, movesOf, sourcesOf, whereOf } from "./moves.js";
import { onPulse } from "./pulse.js";

/** App id → page id → rows waiting. A page with none isn't named. */
export type Waiting = Readonly<Record<string, Readonly<Record<string, number>>>>;

const counted = (p: ModulePage) =>
  "count" in p && p.count && "record" in p ? { record: p.record, where: p.count } : null;

/**
 * The counts as a read: `loading` until the first lands, `error` the first count that failed in
 * the last read (its pages show none), `retry` reads every app again.
 */
export type WaitingRead = { loading: boolean; error: unknown; retry: () => void };

/** Wren's moves as a read: the lines grouped, how many, and the same loading and retry. */
export type MovesRead = Moves & { loading: boolean; error: unknown; retry: () => void };

/**
 * Every app's waiting rows: all the counts in one read, not one per page; badges beside it. A
 * failed count leaves its pages out and names its error.
 */
export async function readApps(
  apps: readonly Module[],
  client: string,
  wren: boolean,
  team: boolean,
) {
  // A page reached by link only (Marketing's copy of To approve) would count its rows twice. One
  // that lists a move (Email replies) counts when no shown page counts the same rows.
  const live = apps.filter((m) => !m.parked);
  const shown = live.flatMap((m) =>
    m.pages.filter((p) => !p.hidden).map((p) => ({ app: m.id, page: p })),
  );
  const same = (a: ModulePage) => JSON.stringify(["record" in a ? a.record : null, whereOf(a)]);
  const have = new Set(shown.map((x) => same(x.page)));
  const moved = live.flatMap((m) =>
    m.pages.flatMap((p) => {
      if (!p.hidden || !("record" in p) || !MOVE_RECORDS.has(p.record) || !whereOf(p)) return [];
      if (have.has(same(p))) return [];
      have.add(same(p));
      return [{ app: m.id, page: p }];
    }),
  );
  const pages = [...shown, ...moved];
  let error: unknown = null;
  const failed =
    <T>(dropped: T) =>
    (e: unknown) => {
      error ??= e;
      return dropped;
    };
  const counts = wren
    ? pages.flatMap(({ app, page }) => {
        const c = counted(page);
        return c ? [{ app, id: page.id, ...c }] : [];
      })
    : [];
  const totals = counts.length
    ? call<{ totals: number[] }>("console/recordsCounts", {
        asks: counts.map(({ record, where }) => ({ record, where })),
      }).then((r) => counts.map((c, i) => [c.app, c.id, r.totals[i] ?? 0] as const), failed([]))
    : Promise.resolve([]);
  const badges = pages.flatMap(({ app, page }) =>
    !(wren && counted(page)) && page.badge
      ? [
          page
            .badge(client, team)
            .then((n) => [app, page.id, n] as const, failed([app, page.id, 0] as const)),
        ]
      : [],
  );
  const out: Record<string, Record<string, number>> = Object.fromEntries(
    live.map((m) => [m.id, {}]),
  );
  for (const [app, id, n] of [...(await totals), ...(await Promise.all(badges))]) {
    const at = out[app];
    if (at && n > 0) at[id] = n;
  }
  return { out, error };
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
): { waiting: Waiting; read: WaitingRead; moves: MovesRead } {
  const [waiting, setWaiting] = useState<Waiting>({});
  const [state, setState] = useState<{ loading: boolean; error: unknown }>({
    loading: true,
    error: null,
  });
  const again = useRef(() => {});
  const latest = useRef(apps);
  latest.current = apps;
  const ids = apps.map((m) => m.id).join(",");
  const key = client ? `${client}:${wren}:${team}:${ids}` : "";

  // read-ok: badge counts on the app's one pulse (./pulse.ts), not a list; each app's own read
  // is where its rows are kept.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the workspace and its apps.
  useEffect(() => {
    if (!key || !client) return void setWaiting({});
    let live = true;
    setState({ loading: true, error: null });
    const all = () =>
      readApps(latest.current, client, wren, team).then(({ out, error }) => {
        if (!live) return;
        setWaiting(out);
        setState({ loading: false, error });
      });
    again.current = () => void all();
    // The app's one pulse: now, each minute while the tab shows, and on return (./pulse.ts).
    const leave = onPulse(all);
    return () => {
      live = false;
      leave();
    };
  }, [key]);

  // read-ok: the open app's badge again after a move, patched into the pulse's counts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move reads the open app again.
  useEffect(() => {
    const m = latest.current.find((x) => x.id === open);
    if (!key || !client || !m) return;
    let live = true;
    // A failed read keeps the pulse's counts for this app.
    void readApps([m], client, wren, team).then(
      ({ out, error }) => live && !error && setWaiting((w) => ({ ...w, ...out })),
    );
    return () => {
      live = false;
    };
  }, [key, open, at]);

  const retry = useCallback(() => again.current(), []);

  // Wren's moves: the sources whose pages count rows, read together when a count moves.
  const sig = wren ? sourcesOf(apps, waiting).map((x) => `${x.s.id}:${x.n}`) : [];
  const moved = useCall<Moves>(
    wren && client && !state.loading ? `moves:${client}:${sig.join(",")}` : null,
    () => movesOf(latest.current, waiting),
  );
  const none = !wren || !client;
  const moves: MovesRead = {
    groups: moved.data?.groups ?? [],
    count: moved.data?.count ?? 0,
    loading: !none && !moved.error && (state.loading || !moved.data),
    error: none ? null : (moved.error ?? null),
    retry: moved.retry,
  };
  return { waiting, read: { ...state, retry }, moves };
}
