/**
 * `crm run` brief stage: why reach out to this person now (R9). The model
 * writes a few sentences from the facts only, each ending in the marks of the
 * facts it rests on (`[f12]` a finding, `[c3]` a CRM row). The gate keeps a
 * sentence only when every mark is one of this person's facts and every
 * number in it is in those facts; the rest are dropped, with why. It opens
 * with the signal (the move, or open roles at their company) in one sentence,
 * then the facts; the gate puts the signal's sentence first if the model didn't.
 *
 * Who gets one: people who score above zero, whose lookup is done, and with
 * at least one finding to say. A brief is rewritten only when what it was
 * written from changes, so the same facts are never paid for twice.
 */
import { type Feed, NO_FEED } from "@wren/core";
import type { Queryable } from "@wren/db";
import { completeAndParse, type Envelope, type LlmClient, LlmError } from "@wren/llm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { briefLine, failedLine } from "./feed.js";
import { type BriefState, briefs } from "./schema.js";
import { hiringFinding, LATEST_CRM_ROW, whereFinding } from "./score.js";

export const BRIEF_VERSION = "v4";
export const STAGE_NAME = "reactivation_brief";
const MAX_TOKENS = 2000;
const MAX_SENTENCES = 4;
/** Errors in a row that stop the run. */
const ERROR_STREAK = 5;

export const briefSchema = z.object({ sentences: z.array(z.string()) });

export interface BriefFact {
  /** `f12` or `c3`. */
  mark: string;
  text: string;
}

export interface BriefSubject {
  personId: number;
  name: string;
  firm: string;
  facts: BriefFact[];
  /** The mark of the reason to call now (the move, else open roles); null when there is none. */
  signal: string | null;
  inputsHash: string;
}

export interface Gated {
  kept: string[];
  dropped: { sentence: string; why: string }[];
  cites: { findings: number[]; crm: number[] };
}

export const MARKS = /\[\s*([fc]\d+(?:\s*[,;]\s*[fc]\d+)*)\s*\]/gi;

/** Number words a model might write for a count; "one" is left out (it is mostly a pronoun). */
const WORDS: Record<string, string> = {
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  fifteen: "15",
  twenty: "20",
  thirty: "30",
  fifty: "50",
  hundred: "hundred",
  dozen: "dozen",
  thousand: "thousand",
  million: "million",
  billion: "billion",
};
/** A date whole, else a number with its separators and any magnitude glued on ("3k"), else a number word. */
const NUMBER = new RegExp(
  `\\d{4}-\\d{2}-\\d{2}|\\d+(?:[.,]\\d+)*(?:(?:k|m|bn)(?![a-z]))?|\\b(?:${Object.keys(WORDS).join("|")})\\b`,
  "gi",
);
/** A digit outside 0-9 (Arabic-Indic, Devanagari, ...) after NFKC folded the full-width ones. */
const OTHER_DIGIT = /(?![0-9])\p{Nd}/u;
/**
 * A sentence ends at . ! or ? (and the marks after it) before the next one's
 * capital or digit, but not after a title or company abbreviation ("Sr.
 * Manager") or an initial ("J.P. Morgan").
 */
