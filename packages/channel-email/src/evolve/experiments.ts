/**
 * Copy experiments, the email binding (designs/2026-10-04-copy-evolution.md). A
 * running experiment owns one template of a niche: compose renders its live genome
 * (a `template_versions` row) in place of the file, drawing each locus along the
 * newest snapshot's shares. A tick imports a file edit, counts, retires, snapshots
 * and settles, and journals every step. No LLM here: the tiers are candidates.ts.
 */

import { type Db, type Queryable, serializable } from "@wren/db";
import {
  type AlleleCounts,
  evaluateLocus,
  type LocusResult,
  parseSettings,
  type Settings,
  stopReason,
  withSetting,
} from "@wren/experiments";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  type Allocation,
  alleleKey,
  optionText,
  type Template,
  type VariantsBlock,
  variants,
} from "../outreach/templates.js";
import { type Experiment, experimentAlleles, experimentSnapshots, experiments } from "../schema.js";
import {
  asGenome,
  fillOutcome,
  generationOf,
  journal,
  mapPoints,
  points,
  recordVersion,
  versionTemplate,
  ZERO,
} from "./genome.js";
import { alleleStats } from "./stats.js";

/** States whose genome compose renders. A stopped experiment hands the template back to the file. */
export const GENOME_STATES = ["running", "paused", "settled"] as const;
/** Who decided a retirement or a settle the tick made. */
const BY = "evolution";

export async function getExperiment(db: Queryable, id: number): Promise<Experiment> {
  const [row] = await db.select().from(experiments).where(eq(experiments.id, id));
  if (!row) throw new Error(`no experiment ${id}`);
  return row;
}

/**
 * Start evolving `file`: name its points, write the genome, seed its options as live
 * alleles. `llm_seed` and `from_winners` add to that afterwards (`seedExperiment`).
 */
export async function startExperiment(
  db: Db,
  opts: { niche: string; file: Template; settings?: unknown },
): Promise<Experiment> {
  const settings = parseSettings(opts.settings);
  const genome = asGenome(opts.file);
  if (points(genome).length === 0) {
    throw new Error(`template ${opts.file.name} has no [[variant]] point to evolve`);
  }
  return serializable(db, async (tx) => {
    const [open] = await tx
      .select({ id: experiments.id })
      .from(experiments)
      .where(
        and(
          eq(experiments.niche, opts.niche),
          eq(experiments.template, opts.file.name),
          ne(experiments.state, "stopped"),
        ),
      );
    if (open) throw new Error(`experiment ${open.id} already holds ${opts.file.name}`);
    const [exp] = await tx
      .insert(experiments)
      .values({
        niche: opts.niche,
        template: opts.file.name,
        state: "running",
        liveVersion: genome.version,
        fileVersion: opts.file.version,
        settings,
      })
      .returning();
    const e = exp as Experiment;
    await recordVersion(tx, opts.niche, opts.file, { parent: null, experimentId: null });
    await recordVersion(tx, opts.niche, genome, { parent: opts.file.version, experimentId: e.id });
    await journal(tx, e.id, 0, "start", {
      settings,
      file_version: opts.file.version,
      genome_version: genome.version,
    });
    const loci = points(genome);
    const seeded = Object.fromEntries(loci.map((p) => [p.name, p.options.map(alleleKey)]));
    const seedId = await journal(tx, e.id, 0, "seed", { seeding: "from_template", loci: seeded });
    await tx
      .insert(experimentAlleles)
      .values(
        loci.flatMap((p) =>
          p.options.map((o) => ({
            experimentId: e.id,
            locus: p.name,
            allele: alleleKey(o),
            text: optionText(o),
            state: "live" as const,
            origin: "seed" as const,
            journalId: seedId,
            bornVersion: genome.version,
          })),
        ),
      )
      .onConflictDoNothing();
    return e;
  });
}

