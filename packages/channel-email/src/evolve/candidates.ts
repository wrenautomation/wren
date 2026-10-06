/**
 * Candidates: what the LLM tiers write, and William's approve or reject.
 *
 * The tiers run outside any transaction (model calls are slow); their results land
 * in one. A candidate waits as an `experiment_alleles` row in state `candidate` until
 * William decides. Approving is a genome change: a new `template_versions` row with
 * its parent and experiment, the experiment pointed at it. The caller re-renders the
 * niche's queue (`QueueRefresh`, or `refreshCampaign` in the loop).
 */

import {
  alleleKey,
  factKeys,
  type Option,
  optionText,
  type Template,
  toSource,
  variants,
} from "@wren/core/slots";
import { type Db, type Queryable, serializable } from "@wren/db";
import { FITNESS, parseSettings, type Settings } from "@wren/experiments";
import type { CallRecord, LlmClient } from "@wren/llm";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type Experiment,
  experimentAlleles,
  experimentJournal,
  experimentSnapshots,
  experiments,
} from "../schema.js";
import { type EvolveTick, GENOME_STATES, getExperiment } from "./experiments.js";
import {
  asGenome,
  generationOf,
  journal,
  mapPoints,
  points,
  recordVersion,
  versionTemplate,
  ZERO,
} from "./genome.js";
import {
  type AlleleView,
  checkCandidate,
  type LocusView,
  type Plan,
  parseOption,
  runJudge,
  runStrategist,
  runWriter,
} from "./tiers.js";

/** A model client for a settings spec (`cohere:command-a-03-2025`). */
export type LlmFor = (spec: string) => LlmClient;

const JOURNAL_LINES = 20;
/** The writer writes this many per candidate it may queue: the checker and judge cut the rest. */
const WRITE_PER_SLOT = 2;

/** The tick that should run the strategist: its cadence, or a stagnant locus. Never under retire_only or manual. */
export function writeDue(settings: Settings, tick: EvolveTick): boolean {
  if (tick.stopped || settings.mutation === "retire_only" || settings.mutation === "manual")
    return false;
  return tick.generation % settings.strategistEvery === 0 || tick.stagnant.length > 0;
}

interface Context {
  exp: Experiment;
  settings: Settings;
  genome: Template;
  loci: LocusView[];
  rows: (typeof experimentAlleles.$inferSelect)[];
  journal: (typeof experimentJournal.$inferSelect)[];
}

async function contextOf(db: Queryable, id: number): Promise<Context> {
  const exp = await getExperiment(db, id);
  const settings = parseSettings(exp.settings);
  const genome = await versionTemplate(db, exp.niche, exp.template, exp.liveVersion);
  if (!genome) throw new Error(`experiment ${id}: live version ${exp.liveVersion} not on file`);
  const [snap] = await db
    .select()
    .from(experimentSnapshots)
    .where(eq(experimentSnapshots.experimentId, id))
    .orderBy(desc(experimentSnapshots.generation))
    .limit(1);
  const rows = await db
    .select()
    .from(experimentAlleles)
    .where(eq(experimentAlleles.experimentId, id))
    .orderBy(experimentAlleles.id);
  const recent = await db
    .select()
    .from(experimentJournal)
    .where(eq(experimentJournal.experimentId, id))
    .orderBy(desc(experimentJournal.id))
    .limit(200);
  const stats = (snap?.stats ?? {}) as Record<string, Record<string, typeof ZERO>>;
  const pBest = (snap?.pBest ?? {}) as Record<string, Record<string, number>>;
  const strategies = (snap?.strategies ?? {}) as Record<
    string,
    { settled?: boolean; stagnant?: boolean }
  >;
  const angleOf = new Map(rows.map((r) => [`${r.locus}\x00${r.allele}`, r.angle]));
  const loci = points(genome).map((p): LocusView => {
    const fitness = settings.fitnessByLocus[p.name] ?? settings.fitness;
    const alleles = [...new Map(p.options.map((o) => [alleleKey(o), o])).entries()].map(
      ([allele, o]): AlleleView => {
        const counts = stats[p.name]?.[allele] ?? ZERO;
        const [arm] = FITNESS[fitness]([counts], settings.weights);
        return {
          allele,
          text: optionText(o),
          exposures: arm?.trials ?? 0,
          successes: arm?.successes ?? 0,
          pBest: pBest[p.name]?.[allele] ?? null,
          angle: angleOf.get(`${p.name}\x00${allele}`) ?? null,
        };
      },
    );
    return {
      locus: p.name,
      settled: strategies[p.name]?.settled ?? false,
      stagnant: strategies[p.name]?.stagnant ?? false,
      alleles,
    };
  });
  return { exp, settings, genome, loci, rows, journal: recent.reverse() };
}

