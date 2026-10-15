/**
 * Write-through for records: a save that landed patches the row in every answer the workspace
 * holds (its detail, each list it sits in), so the page shows it without reading it again.
 */
import { type Patch, writeThrough } from "./save/cache.js";

interface Shaped {
  record?: unknown;
  row?: unknown;
  rows?: unknown;
  edit?: { values?: Record<string, unknown>; version?: string; history?: unknown[] } | null;
}

type Row = Record<string, unknown>;
const isRow = (r: unknown, id: string): r is Row =>
  !!r && typeof r === "object" && String((r as Row).id) === id;

/** What an edit's answer moves besides the row: its version, and its line atop History. */
export interface EditMoved {
  version?: string | null | undefined;
  change?: unknown;
}

/** The patch: `fields` over row `id` of `record`; `edit` moves its edit state. */
export function recordPatch(
  record: string,
  id: string | number,
  fields: Record<string, unknown>,
  edit: EditMoved = {},
): Patch {
  const want = String(id);
  return (_key, data) => {
    const d = data as Shaped | null;
    if (!d || typeof d !== "object" || d.record !== record) return data;
    if (isRow(d.row, want)) {
      const moved = d.edit
        ? {
            ...d.edit,
            values: { ...d.edit.values, ...pick(fields, d.edit.values) },
            ...(edit.version ? { version: edit.version } : {}),
            ...(edit.change ? { history: [edit.change, ...(d.edit.history ?? [])] } : {}),
          }
        : d.edit;
      return { ...d, row: { ...d.row, ...fields }, ...(d.edit ? { edit: moved } : {}) };
    }
    if (Array.isArray(d.rows) && d.rows.some((r) => isRow(r, want)))
      return { ...d, rows: d.rows.map((r) => (isRow(r, want) ? { ...r, ...fields } : r)) };
    return data;
  };
}

/** Only the keys the edit state carries. */
function pick(fields: Record<string, unknown>, values: Record<string, unknown> | undefined) {
  if (!values) return {};
  return Object.fromEntries(Object.entries(fields).filter(([k]) => k in values));
}

/** Patch row `id` of `record` in every answer under `api` (the workspace's records api). */
export function patchRecord(
  api: object,
  record: string,
  id: string | number,
  fields: Record<string, unknown>,
  edit?: EditMoved,
) {
  writeThrough(api, recordPatch(record, id, fields, edit));
}
