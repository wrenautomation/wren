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

/**
 * Another record that lists the same thing under its own id (a post draft is `draft:3` in To
 * approve): what a patch of `record` writes there, or null.
 */
export type Twin = (
  id: string,
  fields: Record<string, unknown>,
) => { record: string; id: string; fields: Record<string, unknown> } | null;
const TWINS = new Map<string, Twin[]>();

/** Patches of `record` patch its twin too, so a list elsewhere names the same words and version. */
export function twinRecord(record: string, twin: Twin) {
  const all = TWINS.get(record) ?? [];
  if (!all.includes(twin)) TWINS.set(record, [...all, twin]);
}

/** The patch: `fields` over row `id` of `record`, and over its twins; `edit` moves its edit state. */
export function recordPatch(
  record: string,
  id: string | number,
  fields: Record<string, unknown>,
  edit: EditMoved = {},
): Patch {
  const own = onePatch(record, id, fields, edit);
  const twins = (TWINS.get(record) ?? []).flatMap((t) => {
    const got = t(String(id), fields);
    return got && Object.keys(got.fields).length ? [onePatch(got.record, got.id, got.fields)] : [];
  });
  if (!twins.length) return own;
  return (key, data) => twins.reduce((d, p) => p(key, d), own(key, data));
}

function onePatch(
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

/**
 * One record's own read (`get`'s answer) through `fn`: an action's answer patches what the page
 * shows (a video's edit after a save) with no read again. `fn` answers the new detail and any
 * row fields, or null to leave it.
 */
export function detailPatch(
  record: string,
  id: string | number,
  fn: (detail: unknown) => { detail?: unknown; row?: Record<string, unknown> } | null,
): Patch {
  const want = String(id);
  return (_key, data) => {
    const d = data as (Shaped & { detail?: unknown }) | null;
    if (!d || typeof d !== "object" || d.record !== record || !isRow(d.row, want)) return data;
    const got = fn(d.detail);
    if (!got) return data;
    return {
      ...d,
      ...("detail" in got ? { detail: got.detail } : {}),
      ...(got.row ? { row: { ...d.row, ...got.row } } : {}),
    };
  };
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
