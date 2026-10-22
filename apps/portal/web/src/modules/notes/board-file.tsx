/**
 * A board as a sheet (designs/2026-10-14-boards.md, Sheets): Export CSV, and Import from a CSV
 * file or a table pasted from Sheets. The person maps the columns once; each row is a card, and
 * a row whose link is a card on this board updates that card.
 */

import {
  guessMap,
  mapRows,
  parseTable,
  SHEET_FIELDS,
  type SheetField,
  toCsv,
} from "@wren/notes/sheet";
import { Button, say, useEdit } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useMemo, useState } from "react";
import { docPath, notes } from "./api.js";
import { SELECT } from "./card.js";
import { download, fileName } from "./files.js";

/** The board's cards as a CSV download: title, column, owner, due, labels, blocked by, link. */
export async function exportBoard(client: string, id: string) {
  try {
    const out = await notes(client, "taskExport", { id });
    const rows = [
      [...SHEET_FIELDS] as string[],
      ...out.rows.map((r) => [
        r.title,
        r.column,
        r.owner,
        r.due,
        r.labels.join("; "),
        r.blockedBy.join("; "),
        `${location.origin}${docPath(r.id)}`,
      ]),
    ];
    download(`${fileName(out.board)}.csv`, "text/csv", toCsv(rows));
  } catch (err) {
    say.failed(err);
  }
}

const MAX_FILE = 2 * 1024 * 1024;

export function ImportDialog({
  client,
  board,
  open,
  onOpenChange,
  onDone,
}: {
  client: string;
  board: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  // The pasted table stays until it is imported, so closing the dialog by accident loses nothing.
  const paste = useEdit(`board-import:${board}:table`, "");
  const text = paste.value;
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<(SheetField | null)[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<{ row: number; why: string }[]>([]);
  const table = useMemo(() => parseTable(text), [text]);
  const width = Math.max(0, ...table.map((r) => r.length));
  const fields =
    map ??
    guessMap(table[0] ?? [])
      .concat(Array(width).fill(null))
      .slice(0, width);
  const rows = useMemo(() => mapRows(table, fields, header), [table, fields, header]);
  const usable = rows.filter((r) => r.title || r.link).length;

  const read = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) return say.failed(new Error("Files go up to 2 MB."));
    setMap(null);
    paste.set(await f.text());
  };
  const run = async () => {
    setBusy(true);
    try {
      const out = await notes(client, "taskImport", { id: board, rows });
      say.done(
        `Made ${out.made}, updated ${out.updated}${out.warnings.length ? `; ${out.warnings.length} to check` : ""}.`,
      );
      setWarnings(out.warnings);
      onDone();
      if (!out.warnings.length) {
        paste.saved(text);
        onOpenChange(false);
      }
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import cards</DialogTitle>
          <DialogDescription>
            Choose a CSV file, or paste a table from Sheets. Each row becomes a card. A row whose
            link is a card here updates it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
            aria-label="CSV file"
            className="text-[13px]"
            onChange={(e) => void read(e.target.files?.[0])}
          />
          <textarea
            {...paste.field}
            aria-label="Pasted table"
            placeholder="Or paste rows here, with the headings on top"
            rows={5}
            className="w-full border border-(--ui-hair) bg-(--ui-paper) p-2 text-[13px] text-(--ui-ink) focus-visible:border-(--ui-focus) focus:outline-none"
            onChange={(e) => {
              setMap(null);
              paste.set(e.target.value);
            }}
          />
          {table.length ? (
            <>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={header}
                  onChange={(e) => setHeader(e.target.checked)}
                />
                The first row names the columns
              </label>
              <div className="grid gap-1.5">
                {Array.from({ length: width }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a sheet's columns are their places.
                  <label key={i} className="flex items-center gap-2 text-[13px]">
                    <span className="w-40 min-w-0 wrap-anywhere whitespace-normal text-(--ui-ink-2)">
                      {header ? table[0]?.[i] || `Column ${i + 1}` : `Column ${i + 1}`}
                      <span className="ml-1 text-(--ui-ink-3)">{table[header ? 1 : 0]?.[i]}</span>
                    </span>
                    <select
                      aria-label={`Column ${i + 1} is`}
                      className={SELECT}
                      value={fields[i] ?? ""}
                      onChange={(e) =>
                        setMap(
                          fields.map((f, n) =>
                            n === i ? ((e.target.value || null) as SheetField | null) : f,
                          ),
                        )
                      }
                    >
                      <option value="">Skip</option>
                      {SHEET_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {f[0]?.toUpperCase()}
                          {f.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : null}
          {warnings.length ? (
            <ul className="m-0 list-disc pl-5 text-[13px] text-(--ui-ink-2)">
              {warnings.slice(0, 8).map((w) => (
                <li key={`${w.row}:${w.why}`}>
                  Row {w.row}: {w.why}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end">
            <Button
              tone="primary"
              size="dense"
              busy={busy}
              disabled={!usable}
              onClick={() => void run()}
            >
              {usable ? `Import ${usable} ${usable === 1 ? "row" : "rows"}` : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
