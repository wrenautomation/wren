/**
 * Running a study: plan, search, ask, read, claims, drafts, in that order.
 * Every unit is one `study_steps` row, written as it finishes, so Ctrl-C loses
 * at most the unit in flight and a re-run picks up where it stopped. A
 * `failed` unit is tried again; the other outcomes are final.
 *
 * Claims wait until every page an angle picked has a final read, and drafts
 * until every angle has its claims: a report is never drawn from half the
 * evidence and then frozen.
 */
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, LlmError, type Tracer } from "@wren/llm";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { ZodType } from "zod";
import { keepDocument, keepingAnswers } from "../findings.js";
import type { EvidencePage } from "../grounding.js";
import { Capped, paced, realSleep, refusedBy } from "../pacing.js";
import {
  documents,
  STUDY_STEPS,
  type Study,
  type StudyDraftSpec,
  type StudyOutcome,
  type StudyStep,
  type StudyStepRow,
  studies,
  studySteps,
} from "../schema.js";
import {
  buildClaimsPrompt,
  buildPlanPrompt,
  type Claim,
  ClaimProposals,
  type DroppedClaim,
  gateClaims,
  planQueries,
  QueryPlan,
  STUDY_VERSION,
} from "./claims.js";
import {
  buildDraftPrompt,
  type DraftItem,
  DraftProposals,
  type DroppedDraft,
  gateDrafts,
  type NumberedClaim,
} from "./drafts.js";
import { angleEvidence, type Hit, pickReads, terms } from "./evidence.js";
import type { StudyInput } from "./recipes.js";

export const READS_PER_ANGLE = 6;
const HITS_PER_QUERY = 8;
const READ_MAX_CHARS = 20_000;
/** Less text than this is a shell, a cookie wall or an error page. */
const MIN_PAGE_CHARS = 300;
/** Site errors in a row that stop the run: the box is down, not the page. */
const FAIL_STREAK = 3;
const PLAN_TOKENS = 400;
const CLAIMS_TOKENS = 3_000;
const DRAFT_TOKENS = 4_000;

const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** Make a study, or return the one already under this slug when it asks the same thing. */
export async function openStudy(
  db: Queryable,
  slug: string,
  input: StudyInput,
  niche: string | null = null,
): Promise<Study> {
  if (!SLUG.test(slug)) {
    throw new Error(`study slug '${slug}': lowercase letters, digits and dashes, 2 to 80`);
  }
  if (!input.question.trim() || !input.angles.some((a) => a.trim())) {
    throw new Error("a study needs a question and at least one angle");
  }
  const angles = [...new Set(input.angles.map((a) => a.trim()).filter(Boolean))];
  const [made] = await db
    .insert(studies)
    .values({ slug, question: input.question.trim(), angles, drafts: input.drafts, niche })
    .onConflictDoNothing({ target: studies.slug })
    .returning();
  if (made) return made;
  const had = await studyBySlug(db, slug);
  if (had.question !== input.question.trim()) {
    throw new Error(`study '${slug}' already asks something else: "${had.question}"`);
  }
  return had;
}

export async function studyBySlug(db: Queryable, slug: string): Promise<Study> {
  const [row] = await db.select().from(studies).where(eq(studies.slug, slug));
  if (!row) throw new Error(`no study '${slug}'`);
  return row;
}

