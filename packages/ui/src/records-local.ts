/**
 * The demo's actions, in the browser: an action's `sets` lays over the server's answer, so a
 * buyer approves a draft and watches it move to Approved. Nothing reaches the server and a
 * reload resets it. No React.
 */
import type { RecordMeta, Where } from "@wren/core/records";
import type { ListAsk, Row } from "@wren/core/records/serve";
import { type Action, applies, type Call } from "./action.js";
import type { RecordsApi } from "./records.js";

/** Whether a row meets a where; only fixed values and lists of them are checked. */
export function meets(where: Where | unknown, row: Row): boolean {
  if (!where || typeof where !== "object") return true;
  return Object.entries(where).every(([k, w]) => {
    const v = String(row[k] ?? "");
    if (Array.isArray(w)) return w.map(String).includes(v);
    if (typeof w === "string" || typeof w === "number") return String(w) === v;
    return true;
  });
}

export interface LocalRecords {
  api: RecordsApi;
  /** A record type's actions as calls on this copy: each by its handler, or its undo. */
  callFor(record: string, actions: readonly Action[]): Call;
}

export function localRecords(server: RecordsApi): LocalRecords {
  let types: Promise<RecordMeta[]> | null = null;
  const metaOf = async (record: string) => {
    types ??= server.types();
    return (await types).find((t) => t.id === record);
  };
  /** The last server row per record, and the sets laid on it, newest last. */
  const seen = new Map<string, Row>();
  const laid = new Map<string, Record<string, string>[]>();
  const keyOf = (record: string, id: string | number) => `${record}:${String(id)}`;
  const patch = (record: string, row: Row): Row => {
    seen.set(keyOf(record, row.id), row);
    const sets = laid.get(keyOf(record, row.id));
    return sets?.length ? Object.assign({ ...row }, ...sets) : row;
  };
  const changed = (record: string) =>
    [...laid].flatMap(([k, sets]) => {
      const row = seen.get(k);
      return sets.length && row && k.startsWith(`${record}:`) ? [row] : [];
    });

  const api: RecordsApi = {
    types: () => (types ??= server.types()),
    export: (ask) => server.export(ask),
    async get(ask) {
      const got = await server.get(ask);
      return { ...got, row: patch(ask.record, got.row) };
    },
    async list(ask: ListAsk) {
      const page = await server.list(ask);
      const rows = page.rows.map((r) => patch(ask.record, r));
      if (ask.of || !changed(ask.record).length) return { ...page, rows };
      const meta = await metaOf(ask.record);
      const views = meta?.views ?? [];
      const view = views.find((v) => v.id === ask.view);
      const fits = (r: Row) => meets(view?.where, r) && meets(ask.where, r);
      const here = new Set(rows.map((r) => String(r.id)));
      const moved = changed(ask.record).map((r) => [r, patch(ask.record, r)] as const);
      const counts = { ...page.counts };
      for (const v of views)
        for (const [was, now] of moved)
          counts[v.id] =
            (counts[v.id] ?? 0) +
            Number(meets(v.where, now) && meets(ask.where, now)) -
            Number(meets(v.where, was) && meets(ask.where, was));
      const came = ask.cursor
        ? []
        : moved.map(([, now]) => now).filter((r) => fits(r) && !here.has(String(r.id)));
      const total = page.total + moved.reduce((n, [was, now]) => n + +fits(now) - +fits(was), 0);
      return { ...page, rows: [...came, ...rows.filter(fits)], counts, total };
    },
  };

  const callFor =
    (record: string, actions: readonly Action[]): Call =>
    async (handler, input) => {
      const ids = (input.ids as (string | number)[] | undefined) ?? [];
      const action = actions.find((a) => a.handler === handler);
      const undone = actions.find((a) => a.undo === handler);
      if (!action && !undone) throw new Error("That action isn't on this page.");
      const done: (string | number)[] = [];
      for (const id of ids) {
        const k = keyOf(record, id);
        const row = seen.get(k);
        if (!row) continue;
        const sets = laid.get(k) ?? [];
        if (action?.sets && applies(action, patch(record, row))) {
          laid.set(k, [...sets, { ...action.sets }]);
          done.push(id);
        } else if (undone && sets.length) {
          laid.set(k, sets.slice(0, -1));
          done.push(id);
        }
      }
      return { done, skipped: ids.filter((id) => !done.includes(id)) };
    };

  return { api, callFor };
}