const pct = (v: unknown) => (typeof v === "number" ? `${(100 * v).toFixed(1)}%` : "?");

/** One journal row in a line a model reads: kind, locus, the allele's words, how it did. */
function journalLine(j: Context["journal"][number], textOf: ReadonlyMap<string, string>): string {
  const d = (j.detail ?? {}) as Record<string, unknown>;
  const parts = [`g${j.generation} ${j.kind}`];
  if (j.locus) parts.push(`#${j.locus}`);
  const allele = typeof d.allele === "string" ? d.allele : null;
  const words =
    typeof d.text === "string" ? d.text : allele ? textOf.get(`${j.locus}\x00${allele}`) : null;
  if (words) parts.push(JSON.stringify(words));
  if (typeof d.reason === "string") parts.push(`(${d.reason})`);
  if (j.kind === "strategist") parts.push(`${d.mode} ${d.mutation} on ${String(d.loci)}`);
  const o = j.outcome as Record<string, unknown> | null;
  if (o)
    parts.push(
      `→ ${o.state ?? "outcome"}: sent ${o.exposures ?? 0}, interested ${o.interested ?? 0}, P(best) ${pct(o.p_best)}`,
    );
  return parts.join(" ");
}

/** Loci the writer may add to: not spent, and fewer than `queueSize` candidates waiting. */
function writableLoci(ctx: Context): string[] {
  return ctx.loci
    .map((l) => l.locus)
    .filter((locus) => {
      const at = ctx.rows.filter((r) => r.locus === locus);
      const tried = at.filter((r) => r.state === "live" || r.state === "retired").length;
      const waiting = at.filter((r) => r.state === "candidate").length;
      return tried < ctx.settings.maxAlleles && waiting < ctx.settings.queueSize;
    });
}

export interface CandidateProposal {
  experiment: number;
  plan: Plan | null;
  /** Per locus: written, kept by the checker, queued. */
  loci: { locus: string; written: number; checked: number; queued: number; error: string | null }[];
  queued: { id: number; locus: string; allele: string; text: string }[];
  approved: number;
  calls: CallRecord[];
}

/**
 * Strategist, writer, checker, judge for one experiment; the survivors wait as
 * candidates (or go live, under `autoApprove`). `plan` skips the strategist (seeding).
 */
