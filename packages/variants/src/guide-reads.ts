/**
 * Guides across every subject, for Explorer's `vireo/guides` (designs/2026-11-12-explorer.md):
 * each guide with its subject's slug, and the samples that applied it. An open batch's samples
 * stay out for a viewer (blind, vireo D11); no viewer (the CLI) sees them all.
 */
import type { Db } from "@wren/db";
import { batches, guides, samples, subjects } from "@wrenautomation/vireo";
import { and, eq, sql } from "drizzle-orm";

/** Every guide, oldest first, with the slug of the subject it is scoped to (null: a kind or all). */
export const allGuides = (db: Db) =>
  db
    .select({
      id: guides.id,
      text: guides.text,
      source: guides.source,
      ref: guides.ref,
      kind: guides.kind,
      state: guides.state,
      subject: subjects.slug,
    })
    .from(guides)
    .leftJoin(subjects, eq(subjects.id, guides.subjectId))
    .orderBy(guides.id);

/** The samples that applied guide `id`, newest first. */
export const samplesApplying = (db: Db, id: number, viewer: string | null) =>
  db
    .select({
      id: samples.id,
      name: samples.name,
      position: samples.position,
      poster: samples.poster,
      batch: samples.batchId,
      subject: subjects.slug,
    })
    .from(samples)
    .innerJoin(batches, eq(batches.id, samples.batchId))
    .innerJoin(subjects, eq(subjects.id, samples.subjectId))
    .where(
      and(
        sql`${id} = any(${samples.guides})`,
        viewer == null ? undefined : eq(batches.state, "closed"),
      ),
    )
    .orderBy(sql`${samples.id} desc`);
