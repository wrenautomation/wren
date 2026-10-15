/**
 * People > Import (designs/2026-10-14-customerio-audit.md, B4): a client loads a CSV of its
 * contacts. Pick a file, check the columns it guessed, read the first ten rows, load. The server
 * runs the same import as `wren crm import`, so a row is checked, merged and skipped the same way;
 * the result is a row in the list below. The head asks `importPreview` again on each change; only
 * the button writes (`importRun`). Loading people sends nothing.
 */
import { ACTIONS, Button, Tag } from "@wren/ui";
import { useRef, useState } from "react";
import { ApiError, call, type ImportPreview, type ImportResult } from "../../api.js";
import type { ListPage } from "../../module.js";
import { ERROR, QUIET, SELECT } from "../work/bits.js";
import {
  base64Of,
  LIMITS,
  MAIN_FIELDS,
  plural,
  previewLines,
  resultLine,
  tooBig,
  whyLine,
  willLoad,
} from "./import-form.js";

interface Picked {
  name: string;
  /** The file, base64. */
  file: string;
}

const said = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
/**
 * A table cell; on a phone each row is a stack, a cell a line led by its column's name, so the
 * Result never sits past the edge. An empty cell leaves its line out.
 */
const CELL =
  "py-1.5 pr-3 align-top max-sm:block max-sm:py-0.5 max-sm:pr-0 max-sm:empty:hidden max-sm:before:mr-2 max-sm:before:text-(--ui-ink-3) max-sm:before:content-[attr(data-label)]";