export async function proposeCandidates(
  db: Db,
  id: number,
  llmFor: LlmFor,
  opts: { plan?: Plan; origin?: "mutation" | "seed" } = {},
): Promise<CandidateProposal> {
  const ctx = await contextOf(db, id);
  const { settings } = ctx;
  const out: CandidateProposal = {
    experiment: id,
    plan: null,
    loci: [],
    queued: [],
    approved: 0,
    calls: [],
  };
  const writable = writableLoci(ctx);
  if (writable.length === 0) return out;
  const textOf = new Map(ctx.rows.map((r) => [`${r.locus}\x00${r.allele}`, r.text]));
  const lines = (locus?: string) =>
    ctx.journal
      .filter((j) => j.kind !== "snapshot" && (locus === undefined || j.locus === locus))
      .slice(-JOURNAL_LINES)
      .map((j) => journalLine(j, textOf));
  const genomeSource = toSource(ctx.genome, { nameAll: true });

  let plan = opts.plan ?? null;
  if (!plan) {
    const s = await runStrategist(llmFor(settings.models.strategist), {
      genome: genomeSource,
      loci: ctx.loci,
      writable,
      journal: lines(),
    });
    if (s.call) out.calls.push(s.call);
    plan = s.plan;
  }
  out.plan = plan;
  if (!plan) return out;

  const facts = factKeys(ctx.genome);
  const writer = llmFor(settings.models.writer);
  const judge = llmFor(settings.models.judge);
  const results: {
    locus: string;
    written: string[];
    dropped: { text: string; why: string[] }[];
    picked: {
      text: string;
      option: Option;
      key: string;
      score: number | null;
      angle: string | null;
    }[];
    error: string | null;
  }[] = [];
  for (const locus of plan.loci.filter((l) => writable.includes(l))) {
    const view = ctx.loci.find((l) => l.locus === locus) as LocusView;
    const waiting = ctx.rows.filter((r) => r.locus === locus && r.state === "candidate").length;
    const slots = settings.queueSize - waiting;
    const w = await runWriter(writer, {
      genome: genomeSource,
      locus: view,
      mutation: plan.mutation,
      mode: plan.mode,
      temperature: plan.temperature,
      journal: lines(locus),
      facts: [...facts],
      count: slots * WRITE_PER_SLOT,
    });
    if (w.call) out.calls.push(w.call);
    const tried = new Set(ctx.rows.filter((r) => r.locus === locus).map((r) => r.allele));
    const kept: { text: string; option: Option; key: string }[] = [];
    const dropped: { text: string; why: string[] }[] = [];
    for (const text of w.options) {
      const c = checkCandidate(text, {
        facts,
        siblings: view.alleles.map((a) => a.text),
        tried,
      });
      if (c.ok) {
        tried.add(c.key);
        kept.push({ text: text.trim(), option: c.option, key: c.key });
      } else dropped.push({ text, why: c.why });
    }
    let picked: (typeof results)[number]["picked"] = [];
    let error = w.error;
    if (kept.length > 0) {
      const j = await runJudge(judge, {
        locus: view,
        candidates: kept.map((k) => k.text),
        mode: plan.mode,
      });
      if (j.call) out.calls.push(j.call);
      error ??= j.error;
      const byText = new Map(kept.map((k) => [k.text, k]));
      picked = j.ranked.slice(0, slots).map((r) => ({
        ...(byText.get(r.text) as (typeof kept)[number]),
        score: r.score,
        angle: r.angle,
      }));
    }
    results.push({ locus, written: w.options, dropped, picked, error });
  }

  const origin = opts.origin ?? "mutation";
  await serializable(db, async (tx) => {
    out.queued = []; // level 4 can rerun the body
    const [exp] = await tx.select().from(experiments).where(eq(experiments.id, id)).for("update");
    if (!exp || !(GENOME_STATES as readonly string[]).includes(exp.state)) return;
    const generation = await generationOf(tx, id);
    await journal(tx, id, generation, "strategist", {
      mode: plan.mode,
      loci: plan.loci,
      mutation: plan.mutation,
      temperature: plan.temperature,
      reason: plan.reason,
      fallback: plan.fallback,
      origin,
      models: settings.models,
    });
    for (const r of results) {
      await journal(
        tx,
        id,
        generation,
        "check",
        { written: r.written.length, dropped: r.dropped, ...(r.error ? { error: r.error } : {}) },
        r.locus,
      );
      if (r.picked.length > 0) {
        await journal(
          tx,
          id,
          generation,
          "judge",
          { scores: r.picked.map((p) => ({ text: p.text, score: p.score, angle: p.angle })) },
          r.locus,
        );
      }
      for (const p of r.picked) {
        const journalId = await journal(
          tx,
          id,
          generation,
          "candidate",
          {
            allele: p.key,
            text: p.text,
            score: p.score,
            angle: p.angle,
            mode: plan.mode,
            mutation: plan.mutation,
            reason: plan.reason,
          },
          r.locus,
        );
        const [row] = await tx
          .insert(experimentAlleles)
          .values({
            experimentId: id,
            locus: r.locus,
            allele: p.key,
            text: p.text,
            state: "candidate",
            origin,
            journalId,
            angle: p.angle,
            judgeScore: p.score,
            bornVersion: ctx.genome.version,
          })
          .onConflictDoNothing()
          .returning({ id: experimentAlleles.id });
        if (row) out.queued.push({ id: row.id, locus: r.locus, allele: p.key, text: p.text });
      }
    }
  });
  out.loci = results.map((r) => ({
    locus: r.locus,
    written: r.written.length,
    checked: r.written.length - r.dropped.length,
    queued: out.queued.filter((q) => q.locus === r.locus).length,
    error: r.error,
  }));
  if (settings.autoApprove) {
    for (const q of out.queued) {
      await approveCandidate(db, q.id, { by: "auto" });
      out.approved++;
    }
  }
  return out;
}