export interface StudyDeps {
  sites: SiteClient;
  llm: LlmClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface StudyRunOptions {
  runId?: string | null;
  tracer?: Tracer | null;
  /** Also ask an answer engine each angle (perplexity: its sources get read, never its prose). */
  ask?: boolean;
  readsPerAngle?: number;
  /** Throw away this step and every one after it first, then run (a new prompt, more pages). */
  redo?: StudyStep | null;
  onProgress?: (line: string) => void;
}

export interface StudyStats {
  planned: number;
  searched: number;
  asked: number;
  read: number;
  claimed: number;
  kept: number;
  dropped: number;
  drafted: number;
  failed: number;
  refused: number;
  /** Units a later run still has to do: claims waiting on reads, drafts on claims. */
  waiting: number;
  /** A site's daily cap stopped gathering; claims wait for the rest. */
  capped: { site: string; retryAt: string } | null;
  aborted: string | null;
}

type Unit = `${StudyStep} ${string}`;
const unit = (step: StudyStep, key: string): Unit => `${step} ${key}`;

/** A page's own title, or null: a PDF in the browser reads as "about:blank". */
export const pageTitle = (title: string | null | undefined): string | null => {
  const t = title?.trim();
  return t && !/^about:/i.test(t) ? t : null;
};

/** Stop the run: a provider failure, or the sites failing in a row. */
class Abort extends Error {}

interface SearchDetail {
  hits: Hit[];
}
interface AskDetail {
  sources: Hit[];
}

interface Perplexity {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { title?: string | null; url: string; snippet?: string | null }[];
}

interface ReadPage {
  url: string;
  title: string | null;
  text: string;
  via: string;
  cut: number;
}

/**
 * Run every unit of the study that isn't done. Returns the stats; a thrown
 * error is a bug or the database, not a site or the model.
 */
export async function runStudy(
  db: Queryable,
  deps: StudyDeps,
  slug: string,
  opts: StudyRunOptions = {},
): Promise<StudyStats> {
  const study = await studyBySlug(db, slug);
  const now = deps.now ?? (() => new Date());
  const call = paced(keepingAnswers(deps.sites, db), now, deps.sleep ?? realSleep);
  const say = opts.onProgress ?? (() => {});
  const runId = opts.runId ?? null;
  const readsPerAngle = opts.readsPerAngle ?? READS_PER_ANGLE;
  const stats: StudyStats = {
    planned: 0,
    searched: 0,
    asked: 0,
    read: 0,
    claimed: 0,
    kept: 0,
    dropped: 0,
    drafted: 0,
    failed: 0,
    refused: 0,
    waiting: 0,
    capped: null,
    aborted: null,
  };

  if (opts.redo) {
    const later = STUDY_STEPS.slice(STUDY_STEPS.indexOf(opts.redo));
    await db
      .delete(studySteps)
      .where(and(eq(studySteps.studyId, study.id), inArray(studySteps.step, later)));
  }
  const rows = new Map<Unit, StudyStepRow>();
  for (const r of await db.select().from(studySteps).where(eq(studySteps.studyId, study.id))) {
    rows.set(unit(r.step, r.key), r);
  }
  const done = (step: StudyStep, key: string): StudyStepRow | null => {
    const r = rows.get(unit(step, key));
    return r && r.outcome !== "failed" ? r : null;
  };
  const keep = async (
    step: StudyStep,
    key: string,
    outcome: StudyOutcome,
    detail: Record<string, unknown>,
    documentId: number | null = null,
  ): Promise<void> => {
    const values = { outcome, detail, documentId, runId, createdAt: now() };
    const [row] = await db
      .insert(studySteps)
      .values({ studyId: study.id, step, key, ...values })
      .onConflictDoUpdate({
        target: [studySteps.studyId, studySteps.step, studySteps.key],
        set: values,
      })
      .returning();
    if (row) rows.set(unit(step, key), row);
    if (outcome === "failed") stats.failed++;
    if (outcome === "refused") stats.refused++;
  };

  let streak = 0;
  /** One site call as a unit's outcome: a 4xx is this input refused, anything else failed. */
  const site = async <T>(
    what: string,
    ...args: Parameters<SiteClient["call"]>
  ): Promise<{ value: T } | { outcome: "refused" | "failed"; error: string }> => {
    try {
      const value = await call<T>(...args);
      streak = 0;
      return { value };
    } catch (err) {
      if (err instanceof Capped) throw err;
      const error = err instanceof Error ? err.message : String(err);
      if (refusedBy(err) !== null) return { outcome: "refused", error };
      // A 5xx, a dropped connection, a body that isn't JSON: this unit failed.
      say(`${what}: failed (${error})`);
      if (++streak >= FAIL_STREAK)
        throw new Abort(`${FAIL_STREAK} site calls failed in a row: ${error}`);
      return { outcome: "failed", error };
    }
  };

  /** One model call as a unit; a provider failure stops the run. */
  const ask = async <T>(
    prompt: string,
    schema: ZodType<T>,
    maxTokens: number,
    name: string,
    key: string,
  ) => {
    try {
      return await completeAndParse(deps.llm, prompt, schema, {
        maxTokens,
        runId,
        tracer: opts.tracer ?? null,
        name: `study_${name}`,
        metadata: { study: study.slug, key, version: STUDY_VERSION },
      });
    } catch (err) {
      if (err instanceof LlmError) throw new Abort(`${deps.llm.name}: ${err.message}`);
      throw err;
    }
  };

  const queriesOf = (angle: string): string[] =>
    (done("plan", angle)?.detail as { queries?: string[] } | undefined)?.queries ?? [];
  const hitsOf = (query: string): Hit[] =>
    (done("search", query)?.detail as SearchDetail | undefined)?.hits ?? [];
  const sourcesOf = (angle: string): Hit[] =>
    (done("ask", angle)?.detail as AskDetail | undefined)?.sources ?? [];
  const readsOf = (angle: string): string[] =>
    pickReads([...queriesOf(angle).map(hitsOf), sourcesOf(angle)], readsPerAngle);

  try {
    for (const angle of study.angles) {
      if (done("plan", angle)) continue;
      const out = await ask(
        buildPlanPrompt(study.question, angle, now().getUTCFullYear()),
        QueryPlan,
        PLAN_TOKENS,
        "plan",
        angle,
      );
      const queries = out.parsed ? planQueries(out.parsed) : [];
      await keep("plan", angle, outcomeOf(out, queries.length), out.envelope({ queries }));
      stats.planned++;
      say(`plan "${angle}": ${queries.join(" | ") || "nothing"}`);
    }

    for (const q of [...new Set(study.angles.flatMap(queriesOf))]) {
      if (done("search", q)) continue;
      const res = await site<{ hits?: Hit[]; via?: string }>(
        `search "${q}"`,
        "web",
        "GET",
        "/search",
        { q, n: HITS_PER_QUERY },
      );
      if ("outcome" in res) {
        await keep("search", q, res.outcome, { error: res.error });
        continue;
      }
      const hits = (res.value.hits ?? []).map((h) => ({
        title: h.title,
        url: h.url,
        snippet: h.snippet ?? null,
      }));
      await keep("search", q, hits.length ? "ok" : "empty", { hits, via: res.value.via ?? null });
      stats.searched++;
      say(`search "${q}": ${hits.length} hits`);
    }

    if (opts.ask) {
      for (const angle of study.angles) {
        if (done("ask", angle)) continue;
        const res = await site<Perplexity>(
          `ask "${angle}"`,
          "perplexity",
          "POST",
          "/chat/completions",
          {
            messages: [{ role: "user", content: `${study.question}\n\n${angle}` }],
          },
        );
        if ("outcome" in res) {
          await keep("ask", angle, res.outcome, { error: res.error });
          continue;
        }
        const sources = answerSources(res.value);
        const answer = res.value.choices?.[0]?.message?.content ?? null;
        await keep("ask", angle, sources.length ? "ok" : "empty", { answer, sources });
        stats.asked++;
        say(`ask "${angle}": ${sources.length} sources`);
      }
    }

    for (const url of [...new Set(study.angles.flatMap(readsOf))]) {
      if (done("read", url)) continue;
      const res = await site<ReadPage>(`read ${url}`, "web", "GET", "/read", {
        url,
        max: READ_MAX_CHARS,
      });
      if ("outcome" in res) {
        await keep("read", url, res.outcome, { error: res.error });
        continue;
      }
      const page = res.value;
      const text = (page.text ?? "").trim();
      const detail = {
        title: pageTitle(page.title),
        via: page.via ?? null,
        cut: page.cut ?? 0,
        chars: text.length,
      };
      if (text.length < MIN_PAGE_CHARS) {
        await keep("read", url, "empty", detail);
        continue;
      }
      const documentId = await keepDocument(db, {
        url,
        kind: "webpage",
        title: pageTitle(page.title),
        text,
        fetchTier: `web:${page.via ?? "read"}`.slice(0, 16),
      });
      await keep("read", url, "ok", detail, documentId);
      stats.read++;
      say(`read ${url}: ${text.length} chars`);
    }
  } catch (err) {
    if (err instanceof Capped) {
      stats.capped = { site: err.site, retryAt: err.retryAt.toISOString() };
      say(`capped by ${err.site} until ${stats.capped.retryAt}: claims wait`);
      return stats;
    }
    if (err instanceof Abort) {
      stats.aborted = err.message;
      return stats;
    }
    throw err;
  }

  try {
    const pageText = await pagesById(
      db,
      [...rows.values()].flatMap((r) => (r.step === "read" && r.documentId ? [r.documentId] : [])),
    );
    for (const angle of study.angles) {
      if (done("claims", angle)) continue;
      const urls = readsOf(angle);
      const reads = urls.map((u) => done("read", u));
      if (
        !done("plan", angle) ||
        queriesOf(angle).some((q) => !done("search", q)) ||
        reads.some((r) => !r)
      ) {
        stats.waiting++;
        continue;
      }
      const pages: EvidencePage[] = reads.flatMap((r) =>
        r?.outcome === "ok" && r.documentId && pageText.has(r.documentId)
          ? [{ url: r.key, text: pageText.get(r.documentId) ?? "" }]
          : [],
      );
      const evidence = angleEvidence(pages, terms(study.question, angle));
      if (!evidence.length) {
        await keep("claims", angle, "empty", { kept: [], dropped: [], pages: [] });
        say(`claims "${angle}": no pages to read`);
        continue;
      }
      const out = await ask(
        buildClaimsPrompt(study.question, angle, evidence),
        ClaimProposals,
        CLAIMS_TOKENS,
        "claims",
        angle,
      );
      const { kept, dropped } = out.parsed
        ? gateClaims(out.parsed, evidence)
        : { kept: [], dropped: [] };
      await keep(
        "claims",
        angle,
        outcomeOf(out, kept.length),
        out.envelope({ kept, dropped, pages: evidence.map((p) => p.url) }),
      );
      stats.claimed++;
      stats.kept += kept.length;
      stats.dropped += dropped.length;
      say(`claims "${angle}": ${kept.length} kept, ${dropped.length} dropped`);
    }

    if (study.drafts.length) {
      if (study.angles.some((a) => !done("claims", a))) {
        stats.waiting += study.drafts.filter((d) => !done("draft", d.key)).length;
        return stats;
      }
      const claims = numberClaims(study.angles.map((a) => claimsOf(done("claims", a))));
      for (const spec of study.drafts) {
        if (done("draft", spec.key)) continue;
        if (!claims.length) {
          await keep("draft", spec.key, "empty", { kept: [], dropped: [] });
          continue;
        }
        const out = await ask(
          buildDraftPrompt(study.question, spec, claims),
          DraftProposals,
          DRAFT_TOKENS,
          "draft",
          spec.key,
        );
        const { kept, dropped } = out.parsed
          ? gateDrafts(out.parsed, spec, claims)
          : { kept: [], dropped: [] };
        await keep("draft", spec.key, outcomeOf(out, kept.length), out.envelope({ kept, dropped }));
        stats.drafted++;
        say(`draft ${spec.key}: ${kept.length} kept, ${dropped.length} dropped`);
      }
    }
  } catch (err) {
    if (err instanceof Abort) {
      stats.aborted = err.message;
      return stats;
    }
    throw err;
  }
  return stats;
}

/** A model unit's outcome: rejected input, an unreadable answer, nothing to use, or ok. */
function outcomeOf(
  out: { providerRejected: string | null; ok: boolean },
  count: number,
): StudyOutcome {
  if (out.providerRejected) return "refused";
  if (!out.ok) return "failed";
  return count ? "ok" : "empty";
}

/** An answer engine's sources as hits: its citations in order, titled from its results. */
export function answerSources(a: Perplexity): Hit[] {
  const results = a.search_results ?? [];
  const urls = [...new Set([...(a.citations ?? []), ...results.map((r) => r.url)])];
  return urls.map((url) => {
    const r = results.find((x) => x.url === url);
    return { title: r?.title ?? url, url, snippet: r?.snippet ?? null };
  });
}

async function pagesById(db: Queryable, ids: readonly number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const found = await db
    .select({ id: documents.id, text: documents.text })
    .from(documents)
    .where(inArray(documents.id, [...new Set(ids)]));
  return new Map(found.map((d) => [d.id, d.text]));
}

const claimsOf = (row: StudyStepRow | null): Claim[] =>
  (row?.detail as { kept?: Claim[] } | undefined)?.kept ?? [];

/** Claims numbered in report order: angle by angle, as each angle ranked them. */
export function numberClaims(byAngle: readonly (readonly Claim[])[]): NumberedClaim[] {
  return byAngle.flat().map((c, i) => ({ ...c, n: i + 1 }));
}

/** Everything the report shows, read back from the steps. */
export interface StudyView {
  study: Study;
  angles: { angle: string; claims: NumberedClaim[]; dropped: DroppedClaim[]; done: boolean }[];
  drafts: { spec: StudyDraftSpec; kept: DraftItem[]; dropped: DroppedDraft[]; done: boolean }[];
  /** Page titles by URL, for the sources list. */
  titles: Map<string, string>;
  counts: { queries: number; pages: number; unread: number };
}

export async function studyView(db: Queryable, slug: string, since?: Date): Promise<StudyView> {
  const study = await studyBySlug(db, slug);
  const where = since
    ? and(eq(studySteps.studyId, study.id), gte(studySteps.createdAt, since))
    : eq(studySteps.studyId, study.id);
  const rows = await db.select().from(studySteps).where(where).orderBy(asc(studySteps.id));
  const final = (step: StudyStep, key: string) =>
    rows.find((r) => r.step === step && r.key === key && r.outcome !== "failed") ?? null;
  const perAngle = study.angles.map((a) => final("claims", a));
  const numbered = numberClaims(perAngle.map(claimsOf));
  let n = 0;
  const angles = study.angles.map((angle, i) => {
    const row = perAngle[i] ?? null;
    const count = claimsOf(row).length;
    const claims = numbered.slice(n, n + count);
    n += count;
    const dropped = (row?.detail as { dropped?: DroppedClaim[] } | undefined)?.dropped ?? [];
    return { angle, claims, dropped, done: row !== null };
  });
  const drafts = study.drafts.map((spec) => {
    const row = final("draft", spec.key);
    const d = (row?.detail ?? {}) as { kept?: DraftItem[]; dropped?: DroppedDraft[] };
    return { spec, kept: d.kept ?? [], dropped: d.dropped ?? [], done: row !== null };
  });
  const titles = new Map<string, string>();
  for (const r of rows) {
    const title = pageTitle((r.detail as { title?: string | null }).title);
    if (r.step === "read" && r.outcome === "ok" && title) titles.set(r.key, title);
  }
  return {
    study,
    angles,
    drafts,
    titles,
    counts: {
      queries: rows.filter((r) => r.step === "search" && r.outcome !== "failed").length,
      pages: rows.filter((r) => r.step === "read" && r.outcome === "ok").length,
      unread: rows.filter((r) => r.step === "read" && r.outcome !== "ok").length,
    },
  };
}
