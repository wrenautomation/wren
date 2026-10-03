/**
 * ConsolePortal: Wren's team reads a view by name, as JSON or CSV. A portal card, a CSV export
 * and an agent read the same answer. Each package says which of its views it allows; the worker
 * passes the lists in, so core never names a product's view.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";
import { answer, PortalRefusal, type PortalRequest, seesInternal } from "./portal.js";

export interface ViewRequest extends PortalRequest {
  view: string;
  format?: "json" | "csv";
}
export type Cell = string | number | boolean | null;
export interface ViewTable {
  view: string;
  columns: string[];
  rows: Cell[][];
}
export type ViewAnswer = ViewTable | { view: string; csv: string };

// ponytail: a hard cap, no paging. Allowed views are aggregates; page when one isn't.
const MAX_ROWS = 5000;
/** Postgres int8 and numeric arrive as strings; counts and rates read as numbers. */
const NUMERIC_TYPES = new Set([20, 1700]);

const cellOf = (v: unknown, numeric: boolean): Cell => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (numeric) return Number(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
};

const csvCell = (v: Cell) => {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const toCsv = ({ columns, rows }: Pick<ViewTable, "columns" | "rows">): string =>
  [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

type Rows = Record<string, unknown>[] & { columns?: { name: string; type: number }[] };

export function consoleApi({ main, views }: { main: Db; views: readonly string[] }) {
  const allowed = new Set(views);
  return {
    async view(req: ViewRequest): Promise<ViewAnswer> {
      if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
      if (typeof req.view !== "string" || !allowed.has(req.view))
        throw new PortalRefusal("no such view", 404);
      const res = (await main.execute(
        sql`SELECT * FROM ${sql.identifier(req.view)} LIMIT ${MAX_ROWS}`,
      )) as unknown as Rows;
      const cols = res.columns ?? Object.keys(res[0] ?? {}).map((name) => ({ name, type: 0 }));
      const columns = cols.map((c) => c.name);
      const rows = res.map((r) => cols.map((c) => cellOf(r[c.name], NUMERIC_TYPES.has(c.type))));
      const table = { view: req.view, columns, rows };
      return req.format === "csv" ? { view: req.view, csv: toCsv(table) } : table;
    },
  };
}

export function makeConsolePortal(deps: { main: Db; views: readonly string[] }) {
  const api = consoleApi(deps);
  return restate.service({
    name: "ConsolePortal",
    handlers: {
      view: (_: restate.Context, req: ViewRequest) => answer(() => api.view(req)),
    },
  });
}
