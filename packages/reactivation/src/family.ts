/**
 * A move to the same employer under another name is no move: "Disney" to "The Walt Disney
 * Company" (a spelling), or CBS to Paramount (its owner since a merger). The name rule
 * (`isFirm`) catches spellings; the model, asked once per pair, catches an owner, a unit or a
 * rename. Either way the person stayed: the finding becomes `still_there`, with the new name as
 * `company`, the old as `formerly` and how they relate as `relation`. A rename or a merger is no
 * reason to call by itself; a dated business event is, and that's research's to find.
 */
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, LlmError } from "@wren/llm";
import type { FindingDraft } from "@wren/research";
import { type Firm, isFirm } from "@wren/research/people";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { LATEST_CRM_ROW } from "./score.js";

export const RELATIONS = ["same", "parent", "unit", "renamed", "different"] as const;
export type Relation = (typeof RELATIONS)[number];

/** How `to` relates to `from`; "different" when unsure. */
export type Judge = (from: string, to: string) => Promise<Relation>;

const PROMPT_VERSION = "family-v1";

const prompt = (
  from: string,
  to: string,
) => `Someone worked at "${from}". Their profile now says "${to}".
Is "${to}" the same employer? Answer JSON only: {"relation": "<one word>"}, one of:
- same: the same company, spelled another way or by its full name.
- parent: "${to}" owns "${from}", or "${from}" merged into it.
- unit: "${to}" is a division, brand or subsidiary of "${from}".
- renamed: "${from}" changed its name to "${to}".
- different: another employer, or you are not sure.
Answer only from what you know for certain about well-known companies. A small or unknown company is "different".`;

/** The model, asked once per pair per run. A provider that's down answers "different": the move stands. */
export function familyJudge(llm: LlmClient, runId: string | null = null): Judge {
  const asked = new Map<string, Promise<Relation>>();
  return (from, to) => {
    const key = `${from.toLowerCase()}\u0000${to.toLowerCase()}`;
    let got = asked.get(key);
    if (!got) {
      got = completeAndParse(llm, prompt(from, to), z.object({ relation: z.enum(RELATIONS) }), {
        maxTokens: 30,
        runId,
        name: PROMPT_VERSION,
      })
        .then((o) => o.parsed?.relation ?? "different")
        .catch((err) => {
          if (err instanceof LlmError) return "different" as const;
          throw err;
        });
      asked.set(key, got);
    }
    return got;
  };
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** How the move's new employer relates to the firm, or null when it's a real move. */
async function stayedAs(
  value: Record<string, unknown>,
  firm: Firm,
  judge: Judge | null,
): Promise<Relation | null> {
  const to = text(value.to);
  if (!to) return null;
  if (isFirm(to, firm)) return "same";
  const from = text(value.from) ?? firm.name ?? firm.domain;
  if (!judge || !from) return null;
  const r = await judge(from, to);
  return r === "different" ? null : r;
}

/** A move's value as a stay's: the new name, the old one, and how they relate. */
const asStay = (value: Record<string, unknown>, relation: Relation) => ({
  company: value.to,
  title: value.title ?? null,
  dates: value.dates ?? null,
  companyUrl: value.companyUrl ?? null,
  formerly: value.from ?? null,
  relation,
});

/** A lookup's findings with every move to the same employer made a stay, before they're kept. */
export async function settleDrafts(
  drafts: readonly FindingDraft[],
  firm: Firm,
  judge: Judge | null,
): Promise<FindingDraft[]> {
  return Promise.all(
    drafts.map(async (d) => {
      if (d.kind !== "job_change") return d;
      const relation = await stayedAs(d.value, firm, judge);
      return relation
        ? {
            ...d,
            kind: "still_there" as const,
            factKey: d.factKey.replace(":job_change:", ":still_there:"),
            value: asStay(d.value, relation),
          }
        : d;
    }),
  );
}

/**
 * The same over moves already kept (`wren crm settle`): each one to the same employer becomes
 * a stay in place, so scores and briefs that cite it still find it. Returns how many it settled.
 */
export async function settleMoves(db: Queryable, judge: Judge | null): Promise<number> {
  const moves = await db.execute<{
    id: number;
    fact_key: string;
    value: Record<string, unknown>;
    firm_name: string | null;
    firm_domain: string | null;
  }>(sql`
    with latest as (${LATEST_CRM_ROW})
    select f.id, f.fact_key, f.value, co.name firm_name, co.domain firm_domain
    from findings f
    join latest l on l.person_id = f.person_id
    join companies co on co.id = l.company_id
    where f.kind = 'job_change' and nullif(btrim(f.value->>'to'), '') is not null
    order by f.id`);
  let settled = 0;
  for (const m of moves) {
    const relation = await stayedAs(m.value, { name: m.firm_name, domain: m.firm_domain }, judge);
    if (!relation) continue;
    // A stay already kept under the new key keeps it; this one takes its id along.
    const key = m.fact_key.replace(":job_change:", ":still_there:");
    await db.execute(sql`
      update findings set kind = 'still_there', signal_at = null, signal_dated = null,
        fact_key = case when exists (select 1 from findings where fact_key = ${key})
          then left(${key}, 380) || ':settled:' || id else ${key} end,
        value = ${JSON.stringify(asStay(m.value, relation))}::jsonb
      where id = ${m.id}`);
    settled += 1;
  }
  return settled;
}
