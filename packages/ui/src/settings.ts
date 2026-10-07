/**
 * A part's settings in words, never JSON: each leaf a labelled row, labels from its form's
 * fields (`a.b` paths, as `formOf` makes them), booleans On or Off, nothing set "Not set", a
 * list as its items. A key the form doesn't name reads as words ("senderName" → "Sender name").
 */

/** A form field's path and label: all a row needs. */
export interface SettingField {
  field: string;
  label: string;
}

/** One row: a label and a line of text, or a list's items. */
export type SettingRow = [label: string, value: string | string[]];

export const NOT_SET = "Not set";

/** "openersPerDay" → "Openers per day". */
export function words(name: string): string {
  const w = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const empty = (v: unknown) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (plain(v) && Object.keys(v).length === 0);

/** One value in words: an object inside a list reads "Name x, Wait 2". */
export function settingText(v: unknown): string {
  if (empty(v)) return NOT_SET;
  if (v === true) return "On";
  if (v === false) return "Off";
  if (Array.isArray(v)) return v.map(settingText).join(", ");
  if (plain(v))
    return Object.entries(v)
      .map(([k, x]) => `${words(k)} ${settingText(x)}`)
      .join(", ");
  return String(v);
}

/** Every leaf of `values` as a row, in the order they're stored; an object's leaves under it. */
export function settingRows(
  values: Readonly<Record<string, unknown>> | null | undefined,
  fields?: readonly SettingField[] | null,
): SettingRow[] {
  const labels = new Map((fields ?? []).map((f) => [f.field, f.label]));
  const rows: SettingRow[] = [];
  const walk = (obj: Record<string, unknown>, path: string, label: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const field = path ? `${path}.${k}` : k;
      const own = words(k);
      // A nested row reads "Stages: research", as the form's box does.
      const at = labels.get(field) ?? (label ? `${label}: ${own.toLowerCase()}` : own);
      if (plain(v) && Object.keys(v).length) walk(v, field, at);
      else if (Array.isArray(v) && v.length) rows.push([at, v.map(settingText)]);
      else rows.push([at, settingText(v)]);
    }
  };
  walk({ ...(values ?? {}) }, "", "");
  return rows;
}
