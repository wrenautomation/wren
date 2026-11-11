/** The reads a list's address makes: its rows, its counts, a filter's facets, and a read ahead. */

import type { RecordMeta } from "@wren/core/records";
import type { ListAsk } from "@wren/core/records/serve";
import { readCached } from "./data/query.js";
import { filterShape, readFilter } from "./fields.js";
import { cursorAt, offsetOf, pageAt, sizeOf } from "./pager.js";
import { type RecordsApi, TYPES_FRESH_MS } from "./records-types.js";

/** The ask a list's address makes. */
export function askOf(meta: RecordMeta, params: URLSearchParams): ListAsk {
  const view = params.get("view") ?? meta.views[0]?.id;
  const where: Record<string, unknown> = {};
  for (const f of meta.fields) {
    const w = filterShape(f) ? readFilter(f, params.get(f.key)) : undefined;
    if (w !== undefined) where[f.key] = w;
  }
  const ask: ListAsk = { record: meta.id };
  if (view) ask.view = view;
  if (Object.keys(where).length) ask.where = where;
  const sort = params.get("sort");
  if (sort) ask.sort = sort;
  const group = params.get("group");
  if (group && meta.fields.some((f) => f.key === group && f.states)) ask.group = group;
  const q = params.get("q")?.trim();
  if (q) ask.q = q;
  return ask;
}

/** The page of rows an address asks for: its filters, sort and group, `pg`'s slice. Rows only. */
export function pageAskOf(meta: RecordMeta, params: URLSearchParams): ListAsk & { counts: false } {
  const pg = params.get("pg");
  const at = pageAt(pg);
  const size = sizeOf(params);
  const cursor = cursorAt(pg);
  const from = cursor ? { cursor } : at > 1 ? { offset: offsetOf(at, size) } : {};
  return { ...askOf(meta, params), limit: size, ...from, counts: false };
}

/** The counts an address shows (total, each view's, the foot's totals): one read per filter set, so paging never counts again (WA-1300). */
export const countAskOf = (meta: RecordMeta, params: URLSearchParams): ListAsk => ({
  ...askOf(meta, params),
  limit: 1,
});

/**
 * Read an address's rows ahead into the data layer, under the key the list reads them by: a
 * route's loader calls it on a hover or a move, so the list paints from the cache. The record's
 * type comes from the cached types; none cached yet, it reads nothing.
 */
export async function prefetchList(
  api: RecordsApi,
  record: string,
  params: URLSearchParams,
): Promise<void> {
  const types = await readCached(api, "types", () => api.types(), TYPES_FRESH_MS);
  const meta = types.find((t) => t.id === record);
  if (!meta) return;
  const asked = pageAskOf(meta, params);
  const counting = countAskOf(meta, params);
  await Promise.all([
    readCached(api, JSON.stringify(asked), () => api.list(asked)),
    readCached(api, JSON.stringify(counting), () => api.list(counting)),
  ]);
}

/** Filter's counts: one row's page with the facets of this address, read when a choice opens. */
export const facetsOf = (api: RecordsApi, ask: ListAsk) => () => {
  const { cursor: _, offset: __, ...rest } = ask;
  return api.list({ ...rest, facets: true, limit: 1 }).then((p) => p.facets);
};
