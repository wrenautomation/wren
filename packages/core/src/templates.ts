/**
 * The template store (designs/2026-10-06-edits-claude-templates.md, 3): every channel's copy and
 * every model prompt in `templates` and `template_versions`. A version is the hash of the words,
 * kept once and never changed. A save keeps a version as the draft; Publish makes one live. Only
 * the live version goes out, and publishing sends nothing: a sender reads the live version when it
 * next composes.
 */
import { atomic, type Queryable } from "@wren/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { templates, templateVersions } from "./schema.js";
import {
  checkSource,
  parseKind,
  renderKind,
  type SlotRules,
  type TemplateKind,
} from "./slots/kinds.js";
import type { FactValues } from "./slots/pickers.js";
import type { Template } from "./slots/tree.js";

/** Which template: its kind, whose copy it is, and its key there. */
export interface TemplateRef {
  kind: TemplateKind;
  system: string;
  name: string;
}

/** An email template: its niche is its system. */
export const emailRef = (niche: string, name: string): TemplateRef => ({
  kind: "email",
  system: niche,
  name,
});

/** A template's live words, parsed. */
export interface LiveTemplate {
  templateId: number;
  versionId: number;
  version: string;
  source: string;
  template: Template;
  /** When this version went live, and who did it. */
  publishedAt: Date | null;
  publishedBy: string | null;
}

/** Where a template stands: its live and draft versions. */
export interface TemplateState extends TemplateRef {
  id: number;
  live: { id: number; version: string; source: string } | null;
  draft: { id: number; version: string; source: string } | null;
}

/** The template's row id, made on first use. */
export async function ensureTemplate(db: Queryable, ref: TemplateRef): Promise<number> {
  const [made] = await db
    .insert(templates)
    .values(ref)
    .onConflictDoNothing({ target: [templates.kind, templates.system, templates.name] })
    .returning({ id: templates.id });
  if (made) return made.id;
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.kind, ref.kind),
        eq(templates.system, ref.system),
        eq(templates.name, ref.name),
      ),
    );
  if (!row) throw new Error(`template ${ref.kind}:${ref.system}/${ref.name} vanished`);
  return row.id;
}

export interface VersionOpts {
  /** The words as written; default the parsed template's own (`toSource`). */
  source: string;
  by?: string | null;
  parent?: string | null;
  experimentId?: number | null;
  /** When it was written, for copy kept before this table (default now). */
  at?: Date;
}

/** Keep one version's words under its hash, once. Nothing goes live. Its row id. */
export async function recordVersion(
  db: Queryable,
  ref: TemplateRef,
  version: string,
  opts: VersionOpts,
): Promise<number> {
  const templateId = await ensureTemplate(db, ref);
  const [made] = await db
    .insert(templateVersions)
    .values({
      templateId,
      niche: ref.system,
      template: ref.name,
      version,
      source: opts.source,
      parentVersion: opts.parent ?? null,
      experimentId: opts.experimentId ?? null,
      createdBy: opts.by ?? null,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .onConflictDoNothing({
      target: [templateVersions.niche, templateVersions.template, templateVersions.version],
    })
    .returning({ id: templateVersions.id });
  if (made) return made.id;
  const [row] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.niche, ref.system),
        eq(templateVersions.template, ref.name),
        eq(templateVersions.version, version),
      ),
    );
  return (row as { id: number }).id;
}

const ref3 = (ref: TemplateRef) =>
  and(eq(templates.kind, ref.kind), eq(templates.system, ref.system), eq(templates.name, ref.name));