/**
 * Bring a file edit into the genome (a `manual` mutation). A point is matched by its
 * written name, else by sharing an allele with a locus; else it is a new locus.
 * Against the last imported file: new options go live, dropped ones retire. The
 * fixed text comes from the file. Returns the new genome, or null with no edit.
 */
async function importFile(
  tx: Queryable,
  exp: Experiment,
  file: Template,
  genome: Template,
  generation: number,
): Promise<Template | null> {
  if (file.version === exp.fileVersion) return null;
  const known = await tx
    .select({ locus: experimentAlleles.locus, allele: experimentAlleles.allele })
    .from(experimentAlleles)
    .where(eq(experimentAlleles.experimentId, exp.id));
  const locusOf = new Map(known.map((k) => [k.allele, k.locus]));
  const loci = new Set(known.map((k) => k.locus));
  const matcher = () => {
    const claimed = new Set<string>();
    return (p: VariantsBlock): string => {
      let locus: string | undefined = p.named ? p.name : undefined;
      locus ??= p.options.map((o) => locusOf.get(alleleKey(o))).find((l) => l !== undefined);
      if (locus === undefined || claimed.has(locus)) {
        locus = p.name;
        for (let n = 1; claimed.has(locus) || (loci.has(locus) && !p.named); n++) locus = `v${n}`;
      }
      claimed.add(locus);
      return locus;
    };
  };
  const old = await versionTemplate(tx, exp.niche, exp.template, exp.fileVersion);
  const oldKeys = new Map<string, Set<string>>();
  if (old) {
    const match = matcher();
    for (const p of points(old)) oldKeys.set(match(p), new Set(p.options.map(alleleKey)));
  }
  const live = new Map(points(genome).map((p) => [p.name, p]));
  const match = matcher();
  const added: Record<string, string[]> = {};
  const next = mapPoints(file, (p) => {
    const locus = match(p);
    const before = oldKeys.get(locus) ?? new Set<string>();
    const fileKeys = new Set(p.options.map(alleleKey));
    const kept = (live.get(locus)?.options ?? []).filter(
      (o) => !before.has(alleleKey(o)) || fileKeys.has(alleleKey(o)),
    );
    const keptKeys = new Set(kept.map(alleleKey));
    const fresh = p.options.filter((o) => !before.has(alleleKey(o)) && !keptKeys.has(alleleKey(o)));
    const options = kept.length + fresh.length > 0 ? [...kept, ...fresh] : p.options;
    added[locus] = fresh.map(alleleKey);
    return variants(locus, options, undefined, true);
  });
  const genomeNext = asGenome(next);
  const retired = await syncAlleles(tx, exp, genomeNext, "import", generation);
  await recordVersion(tx, exp.niche, file, { parent: null, experimentId: null });
  await recordVersion(tx, exp.niche, genomeNext, { parent: exp.liveVersion, experimentId: exp.id });
  await journal(tx, exp.id, generation, "import", {
    file_from: exp.fileVersion,
    file_to: file.version,
    genome_from: exp.liveVersion,
    genome_to: genomeNext.version,
    added,
    retired,
  });
  await tx
    .update(experiments)
    .set({ fileVersion: file.version, liveVersion: genomeNext.version })
    .where(eq(experiments.id, exp.id));
  return genomeNext;
}

