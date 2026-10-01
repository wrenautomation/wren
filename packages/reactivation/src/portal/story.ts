/**
 * The replay (P5): what was done on this list, rebuilt from the records every
 * stage keeps, in story order (verify, look up, check hiring, rank, brief,
 * draft), in the same words a live run writes. It shows only what the records
 * hold; a stage with nothing to show is left out, never filled in.
 */
import type { FeedEvent, FeedLine } from "@wren/core";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { briefLines } from "../brief.js";
import {
  briefLine,
  composeLine,
  type FoundFact,
  fullName,
  hiringLine,
  STAGE_DONE,
  STAGE_STARTS,
  whereLine,
} from "../feed.js";
import type { CrmStage } from "../status.js";
import { EMAIL_FROM, EMAIL_STATUS } from "./outbox.js";
import { iso, SUBJECTS } from "./views.js";

/** People on the score step: the first few to call. */
const TOP = 3;

interface Step {
  stage: CrmStage;
  lines: FeedEvent[];
  done: string;
  /** How many the stage handled, on its last line; null where the lines say it. */
  count: number | null;
  at: string | null;
}

const fact = (kind: unknown, value: unknown, via: unknown, url: unknown): FoundFact | null =>
  typeof kind === "string" && value && typeof value === "object"
    ? {
        kind,
        value: value as Record<string, unknown>,
        via: typeof via === "string" ? via : "",
        sourceUrl: typeof url === "string" ? url : null,
      }
    : null;

async function verifyStep(db: Queryable): Promise<Step | null> {
  const [r] = await db.execute<{ n: number; work: number; bounce: number; at: unknown }>(sql`
    with latest as (
      select distinct on (lower(cc.email)) v.result, v.checked_at
      from contact_candidates cc join verifications v on v.contact_candidate_id = cc.id
      where cc.evidence = 'crm'
      order by lower(cc.email), v.checked_at desc, v.id desc)
    select count(*)::int n,
      count(*) filter (where result = 'valid')::int work,
      count(*) filter (where result = 'invalid')::int bounce,
      max(checked_at) at
    from latest`);
  if (!r?.n) return null;
  return {
    stage: "verify",
    lines: [],
    done: STAGE_DONE.verify(r.n, r.work, r.bounce),
    count: r.n,
    at: iso(r.at),
  };
}

async function lookupStep(db: Queryable): Promise<Step | null> {
  const rows = await db.execute<{
    first_name: string | null;
    last_name: string | null;
    kind: string | null;
    value: unknown;
    via: string | null;
    source_url: string | null;
    at: unknown;
  }>(sql`
    with ${SUBJECTS}
    select p.first_name, p.last_name, w.kind, w.value, w.via, w.source_url,
      coalesce(l.looked_up_at, w.created_at) at
    from subjects s
    join people p on p.id = s.person_id
    left join person_lookups l on l.person_id = s.person_id
    left join findings w on w.id = s.where_id
    -- Looked up, or known some other way; a capped lookup hasn't happened yet.
    where w.id is not null or l.state <> 'capped'
    order by 7, s.person_id`);
  if (!rows.length) return null;
  const lines = rows.map((r) =>
    whereLine(fullName(r.first_name, r.last_name), fact(r.kind, r.value, r.via, r.source_url)),
  );
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  return {
    stage: "lookup",
    lines,
    done: STAGE_DONE.lookup(rows.length, count("job_change"), count("left")),
    count: rows.length,
    at: iso(rows.at(-1)?.at),
  };
}

async function signalsStep(db: Queryable): Promise<Step | null> {
  const rows = await db.execute<{
    firm: string;
    state: string;
    retry_at: unknown;
    kind: string | null;
    value: unknown;
    via: string | null;
    source_url: string | null;
    at: unknown;
  }>(sql`
    with ${SUBJECTS}, firms as (select distinct company_id from subjects)
    select coalesce(co.name, co.domain, 'A company') firm, k.state, k.retry_at,
      h.kind, h.value, h.via, h.source_url, k.checked_at at
    from firms f
    join companies co on co.id = f.company_id
    join company_checks k on k.company_id = f.company_id
    left join findings h on h.id = k.finding_id
    order by k.checked_at, f.company_id`);
  if (!rows.length) return null;
  const lines = rows.map((r) =>
    hiringLine(r.firm, {
      state: r.state as Parameters<typeof hiringLine>[1]["state"],
      finding: fact(r.kind, r.value, r.via, r.source_url),
      retryAt: r.retry_at ? new Date(String(r.retry_at)) : null,
    }),
  );
  const checked = rows.filter((r) => r.state !== "capped");
  return {
    stage: "signals",
    lines,
    done: STAGE_DONE.signals(checked.length, rows.filter((r) => r.state === "hiring").length),
    count: checked.length,
    at: iso(rows.at(-1)?.at),
  };
}

