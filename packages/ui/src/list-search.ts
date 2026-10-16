/**
 * A record list's address, typed (designs/2026-10-16-portal-libs.md, "Router"). The keys every
 * list reads have a schema, so a bad value (`pg=abc`, `as=grid`) drops instead of breaking the
 * page. The portal's router checks every page's search with `LIST_SEARCH`. A record's own keys
 * ride beside these: one filter per field (`status=open`, the account's field too) and the open
 * record under its type's name (`person=12`); `listStateOf` reads those through the type.
 */
import type { RecordMeta } from "@wren/core/records";
import { z } from "zod";

const word = z.string().trim().min(1);
/** A field key, "-" first for descending. */
const sortKey = z.string().regex(/^-?[\w.]+$/);
const key = z.string().regex(/^[\w.]+$/);
const count = z.coerce.number().int().positive();

/** What `as` may say: rows, cards, or a timeline page's axis. */
export const LIST_FORMS = ["rows", "cards", "timeline"] as const;

/**
 * The keys every list reads. A value that doesn't fit drops; unknown keys pass through as they
 * are (filters, the open record, a hand-drawn page's own).
 */
export const LIST_SEARCH = z.looseObject({
  /** The view tab: a built-in view's id. */
  view: word.optional().catch(undefined),
  /** A saved view's id. */
  sv: count.optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  sort: sortKey.optional().catch(undefined),
  group: key.optional().catch(undefined),
  /** Columns shown, in order; "none" for only the title. */
  cols: z
    .string()
    .regex(/^[\w.,]+$/)
    .optional()
    .catch(undefined),
  as: z.enum(LIST_FORMS).optional().catch(undefined),
  /** The page, from 1. */
  pg: count.optional().catch(undefined),
  /** The open record's tab. */
  tab: word.optional().catch(undefined),
});
export type ListSearch = z.infer<typeof LIST_SEARCH>;

/** A search object as the address's params: arrays repeat their key, empty values drop. */
export function paramsOf(search: Readonly<Record<string, unknown>>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const one of v) out.append(k, String(one));
    else out.set(k, String(v));
  }
  return out;
}

/** The address's params as a flat search object; a repeated key keeps every value. */
export function searchOf(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of params) {
    const had = out[k];
    out[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v];
  }
  return out;
}

/** One list's whole state, typed: the shared keys, then the record's own. */
export interface ListState extends ListSearch {
  /** The open record's id (`<one>=<id>`). */
  open?: string | undefined;
  /** The account filter, when the record declares an account. */
  account?: string | undefined;
  /** Every field filter, by key, as the address says it. */
  filters: Record<string, string>;
}

/** Read a list's address through its record type. */
export function listStateOf(
  meta: Pick<RecordMeta, "fields" | "name" | "account">,
  params: URLSearchParams,
): ListState {
  const shared = LIST_SEARCH.parse(Object.fromEntries(params));
  const filters: Record<string, string> = {};
  for (const f of meta.fields) {
    const v = params.get(f.key);
    if (v) filters[f.key] = v;
  }
  const open = params.get(meta.name.one) ?? undefined;
  const account = meta.account ? (params.get(meta.account) ?? undefined) : undefined;
  return {
    view: shared.view,
    sv: shared.sv,
    q: shared.q,
    sort: shared.sort,
    group: shared.group,
    cols: shared.cols,
    as: shared.as,
    pg: shared.pg,
    tab: shared.tab,
    open,
    account,
    filters,
  };
}

/** A change to a list's state as an address change: `open` and `account` under their keys. */
export function listChange(
  meta: Pick<RecordMeta, "name" | "account">,
  change: Partial<Omit<ListState, "filters">> & { filters?: Record<string, string | null> },
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(change)) {
    if (k === "filters") continue;
    const at = k === "open" ? meta.name.one : k === "account" ? meta.account : k;
    if (!at) continue;
    out[at] = v === undefined || v === null || v === "" ? null : String(v);
  }
  for (const [k, v] of Object.entries(change.filters ?? {})) out[k] = v || null;
  return out;
}