/** One template's live and draft versions; null when it was never saved. */
export async function templateState(
  db: Queryable,
  ref: TemplateRef,
): Promise<TemplateState | null> {
  const [row] = await db.select().from(templates).where(ref3(ref));
  if (!row) return null;
  const ids = [row.liveVersionId, row.draftVersionId].filter((v): v is number => v !== null);
  const versions = ids.length
    ? await db
        .select({
          id: templateVersions.id,
          version: templateVersions.version,
          source: templateVersions.source,
        })
        .from(templateVersions)
        .where(inArray(templateVersions.id, ids))
    : [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  return {
    id: row.id,
    kind: row.kind,
    system: row.system,
    name: row.name,
    live: (row.liveVersionId !== null && byId.get(row.liveVersionId)) || null,
    draft: (row.draftVersionId !== null && byId.get(row.draftVersionId)) || null,
  };
}

/**
 * A save: the words checked against the slot's rules, kept as a version, and made the draft
 * (unless they are the live words already, which clears the draft). Nothing goes out. "" is no
 * save. Throws `AuthoringError` saying what is wrong.
 */
export async function saveDraft(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: { by: string; rules?: SlotRules },
): Promise<TemplateState> {
  const checked = checkSource(ref.kind, ref.name, source, opts.rules);
  if (!checked) throw new Error(`${ref.name}: nothing to save; clear the template instead`);
  return atomic(db, async (tx) => {
    const id = await recordVersion(tx, ref, checked.template.version, {
      source: checked.source,
      by: opts.by,
    });
    const [row] = await tx
      .select({ live: templates.liveVersionId })
      .from(templates)
      .where(ref3(ref));
    await tx
      .update(templates)
      .set({ draftVersionId: row?.live === id ? null : id, updatedAt: sql`now()` })
      .where(ref3(ref));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/**
 * Make a version live: the draft, or one named by its hash (a rollback). The draft clears when
 * it's the one published. Publishing sends nothing.
 */
export async function publish(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string; version?: string },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    const [row] = await tx.select().from(templates).where(ref3(ref)).for("update");
    if (!row) throw new Error(`no template ${ref.kind} ${ref.system}/${ref.name}`);
    let id = row.draftVersionId;
    if (opts.version !== undefined) {
      const [v] = await tx
        .select({ id: templateVersions.id })
        .from(templateVersions)
        .where(
          and(eq(templateVersions.templateId, row.id), eq(templateVersions.version, opts.version)),
        );
      if (!v) throw new Error(`${ref.name} has no version ${opts.version}`);
      id = v.id;
    }
    if (id === null) throw new Error(`${ref.name} has no draft to publish`);
    await tx
      .update(templateVersions)
      .set({ publishedAt: sql`now()`, publishedBy: opts.by })
      .where(eq(templateVersions.id, id));
    await tx
      .update(templates)
      .set({
        liveVersionId: id,
        draftVersionId: row.draftVersionId === id ? null : row.draftVersionId,
        updatedAt: sql`now()`,
      })
      .where(eq(templates.id, row.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/** Save and publish in one: the copy pages' Save, until the Library's Publish replaces it. */
export async function saveLive(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: { by: string; rules?: SlotRules },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    const saved = await saveDraft(tx, ref, source, opts);
    return saved.draft ? publish(tx, ref, { by: opts.by }) : saved;
  });
}

/**
 * Copy that lived somewhere else (a file, an old table) kept as a version, and made live when
 * nothing is: an import that runs twice changes nothing, and never overrides a publish.
 */
export async function importVersion(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: { by: string; at?: Date },
): Promise<{ version: string; live: boolean }> {
  const template = parseKind(ref.kind, ref.name, source);
  return atomic(db, async (tx) => {
    const id = await recordVersion(tx, ref, template.version, { source, ...opts });
    const made = await tx
      .update(templates)
      .set({ liveVersionId: id, updatedAt: sql`now()` })
      .where(and(ref3(ref), isNull(templates.liveVersionId)))
      .returning({ id: templates.id });
    if (made.length)
      await tx
        .update(templateVersions)
        .set({ publishedAt: opts.at ?? sql`now()`, publishedBy: opts.by })
        .where(eq(templateVersions.id, id));
    const [row] = await tx
      .select({ live: templates.liveVersionId })
      .from(templates)
      .where(ref3(ref));
    return { version: template.version, live: row?.live === id };
  });
}

/** Empty the slot: nothing live, no draft, so nothing sends. Its versions stay. */
export async function clearTemplate(db: Queryable, ref: TemplateRef): Promise<void> {
  await db
    .update(templates)
    .set({ liveVersionId: null, draftVersionId: null, updatedAt: sql`now()` })
    .where(ref3(ref));
}

/** The live words of a system's templates of one kind, by name; `names` narrows it. Empty ones are absent. */
export async function liveTemplates(
  db: Queryable,
  kind: TemplateKind,
  system: string,
  names?: readonly string[],
): Promise<Map<string, LiveTemplate>> {
  if (names?.length === 0) return new Map();
  const rows = await db
    .select({
      templateId: templates.id,
      name: templates.name,
      versionId: templateVersions.id,
      version: templateVersions.version,
      source: templateVersions.source,
      publishedAt: templateVersions.publishedAt,
      publishedBy: templateVersions.publishedBy,
    })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.liveVersionId))
    .where(
      and(
        eq(templates.kind, kind),
        eq(templates.system, system),
        names ? inArray(templates.name, [...names]) : undefined,
      ),
    );
  return new Map(
    rows.map((r) => [
      r.name,
      {
        templateId: r.templateId,
        versionId: r.versionId,
        version: r.version,
        source: r.source,
        template: parseKind(kind, r.name, r.source),
        publishedAt: r.publishedAt,
        publishedBy: r.publishedBy,
      },
    ]),
  );
}

/** A prompt in the store: kind prompt, system the package that asks. */
export const promptRef = (system: string, name: string): TemplateRef => ({
  kind: "prompt",
  system,
  name,
});

/** Plain words as prompt source: each `{` doubled, so a quoted JSON shape stays words. */
export const literalPrompt = (words: string): string => words.replaceAll("{", "{{");

/**
 * A prompt the code ships, as the store has it live. The first ask in a database records the
 * code's words as version 1, live; from then on the store's words are the prompt, so an edit
 * there wins and a later change to `seed` is kept as a version, never made live over one.
 */
export async function livePrompt(
  db: Queryable,
  ref: { system: string; name: string },
  seed: string,
): Promise<LiveTemplate> {
  const read = async () =>
    (await liveTemplates(db, "prompt", ref.system, [ref.name])).get(ref.name);
  const live = await read();
  if (live) return live;
  await importVersion(db, promptRef(ref.system, ref.name), seed, { by: "import:code" });
  const seeded = await read();
  if (!seeded) throw new Error(`prompt ${ref.system}/${ref.name} did not seed`);
  return seeded;
}

/** A prompt's words with its facts, byte for byte as written and given. */
export const renderPrompt = (live: Pick<LiveTemplate, "template">, facts: FactValues = {}) =>
  renderKind("prompt", live.template, facts, "prompt").body;
