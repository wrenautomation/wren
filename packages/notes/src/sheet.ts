/**
 * A board as a sheet (designs/2026-10-14-boards.md, Sheets): CSV out, CSV or a pasted table in.
 * Pure, so the browser and the tests share it.
 */

/** What a column of a sheet can be for a card. */
export const SHEET_FIELDS = ["title", "column", "owner", "due", "blocked by", "link"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** Rows of cells from CSV or tab-separated text (a table pasted from Sheets is tabs). */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // A blank line is no card.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** A cell that a spreadsheet would run as a formula is kept as text with a leading apostrophe. */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const unsafe = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

/** Cells back from what `toCsv` wrote. */
export const cellOf = (v: string | undefined) => unsafe((v ?? "").trim());

/** CSV text, quoted where a cell holds a comma, a quote or a line break. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${rows.map((r) => r.map((c) => q(safe(c))).join(",")).join("\r\n")}\r\n`;
}

const HEADS: Record<SheetField, readonly string[]> = {
  title: ["title", "name", "task", "card", "summary", "item"],
  column: ["column", "status", "state", "stage", "list"],
  owner: ["owner", "assignee", "assigned to", "assigned", "who"],
  due: ["due", "due date", "deadline", "date"],
  "blocked by": ["blocked by", "blocked", "depends on", "dependencies", "waiting on"],
  link: ["link", "url", "card", "id"],
};

/** Which field each header most likely is; a field is taken by one header, the first. */
export function guessMap(headers: readonly string[]): (SheetField | null)[] {
  const taken = new Set<SheetField>();
  return headers.map((h) => {
    const n = h.trim().toLowerCase();
    const f = SHEET_FIELDS.find((k) => !taken.has(k) && HEADS[k].includes(n));
    if (f) taken.add(f);
    return f ?? null;
  });
}

/** One imported row, by field. Empty cells are left out. */
export type SheetRow = Partial<Record<SheetField, string>>;

/** Rows by field, from the table and the map; `header` says the first row names the columns. */
export function mapRows(
  table: readonly (readonly string[])[],
  map: readonly (SheetField | null)[],
  header = true,
): SheetRow[] {
  return table.slice(header ? 1 : 0).map((r) => {
    const out: SheetRow = {};
    map.forEach((f, i) => {
      const v = cellOf(r[i]);
      if (f && v && out[f] === undefined) out[f] = v;
    });
    return out;
  });
}

const CARD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The card id in a link (`…/notes/doc/<id>`) or a bare id; null when there is none. */
export const cardIdIn = (link: string | undefined): string | null =>
  link ? (CARD_ID.exec(link)?.[0]?.toLowerCase() ?? null) : null;

/** A pasted link to a file in a drive: its kind and what to call it before its title is known. */
export type FileLink = {
  kind: "doc" | "sheet" | "slides" | "drive" | "dropbox" | "onedrive";
  label: string;
};

export function fileLinkOf(href: string): FileLink | null {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host === "docs.google.com") {
    if (u.pathname.startsWith("/document/")) return { kind: "doc", label: "Google Doc" };
    if (u.pathname.startsWith("/spreadsheets/")) return { kind: "sheet", label: "Google Sheet" };
    if (u.pathname.startsWith("/presentation/")) return { kind: "slides", label: "Google Slides" };
    return null;
  }
  if (host === "drive.google.com") return { kind: "drive", label: "Drive file" };
  if (host === "dropbox.com" || host.endsWith(".dropbox.com"))
    return { kind: "dropbox", label: "Dropbox file" };
  if (host === "1drv.ms" || host === "onedrive.live.com" || host.endsWith(".sharepoint.com"))
    return { kind: "onedrive", label: "OneDrive file" };
  return null;
}