async function scoreStep(db: Queryable): Promise<Step | null> {
  const rows = await db.execute<{
    first_name: string | null;
    last_name: string | null;
    score: number;
    at: unknown;
  }>(sql`
    select p.first_name, p.last_name, sc.score, sc.computed_at at
    from contact_scores sc join people p on p.id = sc.person_id
    where sc.score > 0
    order by sc.score desc, sc.person_id
    limit ${TOP}`);
  if (!rows.length) return null;
  const lines: FeedEvent[] = rows.map((r, i) => {
    const name = fullName(r.first_name, r.last_name);
    return {
      step: "score",
      kind: "found",
      subject: name,
      line: `${name} is number ${i + 1} to call (score ${r.score})`,
      count: r.score,
    };
  });
  return { stage: "score", lines, done: STAGE_DONE.score(), count: null, at: iso(rows[0]?.at) };
}

async function briefStep(db: Queryable): Promise<Step | null> {
  const rows = await db.execute<{
    first_name: string | null;
    last_name: string | null;
    text: string | null;
    at: unknown;
  }>(sql`
    select p.first_name, p.last_name, b.text, b.created_at at
    from briefs b join people p on p.id = b.person_id
    where b.state = 'written'
    order by b.created_at, b.person_id`);
  if (!rows.length) return null;
  const lines = rows.map((r) =>
    briefLine(fullName(r.first_name, r.last_name), "written", briefLines(r.text ?? "").length),
  );
  return {
    stage: "brief",
    lines,
    done: STAGE_DONE.brief(rows.length),
    count: rows.length,
    at: iso(rows.at(-1)?.at),
  };
}

async function composeStep(db: Queryable): Promise<Step | null> {
  const rows = await db.execute<{
    first_name: string | null;
    last_name: string | null;
    status: string;
    at: unknown;
  }>(sql`
    select p.first_name, p.last_name, ${EMAIL_STATUS} status, e.created_at at
    ${EMAIL_FROM} and e.state <> 'stopped'
    order by e.created_at, e.id`);
  if (!rows.length) return null;
  const lines = rows.map((r) =>
    composeLine(
      fullName(r.first_name, r.last_name),
      r.status === "awaiting" ? "drafted" : "approved",
    ),
  );
  return {
    stage: "compose",
    lines,
    done: STAGE_DONE.compose(rows.length),
    count: rows.length,
    at: iso(rows.at(-1)?.at),
  };
}

export interface Story {
  lines: FeedLine[];
  /** When the newest record in it was made; the replay's label names the day. */
  asOf: string | null;
}

export async function portalStory(db: Queryable): Promise<Story> {
  const steps: Step[] = [];
  for (const read of [verifyStep, lookupStep, signalsStep, scoreStep, briefStep, composeStep]) {
    const step = await read(db);
    if (step) steps.push(step);
  }
  const events = steps.flatMap((s) => [
    { step: s.stage, kind: "started", line: STAGE_STARTS[s.stage] } satisfies FeedEvent,
    ...s.lines,
    { step: s.stage, kind: "done", line: s.done, count: s.count } satisfies FeedEvent,
  ]);
  const asOf = steps
    .map((s) => s.at)
    .reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);
  return {
    lines: events.map((e, i) => ({
      seq: i + 1,
      at: asOf ?? "",
      step: e.step,
      kind: e.kind,
      line: e.line,
      subject: e.subject ?? null,
      count: e.count ?? null,
      source: e.source ?? null,
      detail: null,
    })),
    asOf,
  };
}