/** Make the allele rows match `genome`: its options live, every other live one retired. */
async function syncAlleles(
  tx: Queryable,
  exp: Experiment,
  genome: Template,
  reason: string,
  generation: number,
): Promise<Record<string, string[]>> {
  const rows = await tx
    .select()
    .from(experimentAlleles)
    .where(eq(experimentAlleles.experimentId, exp.id));
  const wanted = new Map<string, VariantsBlock["options"][number]>();
  for (const p of points(genome))
    for (const o of p.options) wanted.set(`${p.name}\x00${alleleKey(o)}`, o);
  const retired: Record<string, string[]> = {};
  const now = new Date();
  for (const r of rows) {
    const key = `${r.locus}\x00${r.allele}`;
    if (r.state === "live" && !wanted.has(key)) {
      retired[r.locus] = [...(retired[r.locus] ?? []), r.allele];
      await tx
        .update(experimentAlleles)
        .set({ state: "retired", retiredReason: reason, decidedBy: BY, decidedAt: now })
        .where(eq(experimentAlleles.id, r.id));
    } else if (r.state !== "live" && wanted.has(key)) {
      await tx
        .update(experimentAlleles)
        .set({ state: "live", retiredReason: null, decidedBy: BY, decidedAt: now })
        .where(eq(experimentAlleles.id, r.id));
    }
    wanted.delete(key);
  }
  for (const [key, option] of wanted) {
    const [locus, allele] = key.split("\x00") as [string, string];
    await tx.insert(experimentAlleles).values({
      experimentId: exp.id,
      locus,
      allele,
      text: optionText(option),
      state: "live",
      origin: "import",
      bornVersion: genome.version,
    });
  }
  if (Object.keys(retired).length > 0) {
    await journal(tx, exp.id, generation, "retire", { reason, alleles: retired });
  }
  return retired;
}

/** Per locus, what the tick concluded beside the selection and fitness it ran under. */
interface LocusStrategy {
  selection: Settings["selection"];
  fitness: LocusResult["fitness"];
  best: string | null;
  settled: boolean;
  stagnant: boolean;
}

export interface EvolveTick {
  experiment: number;
  generation: number;
  snapshot: number;
  imported: boolean;
  /** The genome changed: queued drafts on the old one need a refresh. */
  genomeChanged: boolean;
  retired: { locus: string; allele: string; reason: string }[];
  settled: string[];
  stagnant: string[];
  stopped: string | null;
}

/**
 * One tick of one running experiment, in one transaction: import a file edit, count,
 * retire, snapshot the shares of what is live, settle. Null when it is not running.
 */
