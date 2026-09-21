/**
 * What drafting costs, from the envelope every draft row keeps
 * (`llm.call.usage`): calls and tokens by platform and model over a window.
 * Failed proposals (unfit, unparsable) never became rows, so this is the
 * spend that produced text; the run ledger has the rest.
 */
import type { Queryable } from "@wren/db";
import { and, gte, isNotNull, sql } from "drizzle-orm";
import { contentDrafts } from "./schema.js";

export interface CostRow {
  platform: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (path: string) =>
  sql<number>`coalesce(sum((${contentDrafts.llm}#>>'{call,usage,${sql.raw(path)}}')::int), 0)::int`;

export async function draftCosts(db: Queryable, now: Date, days = 30): Promise<CostRow[]> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const model = sql<string>`coalesce(${contentDrafts.llm}#>>'{call,model}', '?')`;
  const rows = await db
    .select({
      platform: contentDrafts.platform,
      model,
      calls: sql<number>`count(*)::int`,
      inputTokens: num("input"),
      outputTokens: num("output"),
    })
    .from(contentDrafts)
    .where(and(gte(contentDrafts.createdAt, since), isNotNull(contentDrafts.llm)))
    .groupBy(contentDrafts.platform, model)
    .orderBy(contentDrafts.platform, model);
  return rows;
}

export function formatCosts(rows: readonly CostRow[]): string[] {
  if (rows.length === 0) return ["no drafts in the window"];
  const total = rows.reduce(
    (t, r) => ({ calls: t.calls + r.calls, i: t.i + r.inputTokens, o: t.o + r.outputTokens }),
    { calls: 0, i: 0, o: 0 },
  );
  return [
    ...rows.map(
      (r) =>
        `${r.platform.padEnd(10)} ${r.model.padEnd(28)} ${String(r.calls).padStart(4)} calls  ${String(r.inputTokens).padStart(8)} in  ${String(r.outputTokens).padStart(7)} out`,
    ),
    `${"total".padEnd(39)} ${String(total.calls).padStart(4)} calls  ${String(total.i).padStart(8)} in  ${String(total.o).padStart(7)} out`,
  ];
}