export interface Decision {
  experiment: number;
  niche: string;
  template: string;
  locus: string;
  allele: string;
  /** The genome version after the decision (unchanged by a reject). */
  version: string;
}

async function candidateRow(tx: Queryable, alleleId: number) {
  const [row] = await tx
    .select()
    .from(experimentAlleles)
    .where(eq(experimentAlleles.id, alleleId))
    .for("update");
  if (!row) throw new Error(`no candidate ${alleleId}`);
  if (row.state !== "candidate")
    throw new Error(`allele ${alleleId} is ${row.state}, not a candidate`);
  return row;
}

/**
 * Put new options live at their loci in one genome change. Returns the new genome.
 * Each option's text must already have passed the checker.
 */
async function addAlleles(
  tx: Queryable,
  exp: Experiment,
  genome: Template,
  adds: readonly { locus: string; option: Option }[],
): Promise<Template> {
  const next = asGenome(
    mapPoints(genome, (p) => {
      const more = adds.filter((a) => a.locus === p.name).map((a) => a.option);
      return more.length ? variants(p.name, [...p.options, ...more], undefined, true) : p;
    }),
  );
  await recordVersion(tx, exp.niche, next, { parent: genome.version, experimentId: exp.id });
  await tx.update(experiments).set({ liveVersion: next.version }).where(eq(experiments.id, exp.id));
  return next;
}

/**
 * Approve a candidate, optionally with William's edit of its words. It goes live in a
 * new genome version. Re-render the niche's queue afterwards.
 */
export async function approveCandidate(
  db: Db,
  alleleId: number,
  opts: { by: string; text?: string },
): Promise<Decision> {
  return serializable(db, async (tx) => {
    const row = await candidateRow(tx, alleleId);
    const [exp] = await tx
      .select()
      .from(experiments)
      .where(eq(experiments.id, row.experimentId))
      .for("update");
    if (!exp || !(GENOME_STATES as readonly string[]).includes(exp.state))
      throw new Error(
        `experiment ${row.experimentId} is ${exp?.state ?? "gone"}: nothing to approve into`,
      );
    const genome = await versionTemplate(tx, exp.niche, exp.template, exp.liveVersion);
    if (!genome || !points(genome).some((p) => p.name === row.locus))
      throw new Error(`locus ${row.locus} is no longer in experiment ${exp.id}'s genome`);
    const edited = opts.text !== undefined && opts.text.trim() !== row.text;
    let option: Option;
    let key = row.allele;
    let text = row.text;
    if (edited) {
      const others = await tx
        .select({ allele: experimentAlleles.allele })
        .from(experimentAlleles)
        .where(
          and(
            eq(experimentAlleles.experimentId, exp.id),
            eq(experimentAlleles.locus, row.locus),
            sql`${experimentAlleles.id} <> ${row.id}`,
          ),
        );
      // William's own words: the rules hold, the length band is his call.
      const c = checkCandidate(opts.text as string, {
        facts: factKeys(genome),
        siblings: [],
        tried: new Set(others.map((o) => o.allele)),
      });
      if (!c.ok) throw new Error(`edit refused: ${c.why.join("; ")}`);
      option = c.option;
      key = c.key;
      text = (opts.text as string).trim();
    } else option = parseOption(row.text);
    const generation = await generationOf(tx, exp.id);
    if (edited) {
      await journal(
        tx,
        exp.id,
        generation,
        "edit",
        { allele: key, from_allele: row.allele, from_text: row.text, text, by: opts.by },
        row.locus,
      );
    }
    const next = await addAlleles(tx, exp, genome, [{ locus: row.locus, option }]);
    await tx
      .update(experimentAlleles)
      .set({
        allele: key,
        text,
        state: "live",
        decidedBy: opts.by,
        decidedAt: new Date(),
        bornVersion: next.version,
      })
      .where(eq(experimentAlleles.id, row.id));
    await journal(
      tx,
      exp.id,
      generation,
      "approve",
      { allele: key, text, by: opts.by, version_from: genome.version, version_to: next.version },
      row.locus,
    );
    return {
      experiment: exp.id,
      niche: exp.niche,
      template: exp.template,
      locus: row.locus,
      allele: key,
      version: next.version,
    };
  });
}