export async function tickExperiment(
  db: Db,
  id: number,
  file: Template | undefined,
): Promise<EvolveTick | null> {
  return serializable(db, async (tx) => {
    const [exp] = await tx.select().from(experiments).where(eq(experiments.id, id)).for("update");
    if (exp?.state !== "running") return null;
    const settings = parseSettings(exp.settings);
    const generation = (await generationOf(tx, exp.id)) + 1;
    let genome = await versionTemplate(tx, exp.niche, exp.template, exp.liveVersion);
    if (!genome) throw new Error(`experiment ${id}: live version ${exp.liveVersion} not on file`);
    const startVersion = genome.version;
    const imported = file ? await importFile(tx, exp, file, genome, generation) : null;
    genome = imported ?? genome;

    const stats = await alleleStats(tx, exp.niche, exp.template);
    const rows = await tx
      .select({
        locus: experimentAlleles.locus,
        allele: experimentAlleles.allele,
        state: experimentAlleles.state,
      })
      .from(experimentAlleles)
      .where(
        and(
          eq(experimentAlleles.experimentId, exp.id),
          inArray(experimentAlleles.state, ["live", "retired"]),
        ),
      );
    const prior = await tx
      .select({ strategies: experimentSnapshots.strategies })
      .from(experimentSnapshots)
      .where(eq(experimentSnapshots.experimentId, exp.id))
      .orderBy(desc(experimentSnapshots.generation))
      .limit(settings.window);
    const before = prior.map((s) => s.strategies as Record<string, LocusStrategy>).reverse();

    const results = points(genome).map((p) => {
      const alleles = [...new Set(p.options.map(alleleKey))];
      const byAllele = stats.get(p.name);
      return evaluateLocus(
        {
          locus: p.name,
          alleles,
          counts: alleles.map((a) => byAllele?.get(a) ?? ZERO),
          tried: rows.filter((r) => r.locus === p.name).length,
          history: before.map((s) => s[p.name]?.best ?? null),
        },
        settings,
      );
    });

    const retired = results.flatMap((r) =>
      r.retire.map((x) => ({ locus: r.locus, allele: x.allele, reason: x.reason })),
    );
    if (retired.length > 0) {
      const gone = new Set(retired.map((r) => `${r.locus}\x00${r.allele}`));
      const next = asGenome(
        mapPoints(genome, (p) =>
          variants(
            p.name,
            p.options.filter((o) => !gone.has(`${p.name}\x00${alleleKey(o)}`)),
            undefined,
            true,
          ),
        ),
      );
      const now = new Date();
      for (const r of results) {
        for (const x of r.retire) {
          const outcome = { ...byKey(stats, r.locus, x.allele), p_best: r.pBest[x.allele] ?? 0 };
          await journal(
            tx,
            exp.id,
            generation,
            "retire",
            { allele: x.allele, reason: x.reason },
            r.locus,
            outcome,
          );
          await fillOutcome(tx, exp.id, r.locus, x.allele, { ...outcome, state: "retired" });
          await tx
            .update(experimentAlleles)
            .set({ state: "retired", retiredReason: x.reason, decidedBy: BY, decidedAt: now })
            .where(
              and(
                eq(experimentAlleles.experimentId, exp.id),
                eq(experimentAlleles.locus, r.locus),
                eq(experimentAlleles.allele, x.allele),
              ),
            );
        }
      }
      await recordVersion(tx, exp.niche, next, { parent: genome.version, experimentId: exp.id });
      await tx
        .update(experiments)
        .set({ liveVersion: next.version })
        .where(eq(experiments.id, exp.id));
      genome = next;
    }

    const strategies: Record<string, LocusStrategy> = {};
    for (const r of results) {
      strategies[r.locus] = {
        selection: settings.selection,
        fitness: r.fitness,
        best: r.best,
        settled: r.settled,
        stagnant: r.stagnant,
      };
    }
    const [snap] = await tx
      .insert(experimentSnapshots)
      .values({
        experimentId: exp.id,
        generation,
        stats: Object.fromEntries(
          results.map((r) => [
            r.locus,
            Object.fromEntries(Object.keys(r.pBest).map((a) => [a, byKey(stats, r.locus, a)])),
          ]),
        ),
        shares: Object.fromEntries(results.map((r) => [r.locus, r.shares])),
        pBest: Object.fromEntries(results.map((r) => [r.locus, r.pBest])),
        strategies,
      })
      .returning({ id: experimentSnapshots.id });
    const snapshot = (snap as { id: number }).id;
    const last = before.at(-1);
    const settled = results.filter((r) => r.settled).map((r) => r.locus);
    const stagnant = results.filter((r) => r.stagnant).map((r) => r.locus);
    await journal(tx, exp.id, generation, "snapshot", { snapshot, settled, stagnant });
    for (const r of results) {
      if (r.settled && !last?.[r.locus]?.settled) {
        const outcome = {
          ...byKey(stats, r.locus, r.best ?? ""),
          p_best: r.best ? (r.pBest[r.best] ?? 0) : 0,
        };
        await journal(tx, exp.id, generation, "settle", { allele: r.best }, r.locus, outcome);
        if (r.best)
          await fillOutcome(tx, exp.id, r.locus, r.best, { ...outcome, state: "settled" });
      }
    }
    const stop = stopReason(results);
    if (stop) {
      await tx
        .update(experiments)
        .set({ state: "settled", stopReason: stop, stoppedAt: new Date() })
        .where(eq(experiments.id, exp.id));
      await journal(tx, exp.id, generation, "stop", { reason: stop });
    }
    return {
      experiment: exp.id,
      generation,
      snapshot,
      imported: imported !== null,
      genomeChanged: genome.version !== startVersion,
      retired,
      settled,
      stagnant,
      stopped: stop,
    };
  });
}