const SENTENCE_END =
  /(?<=[.!?]["'\u201d\u2019)]*(?:\s*\[[^\]]*\])*)(?<!\b(?:Sr|Jr|Mr|Mrs|Ms|Dr|St|Inc|Ltd|Co|Corp|Assoc|Dept|vs|\p{Lu})\.)\s+(?=["'\u201c(]?[\p{Lu}\p{Nd}])/u;
/** Kept sentences, one per line, so they read back exactly. */
const joinLines = (kept: string[]) => kept.join("\n");
/**
 * A written brief back into its sentences, marks and all. Briefs are one
 * sentence per line; older ones were joined by spaces and split by guess.
 */
export const briefLines = (text: string): string[] => {
  const t = text.trim();
  return (t.includes("\n") ? t.split(/\n+/) : t.split(SENTENCE_END))
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Hiring talk: only a cited open-roles fact backs it. */
const HIRING = /\b(?:open roles?|openings?|hiring|job posts?|postings?)\b/i;
/** A clause saying what a fact means (", indicating a need to..."): a guess, cut before the marks. */
const READING =
  /,\s*(?:which\s+)?(?:(?:may|might|could|can|would)\s+)?(?:indicat|suggest|signal|impl|point|making)\w*[^.!?[]*?(?=\s*[.!?[]|$)/gi;

const numbers = (text: string): string[] =>
  (text.normalize("NFKC").match(NUMBER) ?? []).map((n) => {
    const t = n.toLowerCase();
    return WORDS[t] ?? t;
  });

/**
 * The numbers a sentence says that its facts don't: each must be a whole
 * number of the facts (so "29" is not the day of "2026-09-29"), a year may
 * stand for a date in that year, and a digit outside 0-9 is never in them.
 */
export function madeUp(sentence: string, source: string): string[] {
  const text = sentence.replace(MARKS, " ");
  if (OTHER_DIGIT.test(text.normalize("NFKC"))) return ["a digit outside 0-9"];
  const have = new Set(numbers(source));
  const years = new Set([...have].filter((n) => /^\d{4}-/.test(n)).map((n) => n.slice(0, 4)));
  return numbers(text).filter((n) => !have.has(n) && !(/^\d{4}$/.test(n) && years.has(n)));
}

/**
 * Keep the sentences whose marks and numbers all come from these facts. An
 * element the model packed with several sentences is gated one sentence at a
 * time, so an uncited one can't ride on its neighbour's marks.
 */
export function gateBrief(
  sentences: string[],
  facts: BriefFact[],
  signal: string | null = null,
): Gated {
  const byMark = new Map(facts.map((f) => [f.mark.toLowerCase(), f.text]));
  const kept: string[] = [];
  let lead = -1;
  const dropped: Gated["dropped"] = [];
  const cited = new Set<string>();
  for (const said of sentences.flatMap((s) => s.trim().split(SENTENCE_END))) {
    const sentence = said.replace(READING, "");
    if (!sentence.trim()) continue;
    const marks = [...sentence.matchAll(MARKS)].flatMap((m) =>
      (m[1] ?? "").split(/[,;]/).map((x) => x.trim().toLowerCase()),
    );
    const drop = (why: string) => dropped.push({ sentence, why });
    if (!marks.length) {
      drop("cites nothing");
      continue;
    }
    const unknown = marks.filter((m) => !byMark.has(m));
    if (unknown.length) {
      drop(`cites ${unknown.join(", ")}, not this person's facts`);
      continue;
    }
    const backing = marks.map((m) => byMark.get(m)).join("\n");
    if (HIRING.test(sentence) && !/\bopen roles?\b/i.test(backing)) {
      drop("says hiring; the facts it cites have no open roles");
      continue;
    }
    const made = madeUp(sentence, backing);
    if (made.length) {
      drop(`${made.join(", ")} not in the facts it cites`);
      continue;
    }
    if (kept.length >= MAX_SENTENCES) {
      drop(`over ${MAX_SENTENCES} sentences`);
      continue;
    }
    if (lead < 0 && signal && marks.includes(signal.toLowerCase())) lead = kept.length;
    kept.push(sentence);
    for (const m of marks) cited.add(m);
  }
  // The signal opens the brief, whatever order the model wrote it in.
  if (lead > 0) kept.unshift(...kept.splice(lead, 1));
  const ids = (p: string) =>
    [...cited]
      .filter((m) => m.startsWith(p))
      .map((m) => Number(m.slice(1)))
      .sort((a, b) => a - b);
  return { kept, dropped, cites: { findings: ids("f"), crm: ids("c") } };
}

export function buildBriefPrompt(s: BriefSubject): string {
  return `You write a short note for a recruiter about one past contact from their CRM: why reach out to this person now.

Contact: ${s.name}, last known at ${s.firm}.

Facts, each with its mark:
${s.facts.map((f) => `[${f.mark}] ${f.text}`).join("\n")}

Rules:
- 2 to 4 sentences. The first is ${s.signal ? `the reason to call now, from [${s.signal}]` : "where they are now"}, in one sentence. Then the other facts, most useful first, history with the recruiter last.
- End each sentence with the marks of the facts it rests on, like [f12] or [f12][c3].
- Use only these facts. No guesses, no advice, no greetings, no outreach wording.
- State the facts, never what they indicate, suggest or mean.
- Copy names, numbers and dates exactly as written. Do not compute durations, ages or totals.

Return ONLY a JSON object: {"sentences": ["...", "..."]}
`;
}

// ---- inputs ----------------------------------------------------------------

interface Fact {
  id: number;
  kind: string;
  via: string;
  value: Record<string, unknown>;
  observed: string;
}

interface CrmRow {
  id: number;
  owner: string | null;
  status: string | null;
  contacted: string | null;
  placed: string | null;
  added: string | null;
}

interface Row extends Record<string, unknown> {
  person_id: number;
  first_name: string | null;
  last_name: string | null;
  firm: string;
  facts: Fact[];
  crm: CrmRow[];
  inputs_hash: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** How a reader would say where a fact came from. */
function source(via: string): string {
  if (via.startsWith("linkedin")) return "LinkedIn";
  if (via === "email") return "email check";
  if (via === "search") return "public profile";
  return `${via} job board`;
}

function factText(f: Fact, firm: string): string {
  const v = f.value;
  const how = `(${source(f.via)}, read ${f.observed})`;
  const role = [str(v.title) ? `as ${v.title}` : null, str(v.dates) ? `(${v.dates})` : null]
    .filter(Boolean)
    .join(" ");
  switch (f.kind) {
    case "still_there":
      return str(v.reason)
        ? `still at ${firm}: ${v.reason} ${how}`
        : `still at ${str(v.company) ?? firm}${role ? ` ${role}` : ""} ${how}`;
    case "job_change":
      return `moved from ${str(v.from) ?? firm} to ${str(v.to) ?? "?"}${role ? ` ${role}` : ""} ${how}`;
    case "hiring": {
      const roles = Array.isArray(v.roles) ? (v.roles as Record<string, unknown>[]) : [];
      const list = roles
        .map((r) => [str(r.title), str(r.location), str(r.postedAt) && `posted ${r.postedAt}`])
        .map((p) => p.filter(Boolean).join(", "))
        .join("; ");
      return `${firm} has ${v.count ?? roles.length} open roles${list ? `: ${list}` : ""} ${how}`;
    }
    default:
      return `${f.kind}: ${JSON.stringify(v)} ${how}`;
  }
}

function crmText(c: CrmRow): string {
  const parts = [
    c.owner && `owner ${c.owner}`,
    c.status && `status ${c.status}`,
    c.contacted && `last contacted ${c.contacted}`,
    c.placed && `last placement ${c.placed}`,
    c.added && `added ${c.added}`,
  ].filter(Boolean);
  return `CRM record: ${parts.length ? parts.join("; ") : "no dates or owner"}`;
}

/**
 * Due: scored above zero, lookup done (matched or unresolved), at least one
 * finding, and no brief yet, or one written from other inputs or another
 * prompt, or a failed one a day old. `crm status` counts with the same query.
 */
function briefSubjectsSql(opts: { limit?: number; count?: boolean }) {
  return sql`
    with latest as (${LATEST_CRM_ROW}),
    picked as (
      select l.person_id, l.company_id,
        coalesce(co.name, co.domain, 'their firm') firm,
        ${whereFinding(sql`l.person_id`)} where_id,
        ${hiringFinding(sql`l.company_id`)} hiring_id
      from latest l
      join companies co on co.id = l.company_id
      join contact_scores s on s.person_id = l.person_id and s.score > 0
      join person_lookups pl on pl.person_id = l.person_id and pl.state in ('matched', 'unresolved')
    ),
    inputs as (
      select p.person_id, p.firm,
        (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'via', f.via,
            'value', f.value, 'observed', f.observed_at::date::text) order by f.id), '[]')
          from findings f
          where f.id = p.where_id
            -- A mover's old firm hiring is not "open roles at their company".
            or (f.id = p.hiring_id and not exists (select 1 from findings w
              where w.id = p.where_id and w.kind in ('job_change', 'left')))
            or (f.person_id = p.person_id and f.kind in ('post', 'news'))) facts,
        (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'owner', c.owner,
            'status', c.status, 'contacted', c.last_contacted_on::text,
            'placed', c.last_placement_on::text, 'added', c.added_on::text) order by c.id), '[]')
          from crm_contacts c where c.person_id = p.person_id) crm
      from picked p
    ),
    hashed as (
      -- A fact read again on a later day is the same fact: its read date is not an input.
      select i.*, md5(${BRIEF_VERSION}::text
        || (select coalesce(jsonb_agg(x - 'observed' order by n), '[]')
            from jsonb_array_elements(i.facts) with ordinality e(x, n))::text
        || i.crm::text || i.firm) inputs_hash
      from inputs i
      where jsonb_array_length(i.facts) > 0
    )
    ${
      opts.count
        ? sql`select count(*)::int n from hashed h`
        : sql`select h.*, pe.first_name, pe.last_name from hashed h join people pe on pe.id = h.person_id`
    }
    where not exists (select 1 from briefs b where b.person_id = h.person_id
      and b.inputs_hash = h.inputs_hash and b.prompt_version = ${BRIEF_VERSION}
      and (b.state <> 'failed' or b.created_at > now() - interval '1 day'))
    ${opts.count ? sql`` : sql`order by (select score from contact_scores s where s.person_id = h.person_id) desc, h.person_id limit ${opts.limit ?? 1_000_000}`}`;
}

export async function briefsDue(db: Queryable): Promise<number> {
  const [r] = await db.execute<{ n: number }>(briefSubjectsSql({ count: true }));
  return r?.n ?? 0;
}

/** Who is due a brief, best score first, with their facts marked. */
export async function briefSubjects(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<BriefSubject[]> {
  const rows = await db.execute<Row>(briefSubjectsSql(opts));
  return rows.map((r) => {
    const signal =
      r.facts.find((f) => f.kind === "job_change") ?? r.facts.find((f) => f.kind === "hiring");
    return {
      personId: r.person_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)",
      firm: r.firm,
      facts: [
        ...r.facts.map((f) => ({ mark: `f${f.id}`, text: factText(f, r.firm) })),
        ...r.crm.map((c) => ({ mark: `c${c.id}`, text: crmText(c) })),
      ],
      signal: signal ? `f${signal.id}` : null,
      inputsHash: r.inputs_hash,
    };
  });
}

// ---- the stage -------------------------------------------------------------

export interface CrmBriefStats {
  selected: number;
  written: number;
  empty: number;
  failed: number;
  /** Sentences the gate dropped, across all briefs. */
  dropped: number;
  errors: number;
  aborted: string | null;
}

export async function writeCrmBriefs(
  db: Queryable,
  llm: LlmClient,
  opts: { limit?: number; runId?: string | null; feed?: Feed } = {},
): Promise<CrmBriefStats> {
  const feed = opts.feed ?? NO_FEED;
  const subjects = await briefSubjects(db, opts);
  const stats: CrmBriefStats = {
    selected: subjects.length,
    written: 0,
    empty: 0,
    failed: 0,
    dropped: 0,
    errors: 0,
    aborted: null,
  };
  let streak = 0;
  for (const s of subjects) {
    let state: BriefState;
    let gated: Gated = { kept: [], dropped: [], cites: { findings: [], crm: [] } };
    let envelope: Envelope;
    try {
      const outcome = await completeAndParse(llm, buildBriefPrompt(s), briefSchema, {
        maxTokens: MAX_TOKENS,
        runId: opts.runId ?? null,
        name: STAGE_NAME,
        metadata: { person_id: s.personId },
      });
      envelope = outcome.envelope();
      if (outcome.parsed) {
        gated = gateBrief(outcome.parsed.sentences, s.facts, s.signal);
        state = gated.kept.length ? "written" : "empty";
      } else state = "failed";
    } catch (err) {
      // The provider is down or refusing us: every later call would fail too.
      if (err instanceof LlmError) {
        stats.aborted = err.message;
        break;
      }
      throw err;
    }
    try {
      const row = {
        state,
        text: joinLines(gated.kept),
        citations: gated.cites,
        dropped: gated.dropped,
        inputsHash: s.inputsHash,
        model: llm.name,
        promptVersion: BRIEF_VERSION,
        llm: envelope,
        runId: opts.runId ?? null,
      };
      await db
        .insert(briefs)
        .values({ personId: s.personId, ...row })
        .onConflictDoUpdate({
          target: briefs.personId,
          set: { ...row, createdAt: sql`now()` },
        });
    } catch (err) {
      await feed.emit(failedLine("brief", s.name, err));
      stats.errors += 1;
      streak += 1;
      if (streak >= ERROR_STREAK) {
        stats.aborted = `${ERROR_STREAK} errors in a row, last: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
      continue;
    }
    streak = 0;
    await feed.emit(briefLine(s.name, state, gated.kept.length));
    stats[state] += 1;
    stats.dropped += gated.dropped.length;
  }
  return stats;
}