/** Reject a candidate: it never goes live, and the writer sees it was turned down. */
export async function rejectCandidate(
  db: Db,
  alleleId: number,
  opts: { by: string },
): Promise<Decision> {
  return serializable(db, async (tx) => {
    const row = await candidateRow(tx, alleleId);
    const exp = await getExperiment(tx, row.experimentId);
    await tx
      .update(experimentAlleles)
      .set({ state: "rejected", decidedBy: opts.by, decidedAt: new Date() })
      .where(eq(experimentAlleles.id, row.id));
    const generation = await generationOf(tx, exp.id);
    await journal(
      tx,
      exp.id,
      generation,
      "reject",
      { allele: row.allele, text: row.text, by: opts.by },
      row.locus,
    );
    if (row.journalId !== null) {
      await tx
        .update(experimentJournal)
        .set({ outcome: { state: "rejected", by: opts.by } })
        .where(eq(experimentJournal.id, row.journalId));
    }
    return {
      experiment: exp.id,
      niche: exp.niche,
      template: exp.template,
      locus: row.locus,
      allele: row.allele,
      version: exp.liveVersion,
    };
  });
}

export interface CandidateView {
  id: number;
  experiment: number;
  niche: string;
  template: string;
  locus: string;
  allele: string;
  text: string;
  origin: string;
  angle: string | null;
  judgeScore: number | null;
  /** The strategist's reason the writer wrote it. */
  reason: string | null;
  createdAt: Date;
  /** The live alleles at its locus, best first. */
  winners: { allele: string; text: string; pBest: number | null }[];
}

/** Every candidate waiting on William, oldest first. */
export async function listCandidates(
  db: Queryable,
  opts: { experiment?: number } = {},
): Promise<CandidateView[]> {
  const rows = await db
    .select({
      a: experimentAlleles,
      niche: experiments.niche,
      template: experiments.template,
      detail: experimentJournal.detail,
    })
    .from(experimentAlleles)
    .innerJoin(experiments, eq(experiments.id, experimentAlleles.experimentId))
    .leftJoin(experimentJournal, eq(experimentJournal.id, experimentAlleles.journalId))
    .where(
      and(
        eq(experimentAlleles.state, "candidate"),
        opts.experiment !== undefined
          ? eq(experimentAlleles.experimentId, opts.experiment)
          : undefined,
      ),
    )
    .orderBy(experimentAlleles.id);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.a.experimentId))];
  const live = await db
    .select()
    .from(experimentAlleles)
    .where(and(inArray(experimentAlleles.experimentId, ids), eq(experimentAlleles.state, "live")));
  const snaps = await db
    .selectDistinctOn([experimentSnapshots.experimentId], {
      experimentId: experimentSnapshots.experimentId,
      pBest: experimentSnapshots.pBest,
    })
    .from(experimentSnapshots)
    .where(inArray(experimentSnapshots.experimentId, ids))
    .orderBy(experimentSnapshots.experimentId, desc(experimentSnapshots.generation));
  const pBestOf = new Map(
    snaps.map((s) => [s.experimentId, (s.pBest ?? {}) as Record<string, Record<string, number>>]),
  );
  return rows.map(({ a, niche, template, detail }) => {
    const p = pBestOf.get(a.experimentId)?.[a.locus] ?? {};
    const reason = (detail as Record<string, unknown> | null)?.reason;
    return {
      id: a.id,
      experiment: a.experimentId,
      niche,
      template,
      locus: a.locus,
      allele: a.allele,
      text: a.text,
      origin: a.origin,
      angle: a.angle,
      judgeScore: a.judgeScore,
      reason: typeof reason === "string" ? reason : null,
      createdAt: a.createdAt,
      winners: live
        .filter((l) => l.experimentId === a.experimentId && l.locus === a.locus)
        .map((l) => ({ allele: l.allele, text: l.text, pBest: p[l.allele] ?? null }))
        .sort((x, y) => (y.pBest ?? 0) - (x.pBest ?? 0)),
    };
  });
}