const byKey = (stats: Awaited<ReturnType<typeof alleleStats>>, locus: string, allele: string) =>
  stats.get(locus)?.get(allele) ?? ZERO;

/** The running experiments, oldest first, with their newest snapshot's time: what the daily tick walks. */
export async function runningExperiments(
  db: Queryable,
): Promise<{ id: number; niche: string; template: string; lastTick: Date | null }[]> {
  const rows = await db
    .select({
      id: experiments.id,
      niche: experiments.niche,
      template: experiments.template,
      lastTick: sql<string | null>`(
        SELECT max(s.taken_at) FROM experiment_snapshots s WHERE s.experiment_id = ${experiments.id})`,
    })
    .from(experiments)
    .where(eq(experiments.state, "running"))
    .orderBy(experiments.id);
  return rows.map((r) => ({ ...r, lastTick: r.lastTick === null ? null : new Date(r.lastTick) }));
}

/**
 * The niche's templates as compose should render them: each experiment's live genome
 * in place of its file, plus the newest snapshot's shares by option (the floor for an
 * option newer than the snapshot). With no
 * experiment, the files and no allocations: compose works exactly as before.
 */
export async function experimentTemplates(
  db: Queryable,
  niche: string,
  files: ReadonlyMap<string, Template>,
): Promise<{
  templates: ReadonlyMap<string, Template>;
  allocations: ReadonlyMap<string, Allocation>;
}> {
  const rows = await db
    .select({
      id: experiments.id,
      template: experiments.template,
      liveVersion: experiments.liveVersion,
      settings: experiments.settings,
      snapshot: sql<number | null>`(
        SELECT s.id FROM experiment_snapshots s WHERE s.experiment_id = ${experiments.id}
        ORDER BY s.generation DESC LIMIT 1)`,
      shares: sql<Record<string, Record<string, number>> | null>`(
        SELECT s.shares FROM experiment_snapshots s WHERE s.experiment_id = ${experiments.id}
        ORDER BY s.generation DESC LIMIT 1)`,
    })
    .from(experiments)
    .where(and(eq(experiments.niche, niche), inArray(experiments.state, [...GENOME_STATES])));
  if (rows.length === 0) return { templates: files, allocations: new Map() };
  const templates = new Map(files);
  const allocations = new Map<string, Allocation>();
  for (const r of rows) {
    if (!files.has(r.template)) continue;
    const genome = await versionTemplate(db, niche, r.template, r.liveVersion);
    if (!genome) continue;
    templates.set(r.template, genome);
    if (r.snapshot === null || r.shares === null) continue;
    const shares = r.shares;
    // An allele approved since the snapshot starts at the floor; the next tick prices it.
    const floor = parseSettings(r.settings).floor;
    allocations.set(r.template, {
      snapshot: Number(r.snapshot),
      shares: Object.fromEntries(
        points(genome).map((p) => [
          p.name,
          p.options.map((o) => shares[p.name]?.[alleleKey(o)] ?? floor),
        ]),
      ),
    });
  }
  return { templates, allocations };
}

/** Change one setting (`guards.negativeRatio=3` reaches inside); validated, then journaled. */
export async function switchSetting(
  db: Db,
  id: number,
  key: string,
  value: unknown,
): Promise<Settings> {
  return serializable(db, async (tx) => {
    const exp = await getExperiment(tx, id);
    const current = parseSettings(exp.settings);
    const settings = withSetting(current, key, value);
    const from = key
      .split(".")
      .reduce<unknown>((at, k) => (at as Record<string, unknown>)?.[k], current);
    await tx.update(experiments).set({ settings }).where(eq(experiments.id, id));
    await journal(tx, id, await generationOf(tx, id), "switch", { key, from, to: value });
    return settings;
  });
}

