/**
 * Video projects (designs/2026-11-13-studio-suite.md, D1): one row per video from the idea on.
 * Before filming the row is the truth; after, its edit is, and Pieces gives the state.
 */
import type { Queryable } from "@wren/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  PROJECT_KINDS,
  type ProjectKind,
  type VideoProject,
  videoEdits,
  videoProjects,
} from "./schema.js";

const TITLE_MAX = 200;
const BRIEF_MAX = 8000;

const inspirationSchema = z.object({
  kind: z.enum(["post", "canon"]),
  ref: z.string().trim().min(1).max(200),
  why: z.string().trim().max(600).optional(),
});

const fields = {
  title: z.string().trim().min(1, "A project needs a title.").max(TITLE_MAX),
  kind: z.enum(PROJECT_KINDS),
  brief: z.string().trim().max(BRIEF_MAX),
  inspiration: z.array(inspirationSchema).max(50),
};

export const projectInputSchema = z.object({
  title: fields.title,
  kind: fields.kind.default("long"),
  brief: fields.brief.default(""),
  inspiration: fields.inspiration.default([]),
});
export type ProjectInput = z.input<typeof projectInputSchema>;

// no defaults: zod keeps them under .partial(), and a patch must leave unnamed fields alone
export const projectPatchSchema = z
  .object({
    ...fields,
    subjects: z.record(z.string(), z.number().int().positive()),
    folder: z.number().int().positive().nullable(),
  })
  .partial();
export type ProjectPatch = z.input<typeof projectPatchSchema>;

/** A project as the page and the agent read it; `edit` once filmed. */
export interface Project {
  id: number;
  title: string;
  kind: ProjectKind;
  brief: string;
  inspiration: VideoProject["inspiration"];
  subjects: Record<string, number>;
  folder: number | null;
  by: string;
  at: string;
  updatedAt: string;
  edit: { id: number; title: string; state: string } | null;
}

const projectOf = (
  p: VideoProject,
  e: { id: number; title: string; state: string } | null,
): Project => ({
  id: p.id,
  title: p.title,
  kind: p.kind,
  brief: p.brief,
  inspiration: p.inspiration,
  subjects: p.subjects,
  folder: p.folder,
  by: p.by,
  at: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  edit: e?.id != null ? e : null,
});

const withEdit = (db: Queryable) =>
  db
    .select({
      p: videoProjects,
      e: { id: videoEdits.id, title: videoEdits.title, state: videoEdits.state },
    })
    .from(videoProjects)
    .leftJoin(videoEdits, eq(videoEdits.id, videoProjects.editId));

/** A project or edit that is not there, or an edit taken: the caller's no, never worth a retry. */
export class ProjectRefusal extends Error {}
const gone = (id: number) =>
  new ProjectRefusal(`Project ${id} isn't here. \`wren project list\` shows what is.`);

export async function newProject(db: Queryable, input: ProjectInput, by: string) {
  const v = projectInputSchema.parse(input);
  const [row] = await db
    .insert(videoProjects)
    .values({ ...v, by })
    .returning({ id: videoProjects.id });
  return showProject(db, (row as { id: number }).id);
}

/** Newest change first. */
export async function listProjects(db: Queryable, o: { limit?: number } = {}) {
  const rows = await withEdit(db)
    .orderBy(desc(videoProjects.updatedAt), desc(videoProjects.id))
    .limit(o.limit ?? 200);
  return rows.map((r) => projectOf(r.p, r.e));
}

export async function showProject(db: Queryable, id: number): Promise<Project> {
  const [r] = await withEdit(db).where(eq(videoProjects.id, id));
  if (!r) throw gone(id);
  return projectOf(r.p, r.e);
}

export async function setProject(db: Queryable, id: number, patch: ProjectPatch) {
  const v = projectPatchSchema.parse(patch);
  const set = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
  if (!Object.keys(set).length) return showProject(db, id);
  const done = await db
    .update(videoProjects)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(videoProjects.id, id))
    .returning({ id: videoProjects.id });
  if (!done.length) throw gone(id);
  return showProject(db, id);
}

/** Filming: the project's edit from here on. An edit holds one project. */
export async function linkEdit(db: Queryable, id: number, editId: number) {
  const [other] = await db
    .select({ id: videoProjects.id })
    .from(videoProjects)
    .where(eq(videoProjects.editId, editId));
  if (other && other.id !== id)
    throw new ProjectRefusal(`Video ${editId} already belongs to project ${other.id}.`);
  const done = await db
    .update(videoProjects)
    .set({ editId, updatedAt: sql`now()` })
    .where(eq(videoProjects.id, id))
    .returning({ id: videoProjects.id });
  if (!done.length) throw gone(id);
  return showProject(db, id);
}
