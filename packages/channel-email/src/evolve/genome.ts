/**
 * Genome plumbing shared by experiments and candidates: points, versions, the journal.
 * Internal to the evolve binding; not exported from the package.
 */
import type { Queryable } from "@wren/db";
import type { AlleleCounts } from "@wren/experiments";
import { and, eq, sql } from "drizzle-orm";
import { parseTemplate, toSource } from "../outreach/authoring.js";
import {
  type Block,
  group,
  type Template,
  template,
  type VariantsBlock,
  variantPoints,
} from "../outreach/templates.js";
import { experimentJournal, experimentSnapshots, templateVersions } from "../schema.js";

export const ZERO: AlleleCounts = {
  exposures: 0,
  replies: 0,
  interested: 0,
  booked: 0,
  opens: 0,
  tracked: 0,
  negatives: 0,
};

export const points = (tpl: Template) => [...variantPoints([...(tpl.subject ?? []), ...tpl.body])];

/** The template with every point passed through `f`. */
export function mapPoints(tpl: Template, f: (p: VariantsBlock) => VariantsBlock): Template {
  const walk = (blocks: readonly Block[]): Block[] =>
    blocks.map((b) =>
      b.kind === "variants"
        ? f(b)
        : b.kind === "group"
          ? group(walk(b.blocks) as Parameters<typeof group>[0])
          : b,
    );
  return template(tpl.name, tpl.subject === null ? null : walk(tpl.subject), walk(tpl.body));
}

/** The canonical genome: every point named, so its loci keep their keys. */
export const asGenome = (tpl: Template) =>
  parseTemplate(tpl.name, toSource(tpl, { nameAll: true }));

export async function recordVersion(
  db: Queryable,
  niche: string,
  tpl: Template,
  lineage: { parent: string | null; experimentId: number | null },
): Promise<void> {
  await db
    .insert(templateVersions)
    .values({
      niche,
      template: tpl.name,
      version: tpl.version,
      source: toSource(tpl),
      parentVersion: lineage.parent,
      experimentId: lineage.experimentId,
    })
    .onConflictDoNothing();
}

// Parsed once per version: sources never change under a version.
const parsed = new Map<string, Template>();
export async function versionTemplate(
  db: Queryable,
  niche: string,
  name: string,
  version: string,
): Promise<Template | null> {
  const key = `${niche}\x00${name}\x00${version}`;
  const hit = parsed.get(key);
  if (hit) return hit;
  const [row] = await db
    .select({ source: templateVersions.source })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.niche, niche),
        eq(templateVersions.template, name),
        eq(templateVersions.version, version),
      ),
    );
  if (!row) return null;
  const tpl = parseTemplate(name, row.source);
  if (parsed.size >= 256) parsed.clear();
  parsed.set(key, tpl);
  return tpl;
}

export async function journal(
  db: Queryable,
  experimentId: number,
  generation: number,
  kind: string,
  detail: Record<string, unknown>,
  locus: string | null = null,
  outcome: Record<string, unknown> | null = null,
): Promise<number> {
  const [row] = await db
    .insert(experimentJournal)
    .values({ experimentId, generation, kind, locus, detail, outcome })
    .returning({ id: experimentJournal.id });
  return (row as { id: number }).id;
}

export async function generationOf(db: Queryable, experimentId: number): Promise<number> {
  const [row] = await db
    .select({ g: sql<number>`coalesce(max(${experimentSnapshots.generation}), 0)::int` })
    .from(experimentSnapshots)
    .where(eq(experimentSnapshots.experimentId, experimentId));
  return row?.g ?? 0;
}

/**
 * Fill the outcome of the candidate row that wrote an allele: what the writer reads
 * next time. Seeds and imports have no candidate row; nothing happens for them.
 */
export async function fillOutcome(
  db: Queryable,
  experimentId: number,
  locus: string,
  allele: string,
  outcome: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`
    UPDATE experiment_journal j SET outcome = ${JSON.stringify(outcome)}::jsonb
    FROM experiment_alleles a
    WHERE a.experiment_id = ${experimentId} AND a.locus = ${locus} AND a.allele = ${allele}
      AND j.id = a.journal_id AND j.kind = 'candidate'`);
}