/** The field's column, chosen from the file's own. "" is unused. */
function ColumnPick({
  label,
  value,
  headers,
  onChange,
}: {
  label: string;
  value: string;
  headers: string[];
  onChange: (header: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2)">
      {label}
      <select
        className={`${SELECT} min-w-0 max-w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Not used</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

function Sample({ p }: { p: ImportPreview }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px] sm:min-w-[520px] max-sm:block">
        <thead className={`${QUIET} max-sm:sr-only`}>
          <tr className="border-b border-(--ui-hair)">
            {["Row", "Name", "Company", "Email", "Job title", "Result"].map((h) => (
              <th key={h} className="py-1.5 pr-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {p.sample.map((r) => (
            <tr key={r.row} className="border-b border-(--ui-hair) max-sm:block max-sm:py-2">
              <td data-label="Row" className={`${CELL} tabular-nums ${QUIET}`}>
                {r.row}
              </td>
              <td data-label="Name" className={CELL}>
                {r.name ?? ""}
              </td>
              <td data-label="Company" className={CELL}>
                {r.company ?? ""}
              </td>
              <td data-label="Email" className={`${CELL} break-all`}>
                {r.email ?? ""}
              </td>
              <td data-label="Job title" className={CELL}>
                {r.title ?? ""}
              </td>
              <td data-label="Result" className={`${CELL} ${r.skip ? "text-(--ui-bad)" : QUIET}`}>
                {r.skip ? `Left out: ${r.skip}` : (r.note ?? "Loads")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportPanel({ client, reload }: { client: string; reload: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  // A late answer to an older ask never overwrites a newer one.
  const asked = useRef(0);
  /** An import running: one at a time, and nothing asked meanwhile hides what it did. */
  const importing = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [format, setFormat] = useState("crm-generic");
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    asked.current += 1;
    setPicked(null);
    setPreview(null);
    setResult(null);
    setColumns({});
    setFormat("crm-generic");
    setBusy(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  /** Read the file with this format and these columns (none: the guess). */
  const look = async (p: Picked, fmt: string, cols: Record<string, string> | null) => {
    if (importing.current) return;
    const mine = ++asked.current;
    setBusy("preview");
    setError(null);
    try {
      const got = await call<ImportPreview>("reactivation/importPreview", {
        client,
        file: p.file,
        name: p.name,
        format: fmt,
        ...(cols ? { columns: cols } : {}),
      });
      if (mine !== asked.current) return;
      setPreview(got);
      setColumns(got.columns as Record<string, string>);
    } catch (err) {
      if (mine === asked.current) setError(said(err));
    } finally {
      if (mine === asked.current) setBusy(null);
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    setPreview(null);
    const big = tooBig(f.size);
    if (big) {
      setPicked({ name: f.name, file: "" });
      setError(big);
      return;
    }
    let file: string;
    try {
      file = base64Of(new Uint8Array(await f.arrayBuffer()));
    } catch {
      setPicked({ name: f.name, file: "" });
      setError("That file didn't open. Try again.");
      return;
    }
    // The same file chosen again still counts as a change.
    if (input.current) input.current.value = "";
    const p = { name: f.name, file };
    setPicked(p);
    setFormat("crm-generic");
    await look(p, "crm-generic", null);
  };

  const load = async () => {
    if (!picked || !preview || busy || importing.current) return;
    importing.current = true;
    const mine = ++asked.current;
    setBusy("import");
    setError(null);
    try {
      // The same file and columns again is the same import: a retry never loads them twice.
      const body = { client, file: picked.file, name: picked.name, format, columns };
      const got = await ACTIONS.run(
        `import:${client}:${picked.name}:${picked.file.length}:${format}:${JSON.stringify(columns)}`,
        (requestId) => call<ImportResult>("reactivation/importRun", { ...body, requestId }),
      );
      // What it did always shows, unless he started over meanwhile.
      if (mine === asked.current) {
        setResult(got);
        setPreview(null);
      }
      reload();
    } catch (err) {
      if (mine === asked.current) setError(said(err));
    } finally {
      importing.current = false;
      if (mine === asked.current) setBusy(null);
    }
  };

  const change = (field: string, header: string) => {
    if (!picked?.file) return;
    const next = { ...columns };
    if (header) next[field] = header;
    else delete next[field];
    setColumns(next);
    void look(picked, format, next);
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept=".csv,text/csv"
      className="sr-only"
      tabIndex={-1}
      aria-label="CSV file"
      onChange={(e) => void pick(e.target.files?.[0])}
    />
  );

  if (result)
    return (
      <div
        className="flex w-full min-w-0 basis-full flex-col gap-2 border border-(--ui-hair) p-3"
        role="status"
      >
        {fileInput}
        <p className="m-0 font-medium">Loaded {picked?.name ?? "the file"}.</p>
        <p className="m-0 text-[14px]">{resultLine(result)}</p>
        {result.why.length ? (
          <ul className={`m-0 list-none p-0 text-[13px] ${QUIET}`}>
            {result.why.map((w) => (
              <li key={w.reason}>{whyLine(w)}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="dense" onClick={reset}>
            Done
          </Button>
          <Button
            size="dense"
            tone="quiet"
            onClick={() => {
              reset();
              input.current?.click();
            }}
          >
            Load another
          </Button>
        </div>
      </div>
    );

  if (!picked)
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {fileInput}
        <Button tone="primary" size="dense" onClick={() => input.current?.click()}>
          Import a CSV
        </Button>
        <span className="text-[13px] text-(--ui-ink-3)">
          Up to {plural(LIMITS.rows, "person", "people")} a file.
        </span>
      </div>
    );

  const p = preview;
  const main = p?.fields.filter((f) => MAIN_FIELDS.includes(f.id)) ?? [];
  const more = p?.fields.filter((f) => !MAIN_FIELDS.includes(f.id)) ?? [];
  const canLoad = !!p && p.missing.length === 0 && willLoad(p) > 0 && !busy;

  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-4 border border-(--ui-hair) p-3">
      {fileInput}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-medium">{picked.name}</span>
        {busy === "preview" ? <Tag tone="neutral">Reading</Tag> : null}
        <Button size="dense" tone="quiet" onClick={() => input.current?.click()}>
          Choose another
        </Button>
        <Button size="dense" tone="quiet" onClick={reset}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
      {p ? (
        <>
          <label className="flex max-w-xs flex-col gap-1 text-[13px] text-(--ui-ink-2)">
            Where it came from
            <select
              className={SELECT}
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                void look(picked, e.target.value, null);
              }}
            >
              {p.formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] font-medium">Columns</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {main.map((f) => (
                <ColumnPick
                  key={f.id}
                  label={f.label}
                  value={columns[f.id] ?? ""}
                  headers={p.headers}
                  onChange={(h) => change(f.id, h)}
                />
              ))}
            </div>
            <details className="mt-3" open={more.some((f) => columns[f.id])}>
              <summary className={`cursor-pointer text-[13px] ${QUIET}`}>More columns</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {more.map((f) => (
                  <ColumnPick
                    key={f.id}
                    label={f.label}
                    value={columns[f.id] ?? ""}
                    headers={p.headers}
                    onChange={(h) => change(f.id, h)}
                  />
                ))}
              </div>
            </details>
          </fieldset>
          {p.missing.length ? (
            <p className={`m-0 ${ERROR}`} role="alert">
              The columns still need {p.missing.join(" and ")}.
            </p>
          ) : (
            <div className="grid gap-3">
              <Sample p={p} />
              <div className="grid gap-1 text-[14px]">
                {previewLines(p).map((l) => (
                  <p key={l} className="m-0">
                    {l}
                  </p>
                ))}
                {p.why.length ? (
                  <ul className={`m-0 list-none p-0 text-[13px] ${QUIET}`}>
                    {p.why.map((w) => (
                      <li key={w.reason}>Left out: {whyLine(w)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="primary"
              size="dense"
              busy={busy === "import"}
              disabled={!canLoad}
              onClick={load}
            >
              {p.missing.length
                ? "Import"
                : `Import ${plural(Math.max(willLoad(p), 0), "person", "people")}`}
            </Button>
            <span className="text-[13px] text-(--ui-ink-3)">Nobody is emailed.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** People > Import: the files loaded, newest first, with the panel in its head. */
export const importPage: ListPage = {
  id: "import",
  label: "Import",
  about: "Load a CSV of your contacts, and see what each file added.",
  requires: { audience: "client", needs: "manage", at: { app: "people" } },
  template: "list",
  record: "reactivation.import",
  columns: ["file", "source", "at", "rows", "created", "merged", "skipped", "why"],
  empty: {
    all: "Files you load show here with what they added.",
    skipped: "Every file loaded in full so far.",
  },
  head: (_meta, reload, at) =>
    at.demo ? null : <ImportPanel client={at.client} reload={reload} />,
};
