/**
 * ⌘K's record search (designs/2026-10-14-customerio-audit.md, B3): an app's `find` over the
 * record type one of its list pages shows. Its rows matching the words, a few at most, each
 * opening as its own page. The console serves Wren's records, a product its client's.
 */
import type { RecordMeta } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import type { TemplateListRow } from "@wren/core/templates/console";
import { folderLabel, nameLabel } from "@wren/core/templates/labels";
import { call } from "./api.js";
import { type Found, WREN } from "./module.js";

/** How many rows one app offers per search. */
const FEW = 5;

const TYPES = new Map<string, Promise<RecordMeta[]>>();
/** A product's record types, asked once per workspace. */
const typesOf = (product: string, body: Record<string, unknown>) => {
  const key = `${product}:${JSON.stringify(body)}`;
  let got = TYPES.get(key);
  if (!got) {
    got = call<RecordMeta[]>(`${product}/recordsTypes`, body);
    // A failed read asks again next time.
    got.catch(() => TYPES.delete(key));
    TYPES.set(key, got);
  }
  return got;
};

const textOf = (cell: unknown): string =>
  cell == null
    ? ""
    : typeof cell === "object"
      ? String(
          (cell as { label?: unknown; name?: unknown }).label ??
            (cell as { name?: unknown }).name ??
            "",
        )
      : String(cell);

/**
 * A `find` over `record`, as `/<path>` lists it: `kind` names what each one is ("Company"), said
 * faint beside it with its subtitle.
 */
export function findRecords(o: { record: string; path: string; kind: string }) {
  return async (q: string, client: string): Promise<Found[]> => {
    const wren = client === WREN.id;
    const product = wren ? "console" : (o.record.split(".")[0] ?? "");
    const app = o.path.split("/")[1] ?? "";
    const scope = wren ? {} : { client, app, asClient: false };
    const types = await typesOf(product, scope);
    const meta = types.find((t) => t.id === o.record);
    if (!meta) return [];
    const { rows } = await call<{ rows: Row[] }>(`${product}/recordsList`, {
      ...scope,
      record: o.record,
      q,
      limit: FEW,
    });
    return rows.slice(0, FEW).map((r) => {
      // A short subtitle only (a stage, a domain): a sentence would crowd out the name.
      const sub = meta.subtitle ? textOf(r[meta.subtitle]) : "";
      const short = sub.length <= 32 ? sub : "";
      return {
        label: textOf(r[meta.title]) || String(r.id),
        href: `${o.path}/${encodeURIComponent(String(r.id))}`,
        hint: short ? `${o.kind} · ${short}` : o.kind,
      };
    });
  };
}

/** One app's finds over several of its lists, in that order. */
export const findAll =
  (...finds: ((q: string, client: string) => Promise<Found[]>)[]) =>
  async (q: string, client: string): Promise<Found[]> =>
    (await Promise.all(finds.map((f) => f(q, client).catch(() => [] as Found[])))).flat();

/** Library's templates and prompts by name or words: one list, read once a search. */
export async function findTemplates(q: string, client: string): Promise<Found[]> {
  if (client !== WREN.id) return [];
  const { templates } = await call<{ templates: TemplateListRow[] }>("templates/list");
  const needle = q.toLowerCase();
  return templates
    .filter((r) => `${nameLabel(r.name)}\n${r.ref}\n${r.words}`.toLowerCase().includes(needle))
    .slice(0, FEW)
    .map((r) => ({
      label: nameLabel(r.name),
      href: `/library/templates?open=${encodeURIComponent(String(r.id))}`,
      hint: `Template · ${folderLabel(r.folder)}`,
    }));
}
