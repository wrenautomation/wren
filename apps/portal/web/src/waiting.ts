/**
 * What waits in each app, by page: pages with a `count` in Wren's workspace, pages with a `badge`
 * in any. One read for every app on load and each minute, for the sidebar and Today; the open
 * app's again on each move, so a tab drops as soon as its rows are done.
 */
import { useEffect, useRef, useState } from "react";
import { call } from "./api.js";
import type { Module, ModulePage } from "./module.js";

/** App id → page id → rows waiting. A page with none isn't named. */
export type Waiting = Readonly<Record<string, Readonly<Record<string, number>>>>;

const EVERY_MS = 60_000;

const counted = (p: ModulePage) =>
  "count" in p && p.count && "record" in p ? { record: p.record, where: p.count } : null;

async function readApp(m: Module, client: string, wren: boolean, team: boolean) {
  // A page reached by link only (Marketing's copy of To approve) would count its rows twice.
  const reads = m.pages
    .filter((p) => !p.hidden)
    .flatMap((p) => {
      const c = wren ? counted(p) : null;
      if (c)
        return [
          call<{ total: number }>("console/recordsList", { ...c, limit: 1 }).then(
            (r) => [p.id, r.total] as const,
            () => [p.id, 0] as const,
          ),
        ];
      if (p.badge)
        return [
          p.badge(client, team).then(
            (n) => [p.id, n] as const,
            () => [p.id, 0] as const,
          ),
        ];
      return [];
    });
  const got = await Promise.all(reads);
  return Object.fromEntries(got.filter(([, n]) => n > 0));
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
      Promise.all(
        latest.current.map(async (m) => [m.id, await readApp(m, client, wren, team)] as const),
      ).then((got) => live && setWaiting(Object.fromEntries(got)));
    void all();
    const timer = setInterval(() => void all(), EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a move reads the open app again.
  useEffect(() => {
    const m = latest.current.find((x) => x.id === open);
    if (!key || !client || !m) return;
    let live = true;
    void readApp(m, client, wren, team).then(
      (pages) => live && setWaiting((w) => ({ ...w, [m.id]: pages })),
    );
    return () => {
      live = false;
    };
  }, [key, open, at]);

  return waiting;
}