/**
 * Seeding past the template's own options, run right after `startExperiment`.
 * `llm_seed`: the writer adds `queueSize` candidates per locus (William approves them
 * like any other). `from_winners`: each locus of experiment `from` with a best allele
 * puts it live at the locus of the same name here, in one genome change.
 */
export async function seedExperiment(
  db: Db,
  id: number,
  opts: { llmFor?: LlmFor; from?: number },
): Promise<{ queued: number; imported: number; skipped: number }> {
  const exp = await getExperiment(db, id);
  const settings = parseSettings(exp.settings);
  if (settings.seeding === "llm_seed") {
    if (!opts.llmFor) throw new Error("llm_seed needs a model");
    const ctx = await contextOf(db, id);
    const proposal = await proposeCandidates(db, id, opts.llmFor, {
      origin: "seed",
      plan: {
        mode: "explore",
        loci: writableLoci(ctx),
        mutation: "new_angle",
        temperature: 0.7,
        reason: "llm_seed",
        fallback: false,
      },
    });
    return { queued: proposal.queued.length, imported: 0, skipped: 0 };
  }
  if (settings.seeding === "from_winners") {
    if (opts.from === undefined)
      throw new Error("from_winners needs the experiment to take winners from");
    return importWinners(db, id, opts.from);
  }
  return { queued: 0, imported: 0, skipped: 0 };
}

async function importWinners(
  db: Db,
  id: number,
  from: number,
): Promise<{ queued: number; imported: number; skipped: number }> {
  const source = await contextOf(db, from);
  return serializable(db, async (tx) => {
    const [exp] = await tx.select().from(experiments).where(eq(experiments.id, id)).for("update");
    if (!exp) throw new Error(`no experiment ${id}`);
    const genome = await versionTemplate(tx, exp.niche, exp.template, exp.liveVersion);
    if (!genome) throw new Error(`experiment ${id}: live version not on file`);
    const facts = factKeys(genome);
    const here = new Map(points(genome).map((p) => [p.name, new Set(p.options.map(alleleKey))]));
    const adds: { locus: string; option: Option; allele: string; text: string }[] = [];
    const skipped: { locus: string; text: string; why: string[] }[] = [];
    for (const l of source.loci) {
      const keys = here.get(l.locus);
      const best = [...l.alleles].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0];
      if (!keys || !best || best.pBest === null) continue;
      const text = source.rows.find((r) => r.locus === l.locus && r.allele === best.allele)?.text;
      if (!text) continue;
      const c = checkCandidate(text, { facts, siblings: [], tried: keys });
      if (c.ok) adds.push({ locus: l.locus, option: c.option, allele: c.key, text });
      else skipped.push({ locus: l.locus, text, why: c.why });
    }
    const generation = await generationOf(tx, id);
    const next = adds.length > 0 ? await addAlleles(tx, exp, genome, adds) : genome;
    const seedId = await journal(tx, id, generation, "seed", {
      seeding: "from_winners",
      from,
      added: Object.fromEntries(adds.map((a) => [a.locus, a.allele])),
      skipped,
    });
    if (adds.length > 0) {
      await tx.insert(experimentAlleles).values(
        adds.map((a) => ({
          experimentId: id,
          locus: a.locus,
          allele: a.allele,
          text: a.text,
          state: "live" as const,
          origin: "import" as const,
          journalId: seedId,
          bornVersion: next.version,
        })),
      );
    }
    return { queued: 0, imported: adds.length, skipped: skipped.length };
  });
}
