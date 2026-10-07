/**
 * What a record page's header shows, so the Details below say each field once: the subtitle
 * under the title, every state on the meta line, and up to four short key facts.
 */
import { type Cell, type FieldMeta, type RecordMeta, SYSTEM } from "@wren/core/records";

/** Longer text wraps in the Details; a key fact is a short line in a quarter of the page. */
export const KEY_CHARS = 28;
/** An address (email, URL, domain) is one word: it may run longer, and breaks to stay whole. */
export const ADDRESS_CHARS = 64;
/** The subtitle shows two lines at most; longer, the Details keep it whole too. */
export const SUB_CHARS = 120;

type Row = Record<string, Cell>;

const filled = (row: Row, f: FieldMeta) => row[f.key] != null && row[f.key] !== "";
const short = (cell: Cell | undefined, n: number) => typeof cell !== "string" || cell.length <= n;
/** One unbroken word with an @, a dot or a slash: "dana@northwind.example", "https://x.example/a". */
export const isAddress = (cell: Cell | undefined): boolean =>
  typeof cell === "string" && /^\S+$/.test(cell) && /[@./]/.test(cell);
/** Tags read as their labels ("Sends messages, Spends money"), not their ids. */
const shown = (f: FieldMeta, cell: Cell | undefined): Cell | undefined =>
  f.kind === "tags" && typeof cell === "string"
    ? cell
        .split(",")
        .map((v) => f.states?.[v]?.label ?? v)
        .join(", ")
    : cell;

export interface RecordHead {
  /** The subtitle field, when the header shows it (clamped to two lines). */
  sub: FieldMeta | null;
  /** Fields on the meta line. */
  states: FieldMeta[];
  /** Key facts under it. */
  keys: FieldMeta[];
  /** Every field the header shows: the Details leave these out. */
  shown: Set<string>;
}

/** `long` marks fields with their own place below (prose, the draft box). */
export function recordHead(
  meta: Pick<RecordMeta, "fields" | "title" | "subtitle">,
  row: Row,
  long: (f: FieldMeta) => boolean,
): RecordHead {
  const states = meta.fields.filter((f) => f.kind === "status" && row[f.key] != null);
  const subField = meta.fields.find((f) => f.key === meta.subtitle);
  const sub = subField && !long(subField) && filled(row, subField) ? subField : null;
  const keys = meta.fields
    .filter(
      (f) =>
        f.column &&
        f.key !== meta.title &&
        f.key !== meta.subtitle &&
        f.kind !== "status" &&
        !long(f) &&
        f.group !== SYSTEM &&
        row[f.key] != null &&
        short(shown(f, row[f.key]), isAddress(row[f.key]) ? ADDRESS_CHARS : KEY_CHARS),
    )
    .slice(0, 4);
  const whole = sub && short(row[sub.key], SUB_CHARS) ? [sub] : [];
  return { sub, states, keys, shown: new Set([...states, ...keys, ...whole].map((f) => f.key)) };
}
