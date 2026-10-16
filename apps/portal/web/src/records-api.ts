/**
 * The record calls a page reads through (`RecordsApi`), made once per name and named, so their
 * answers sit in the data layer's local copy (designs/2026-10-15-one-write-path.md): a list or
 * side panel opened again, after a reload or a tab away, paints at once and reads behind it.
 * The one place a records api is built; `scripts/reads-guard.mjs` fails a literal elsewhere.
 */
import { nameScope, type RecordsApi } from "@wren/ui";

/** One records handler asked of the server: `recordsList` with its body. */
export type Ask = <T>(handler: string, body: Record<string, unknown>) => Promise<T>;

const APIS = new Map<string, RecordsApi>();

/**
 * The records api named `name` (product, client and scope: `console:acme:calendar:false`): the
 * five reads through `ask`, plus whatever `more` adds (edits, keep, access).
 */
export function recordsApi(
  name: string,
  ask: Ask,
  more: (ask: Ask) => Partial<RecordsApi> = () => ({}),
): RecordsApi {
  const had = APIS.get(name);
  if (had) return had;
  const api: RecordsApi = {
    types: () => ask("recordsTypes", {}),
    list: (a) => ask("recordsList", { ...a }),
    get: (a) => ask("recordsGet", { ...a }),
    export: (a) => ask("recordsExport", { ...a }),
    stats: (a) => ask("recordsStats", { ...a }),
    ...more(ask),
  };
  APIS.set(name, nameScope(api, `records:${name}`));
  return api;
}