const MOVES = {
  pause: { from: ["running"], to: "paused" },
  resume: { from: ["paused", "settled"], to: "running" },
  stop: { from: ["running", "paused", "settled"], to: "stopped" },
} as const;

/**
 * pause: no ticks, the genome and last shares stay. resume: ticking again (also after a
 * settle, say once `maxAlleles` is raised). stop: William's, final; the file takes the
 * template back.
 */
export async function moveExperiment(
  db: Db,
  id: number,
  move: keyof typeof MOVES,
): Promise<Experiment> {
  return serializable(db, async (tx) => {
    const exp = await getExperiment(tx, id);
    const { from, to } = MOVES[move];
    if (!(from as readonly string[]).includes(exp.state)) {
      throw new Error(`experiment ${id} is ${exp.state}: cannot ${move}`);
    }
    const [row] = await tx
      .update(experiments)
      .set(
        to === "stopped"
          ? { state: to, stopReason: "stopped", stoppedAt: new Date() }
          : { state: to, ...(to === "running" ? { stopReason: null, stoppedAt: null } : {}) },
      )
      .where(eq(experiments.id, id))
      .returning();
    await journal(tx, id, await generationOf(tx, id), move === "stop" ? "stop" : move, {
      from: exp.state,
      ...(move === "stop" ? { reason: "stopped" } : {}),
    });
    return row as Experiment;
  });
}

export interface ExperimentStatus {
  experiment: Experiment;
  generation: number;
  takenAt: Date | null;
  loci: {
    locus: string;
    best: string | null;
    settled: boolean;
    stagnant: boolean;
    alleles: {
      allele: string;
      text: string;
      state: string;
      origin: string;
      share: number | null;
      pBest: number | null;
      counts: AlleleCounts;
    }[];
  }[];
}

/** Each experiment as of its newest snapshot: per locus, every allele's state, share and counts. */
export async function experimentStatus(
  db: Queryable,
  opts: { id?: number; all?: boolean } = {},
): Promise<ExperimentStatus[]> {
  const list = await db
    .select()
    .from(experiments)
    .where(
      opts.id !== undefined
        ? eq(experiments.id, opts.id)
        : opts.all
          ? undefined
          : ne(experiments.state, "stopped"),
    )
    .orderBy(experiments.id);
  const out: ExperimentStatus[] = [];
  for (const exp of list) {
    const [snap] = await db
      .select()
      .from(experimentSnapshots)
      .where(eq(experimentSnapshots.experimentId, exp.id))
      .orderBy(desc(experimentSnapshots.generation))
      .limit(1);
    const alleles = await db
      .select()
      .from(experimentAlleles)
      .where(eq(experimentAlleles.experimentId, exp.id))
      .orderBy(experimentAlleles.id);
    const stats = (snap?.stats ?? {}) as Record<string, Record<string, AlleleCounts>>;
    const shares = (snap?.shares ?? {}) as Record<string, Record<string, number>>;
    const pBest = (snap?.pBest ?? {}) as Record<string, Record<string, number>>;
    const strategies = (snap?.strategies ?? {}) as Record<string, LocusStrategy>;
    const loci = [...new Set(alleles.map((a) => a.locus))].map((locus) => ({
      locus,
      best: strategies[locus]?.best ?? null,
      settled: strategies[locus]?.settled ?? false,
      stagnant: strategies[locus]?.stagnant ?? false,
      alleles: alleles
        .filter((a) => a.locus === locus)
        .map((a) => ({
          allele: a.allele,
          text: a.text,
          state: a.state,
          origin: a.origin,
          share: shares[locus]?.[a.allele] ?? null,
          pBest: pBest[locus]?.[a.allele] ?? null,
          counts: stats[locus]?.[a.allele] ?? ZERO,
        })),
    }));
    out.push({
      experiment: exp,
      generation: snap?.generation ?? 0,
      takenAt: snap?.takenAt ?? null,
      loci,
    });
  }
  return out;
}
