/**
 * The template store (designs/2026-10-06-edits-claude-templates.md, 3;
 * 2026-10-07-templates-live-copy.md): every channel's copy and every model prompt in `templates`
 * and `template_versions`. Wren's built-in words are files (`template-defaults.ts`), synced in as
 * `default` versions; the database holds the live copy. A template follows the newest default or
 * has its own live version. Every save is a numbered version with who, when and why, kept and
 * never changed; a save names the version it was opened from and is refused when that moved.
 * Only the live version goes out, and making one live sends nothing: a sender reads it when it
 * next composes. Each write sets the audit actor in its own transaction.
 */
import { atomic, type Queryable, setAuditActor } from "@wren/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type TemplateOrigin, templates, templateVersions } from "./schema.js";
import {
  checkSource,
  parseKind,
  renderKind,
  type SlotRules,
  TEMPLATE_KINDS,
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

/** A prompt in the store: kind prompt, system the package that asks. */
export const promptRef = (system: string, name: string): TemplateRef => ({
  kind: "prompt",
  system,
  name,
});

/** `email:recruiting/book-first/opener`: how the CLI and the browser name one. */
export const refText = (ref: TemplateRef): string => `${ref.kind}:${ref.system}/${ref.name}`;

/** A ref from its text, or throws saying the shape. */
export function parseRef(text: string): TemplateRef {
  const m = /^([a-z]+):([A-Za-z0-9_.-]+)\/(.+)$/.exec(text.trim());
  if (!m || !(TEMPLATE_KINDS as readonly string[]).includes(m[1] as string))
    throw new Error(
      `a template is <kind>:<system>/<name>, kind one of ${TEMPLATE_KINDS.join(", ")} (got ${text})`,
    );
  return { kind: m[1] as TemplateKind, system: m[2] as string, name: m[3] as string };
}

/** Where a template shows when nobody moved it: its system, then its name's folders. */
export const defaultFolder = (ref: TemplateRef): string =>
  [ref.system, ...ref.name.split("/").slice(0, -1)].join("/");

/** One version as a template's head names it. */
export interface VersionHead {
  id: number;
  number: number;
  /** The hash of its words: what a send pins. */
  version: string;
  source: string;
  origin: TemplateOrigin;
  by: string | null;
  at: Date;
}

/** A template's live words, parsed. */
export interface LiveTemplate {
  templateId: number;
  versionId: number;
  number: number;
  version: string;
  source: string;
  template: Template;
  /** When this version went live, and who did it. */
  publishedAt: Date | null;
  publishedBy: string | null;
}

/** What the browser and `ls` say about one: waiting wins, then its own live copy or the default's. */
export type TemplateStatus = "waiting" | "default" | "updated" | "edited" | "empty";

/** Where a template stands: its live, draft and waiting versions, and the newest default. */
export interface TemplateState extends TemplateRef {
  id: number;
  folder: string;
  followsDefault: boolean;
  live: VersionHead | null;
  draft: VersionHead | null;
  waiting: VersionHead | null;
  waitingBy: string | null;
  newestDefault: VersionHead | null;
  status: TemplateStatus;
}

/**
 * A save named a version that is no longer the newest: someone saved or published since. Carries
 * what is there now, so the editor can show a diff and offer to reload or save on top.
 */
export class TemplateConflict extends Error {
  constructor(readonly current: VersionHead | null) {
    super("Changed since you opened it.");
    this.name = "TemplateConflict";
  }
}

/** What a save, publish or approval is refused for, said to the person. */
export class TemplateRefusal extends Error {
  override name = "TemplateRefusal";
}

const ref3 = (ref: TemplateRef) =>
  and(eq(templates.kind, ref.kind), eq(templates.system, ref.system), eq(templates.name, ref.name));

/** The template's row id, made on first use. */
export async function ensureTemplate(
  db: Queryable,
  ref: TemplateRef,
  opts: { folder?: string; followsDefault?: boolean } = {},
): Promise<number> {
  const [made] = await db
    .insert(templates)
    .values({
      ...ref,
      folder: opts.folder ?? defaultFolder(ref),
      followsDefault: opts.followsDefault ?? false,
    })
    .onConflictDoNothing({ target: [templates.kind, templates.system, templates.name] })
    .returning({ id: templates.id });
  if (made) return made.id;
  const [row] = await db.select({ id: templates.id }).from(templates).where(ref3(ref));
  if (!row) throw new Error(`template ${refText(ref)} vanished`);
  return row.id;
}

export interface VersionOpts {
  /** The words as written. */
  source: string;
  by?: string | null;
  origin?: TemplateOrigin;
  why?: string | null;
  /** The version row the editor had open. */
  openedFrom?: number | null;
  parent?: string | null;
  experimentId?: number | null;
  /** A default's file hash. */
  defaultHash?: string | null;
  /** When it was written, for copy kept before this table (default now). */
  at?: Date;
}

/**
 * Keep one version's words as the next number, always a new row: a restore or a default may
 * repeat old words. The template row is locked, so two saves never take one number.
 */
export async function addVersion(
  db: Queryable,
  ref: TemplateRef,
  version: string,
  opts: VersionOpts & { folder?: string; followsDefault?: boolean },
): Promise<{ id: number; number: number }> {
  return atomic(db, async (tx) => {
    const templateId = await ensureTemplate(tx, ref, opts);
    await tx.execute(sql`SELECT 1 FROM templates WHERE id = ${templateId} FOR UPDATE`);
    const [top] = await tx
      .select({ n: sql<number>`coalesce(max(${templateVersions.number}), 0)::int` })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId));
    const number = (top?.n ?? 0) + 1;
    const [made] = await tx
      .insert(templateVersions)
      .values({
        templateId,
        niche: ref.system,
        template: ref.name,
        version,
        number,
        source: opts.source,
        origin: opts.origin ?? (opts.experimentId != null ? "ai" : "edit"),
        why: opts.why ?? null,
        openedFrom: opts.openedFrom ?? null,
        defaultHash: opts.defaultHash ?? null,
        parentVersion: opts.parent ?? null,
        experimentId: opts.experimentId ?? null,
        createdBy: opts.by ?? null,
        ...(opts.at ? { createdAt: opts.at } : {}),
      })
      .returning({ id: templateVersions.id });
    return { id: (made as { id: number }).id, number };
  });
}

/**
 * Make sure these words are kept under their hash: the newest row with it, else a new version.
 * Nothing goes live. A compose or an experiment records what it rendered this way.
 */
export async function recordVersion(
  db: Queryable,
  ref: TemplateRef,
  version: string,
  opts: VersionOpts,
): Promise<number> {
  const find = async (q: Queryable) => {
    const [row] = await q
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(and(ref3(ref), eq(templateVersions.version, version)))
      .orderBy(desc(templateVersions.number))
      .limit(1);
    return row?.id ?? null;
  };
  const found = await find(db);
  if (found !== null) return found;
  return atomic(db, async (tx) => {
    const templateId = await ensureTemplate(tx, ref);
    await tx.execute(sql`SELECT 1 FROM templates WHERE id = ${templateId} FOR UPDATE`);
    return (await find(tx)) ?? (await addVersion(tx, ref, version, opts)).id;
  });
}

const HEAD = {
  id: templateVersions.id,
  number: templateVersions.number,
  version: templateVersions.version,
  source: templateVersions.source,
  origin: templateVersions.origin,
  by: templateVersions.createdBy,
  at: templateVersions.createdAt,
};

/** What the browser shows for a template: see `TemplateStatus`. */
export function statusOf(s: {
  followsDefault: boolean;
  live: Pick<VersionHead, "number"> | null;
  waiting: unknown;
  newestDefault: Pick<VersionHead, "number"> | null;
}): TemplateStatus {
  if (s.waiting) return "waiting";
  if (s.followsDefault) return s.live || s.newestDefault ? "default" : "empty";
  if (!s.live) return "empty";
  return s.newestDefault && s.newestDefault.number > s.live.number ? "updated" : "edited";
}

/** One template's live, draft and waiting versions; null when it was never saved. */
export async function templateState(
  db: Queryable,
  ref: TemplateRef,
  lock = false,
): Promise<TemplateState | null> {
  const q = db.select().from(templates).where(ref3(ref));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) return null;
  const ids = [row.liveVersionId, row.draftVersionId, row.waitingVersionId].filter(
    (v): v is number => v !== null,
  );
  const versions = ids.length
    ? await db.select(HEAD).from(templateVersions).where(inArray(templateVersions.id, ids))
    : [];
  const [newestDefault] = await db
    .select(HEAD)
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, row.id), eq(templateVersions.origin, "default")))
    .orderBy(desc(templateVersions.number))
    .limit(1);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const head = (id: number | null) => (id !== null && byId.get(id)) || null;
  // Following with nothing live yet (a fresh install): the newest default is what goes out.
  const live = head(row.liveVersionId) ?? (row.followsDefault ? (newestDefault ?? null) : null);
  const state = {
    id: row.id,
    kind: row.kind,
    system: row.system,
    name: row.name,
    folder: row.folder,
    followsDefault: row.followsDefault,
    live,
    draft: head(row.draftVersionId),
    waiting: head(row.waitingVersionId),
    waitingBy: row.waitingBy,
    newestDefault: newestDefault ?? null,
  };
  return { ...state, status: statusOf(state) };
}

/** What the editor opened: the draft, else the live words. Null when there is neither. */
export const openedOf = (s: Pick<TemplateState, "draft" | "live"> | null): VersionHead | null =>
  s?.draft ?? s?.live ?? null;

export interface SaveOpts {
  by: string;
  /** One line: why. The CLI asks for it; the UI may leave it out. */
  why?: string | null;
  /**
   * The number of the version the editor opened (`openedOf`), null when it opened an empty one;
   * left out, no check. Anything newer refuses the save with `TemplateConflict`.
   */
  expect?: number | null;
  rules?: SlotRules;
  origin?: TemplateOrigin;
}

/**
 * A save: the words checked against the slot's rules, kept as the next version, and made the
 * draft (unless they are the live words already, which clears the draft). Nothing goes out. ""
 * is no save. Throws `AuthoringError` saying what is wrong, `TemplateConflict` when the version
 * it was opened from moved.
 */
export async function saveDraft(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: SaveOpts,
): Promise<TemplateState> {
  const checked = checkSource(ref.kind, ref.name, source, opts.rules);
  if (!checked) throw new Error(`${ref.name}: nothing to save; clear the template instead`);
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    await ensureTemplate(tx, ref);
    const now = (await templateState(tx, ref, true)) as TemplateState;
    const opened = openedOf(now);
    if (opts.expect !== undefined && (opened?.number ?? null) !== opts.expect)
      throw new TemplateConflict(opened);
    const hash = checked.template.version;
    let draft: number | null;
    if (now.live?.version === hash && now.live.source === checked.source) draft = null;
    else if (now.draft?.version === hash && now.draft.source === checked.source)
      draft = now.draft.id;
    else
      draft = (
        await addVersion(tx, ref, hash, {
          source: checked.source,
          by: opts.by,
          origin: opts.origin ?? "edit",
          why: opts.why ?? null,
          openedFrom: opened?.id ?? null,
        })
      ).id;
    await tx
      .update(templates)
      .set({ draftVersionId: draft, updatedAt: sql`now()` })
      .where(eq(templates.id, now.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/** A version of this template by its number, or a refusal naming it. */
async function versionNumbered(
  db: Queryable,
  s: TemplateState,
  number: number,
): Promise<VersionHead> {
  const [v] = await db
    .select(HEAD)
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, s.id), eq(templateVersions.number, number)));
  if (!v) throw new TemplateRefusal(`${s.name} has no version ${number}`);
  return v;
}

/** Locked state, or a refusal saying there is no such template. */
async function stateFor(tx: Queryable, ref: TemplateRef): Promise<TemplateState> {
  const s = await templateState(tx, ref, true);
  if (!s) throw new TemplateRefusal(`no template ${refText(ref)}`);
  return s;
}

/** Make `v` live: published by whom and why; the draft and the wait clear when they are it. */
async function makeLive(
  tx: Queryable,
  s: TemplateState,
  v: VersionHead,
  opts: { by: string; why?: string | null },
): Promise<void> {
  await tx
    .update(templateVersions)
    .set({ publishedAt: sql`now()`, publishedBy: opts.by })
    .where(eq(templateVersions.id, v.id));
  await tx
    .update(templates)
    .set({
      liveVersionId: v.id,
      draftVersionId: s.draft?.id === v.id ? null : (s.draft?.id ?? null),
      waitingVersionId: null,
      waitingBy: null,
      // Publishing the newest default is following it; anything else is the template's own.
      followsDefault: v.origin === "default" && v.id === s.newestDefault?.id,
      why: opts.why ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(templates.id, s.id));
}

/**
 * Make a version live now: the draft, or one named by its number (a rollback). No approval:
 * prompts publish this way, and an approval ends here. Publishing sends nothing.
 */
export async function publish(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string; number?: number; why?: string | null },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    const v = opts.number !== undefined ? await versionNumbered(tx, s, opts.number) : s.draft;
    if (!v) throw new TemplateRefusal(`${ref.name} has no draft to publish`);
    await makeLive(tx, s, v, opts);
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/** Kinds whose words go to people: making a version live waits on a person's yes. */
export const SENDS: ReadonlySet<TemplateKind> = new Set<TemplateKind>([
  "email",
  "sms",
  "dm",
  "post",
]);

/**
 * Ask for a version to go live: the draft, or one by number. A prompt goes live at once (its
 * output is a draft that still waits on a yes before it sends); copy that sends waits in To
 * approve until a person approves it. A new ask replaces an older one.
 */
export async function askPublish(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string; number?: number; why?: string | null },
): Promise<TemplateState> {
  if (!SENDS.has(ref.kind)) return publish(db, ref, opts);
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    const v = opts.number !== undefined ? await versionNumbered(tx, s, opts.number) : s.draft;
    if (!v) throw new TemplateRefusal(`${ref.name} has no draft to publish`);
    if (s.live?.id === v.id && !s.followsDefault)
      throw new TemplateRefusal(`version ${v.number} is live already`);
    await tx
      .update(templates)
      .set({ waitingVersionId: v.id, waitingBy: opts.by, updatedAt: sql`now()` })
      .where(eq(templates.id, s.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/**
 * A person's yes: the waiting version goes live. `number` is the one they saw; a newer ask in
 * between refuses with `TemplateConflict`. The caller checks that a person, not an agent, says it.
 */
export async function approve(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string; number: number; why?: string | null },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    if (!s.waiting) throw new TemplateRefusal(`${ref.name} has nothing waiting`);
    if (s.waiting.number !== opts.number) throw new TemplateConflict(s.waiting);
    await makeLive(tx, s, s.waiting, { by: opts.by, why: opts.why ?? null });
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/** A person's no: the ask goes away; the version stays in history. */
export async function decline(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    await tx
      .update(templates)
      .set({ waitingVersionId: null, waitingBy: null, updatedAt: sql`now()` })
      .where(eq(templates.id, s.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/**
 * A new version copying version `number` (origin restore), made the draft. Nothing is
 * overwritten, and it goes live the way any draft does.
 */
export async function restore(
  db: Queryable,
  ref: TemplateRef,
  number: number,
  opts: { by: string; why?: string | null; expect?: number | null },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    const old = await versionNumbered(tx, s, number);
    const opened = openedOf(s);
    if (opts.expect !== undefined && (opened?.number ?? null) !== opts.expect)
      throw new TemplateConflict(opened);
    const made = await addVersion(tx, ref, old.version, {
      source: old.source,
      by: opts.by,
      origin: "restore",
      why: opts.why ?? `restore version ${number}`,
      openedFrom: old.id,
    });
    await tx
      .update(templates)
      .set({ draftVersionId: made.id, updatedAt: sql`now()` })
      .where(eq(templates.id, s.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/**
 * Stop using this template's own version: the newest default goes live and later defaults
 * follow. Its own versions stay in history; any draft and ask clear.
 */
export async function reset(
  db: Queryable,
  ref: TemplateRef,
  opts: { by: string; why: string },
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const s = await stateFor(tx, ref);
    if (!s.newestDefault) throw new TemplateRefusal(`${ref.name} has no default to go back to`);
    await makeLive(tx, { ...s, draft: null }, s.newestDefault, opts);
    await tx
      .update(templates)
      .set({ draftVersionId: null, followsDefault: true })
      .where(eq(templates.id, s.id));
    return (await templateState(tx, ref)) as TemplateState;
  });
}

/** Save and publish in one, no approval: for tests and fixtures that need live words. */
export async function saveLive(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: SaveOpts,
): Promise<TemplateState> {
  return atomic(db, async (tx) => {
    const saved = await saveDraft(tx, ref, source, opts);
    return saved.draft ? publish(tx, ref, { by: opts.by, why: opts.why ?? null }) : saved;
  });
}

/**
 * Copy kept before this store, as an `import` version, live where nothing is. Again changes
 * nothing: words already kept are found by their hash.
 */
export async function importVersion(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: { by: string; at?: Date },
): Promise<{ version: string; live: boolean }> {
  const template = parseKind(ref.kind, ref.name, source);
  return atomic(db, async (tx) => {
    await setAuditActor(tx, opts.by);
    const id = await recordVersion(tx, ref, template.version, {
      source,
      by: opts.by,
      origin: "import",
      ...(opts.at ? { at: opts.at } : {}),
    });
    const made = await tx
      .update(templates)
      .set({ liveVersionId: id, updatedAt: sql`now()` })
      .where(and(ref3(ref), isNull(templates.liveVersionId), eq(templates.followsDefault, false)))
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

/** Empty the slot: nothing live, no draft, not following a default, so nothing sends. */
export async function clearTemplate(db: Queryable, ref: TemplateRef, by?: string): Promise<void> {
  await atomic(db, async (tx) => {
    if (by) await setAuditActor(tx, by);
    await tx
      .update(templates)
      .set({
        liveVersionId: null,
        draftVersionId: null,
        followsDefault: false,
        updatedAt: sql`now()`,
      })
      .where(ref3(ref));
  });
}

/** Move a template in the browser. Its ref, and so every send, stays as it was. */
export async function moveTemplate(
  db: Queryable,
  ref: TemplateRef,
  folder: string,
  by: string,
): Promise<void> {
  const clean = folder
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("/");
  if (clean.length > 200) throw new TemplateRefusal("a folder path is at most 200 characters");
  await atomic(db, async (tx) => {
    await setAuditActor(tx, by);
    const done = await tx
      .update(templates)
      .set({ folder: clean, updatedAt: sql`now()` })
      .where(ref3(ref))
      .returning({ id: templates.id });
    if (!done.length) throw new TemplateRefusal(`no template ${refText(ref)}`);
  });
}

/** Rename a folder: every template in it or under it moves along. Returns how many moved. */
export async function renameFolder(
  db: Queryable,
  from: string,
  to: string,
  by: string,
): Promise<number> {
  const clean = (f: string) =>
    f
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("/");
  const a = clean(from);
  const b = clean(to);
  if (!a) throw new TemplateRefusal("say which folder");
  return atomic(db, async (tx) => {
    await setAuditActor(tx, by);
    const moved = await tx.execute(sql`
      UPDATE templates SET folder = ${b} || substr(folder, ${a.length + 1}), updated_at = now()
      WHERE folder = ${a} OR folder LIKE ${`${a.replaceAll("%", "\\%").replaceAll("_", "\\_")}/%`}
      RETURNING id`);
    return (moved as unknown as unknown[]).length;
  });
}

/**
 * The words that go out for a system's templates of one kind, by name; `names` narrows it: each
 * one's own live version, else (following, nothing live yet) the newest default. Empty ones are
 * absent.
 */
export async function liveTemplates(
  db: Queryable,
  kind: TemplateKind,
  system: string,
  names?: readonly string[],
): Promise<Map<string, LiveTemplate>> {
  if (names?.length === 0) return new Map();
  const rows = (await db.execute(sql`
    SELECT t.id template_id, t.name, v.id version_id, v.number, v.version, v.source,
      v.published_at, v.published_by
    FROM templates t
    JOIN template_versions v ON v.id = coalesce(t.live_version_id, CASE WHEN t.follows_default THEN (
      SELECT d.id FROM template_versions d WHERE d.template_id = t.id AND d.origin = 'default'
      ORDER BY d.number DESC LIMIT 1) END)
    WHERE t.kind = ${kind} AND t.system = ${system}
      ${
        names
          ? sql`AND t.name IN ${sql`(${sql.join(
              names.map((n) => sql`${n}`),
              sql`, `,
            )})`}`
          : sql``
      }`)) as unknown as Record<string, unknown>[];
  return new Map(
    rows.map((r) => {
      const name = String(r.name);
      const at = (v: unknown) => (v ? new Date(v as string) : null);
      return [
        name,
        {
          templateId: Number(r.template_id),
          versionId: Number(r.version_id),
          number: Number(r.number),
          version: String(r.version),
          source: String(r.source),
          template: parseKind(kind, name, String(r.source)),
          publishedAt: at(r.published_at),
          publishedBy: (r.published_by as string | null) ?? null,
        },
      ];
    }),
  );
}

/** The words one template sends: its own live version, else the newest default; null for none. */
export async function resolveTemplate(
  db: Queryable,
  ref: TemplateRef,
): Promise<LiveTemplate | null> {
  return (await liveTemplates(db, ref.kind, ref.system, [ref.name])).get(ref.name) ?? null;
}

/** One template as `ls` and the browser list it. Numbers are version numbers. */
export interface TemplateRow extends TemplateRef {
  id: number;
  folder: string;
  status: TemplateStatus;
  live: number | null;
  draft: number | null;
  waiting: number | null;
  newestDefault: number | null;
  /** Who wrote its newest version, how it came (`default` for Wren's), and when. */
  by: string | null;
  origin: string | null;
  at: Date | null;
  /** The words an editor opens (the draft, else live), for search. */
  words: string;
}

export interface ListOpts {
  /** This folder and every folder under it. */
  folder?: string;
  kind?: TemplateKind;
  status?: TemplateStatus;
}

/** Every template, by folder then name, with where each stands. */
export async function listTemplates(db: Queryable, opts: ListOpts = {}): Promise<TemplateRow[]> {
  const folder = opts.folder?.replace(/^\/+|\/+$/g, "");
  const rows = (await db.execute(sql`
    SELECT t.id, t.kind, t.system, t.name, t.folder, t.follows_default,
      coalesce(lv.number, CASE WHEN t.follows_default THEN nd.number END) live,
      dv.number draft, wv.number waiting, nd.number newest_default, top.created_by, top.origin, top.created_at,
      coalesce(dv.source, lv.source, CASE WHEN t.follows_default THEN nd.source END, '') words
    FROM templates t
    LEFT JOIN template_versions lv ON lv.id = t.live_version_id
    LEFT JOIN template_versions dv ON dv.id = t.draft_version_id
    LEFT JOIN template_versions wv ON wv.id = t.waiting_version_id
    LEFT JOIN LATERAL (SELECT d.number, d.source FROM template_versions d
      WHERE d.template_id = t.id AND d.origin = 'default' ORDER BY d.number DESC LIMIT 1) nd ON true
    LEFT JOIN LATERAL (SELECT v.created_by, v.origin, v.created_at FROM template_versions v
      WHERE v.template_id = t.id ORDER BY v.number DESC LIMIT 1) top ON true
    WHERE true
      ${opts.kind ? sql`AND t.kind = ${opts.kind}` : sql``}
      ${
        folder
          ? sql`AND (t.folder = ${folder} OR t.folder LIKE ${`${folder.replaceAll("%", "\\%").replaceAll("_", "\\_")}/%`})`
          : sql``
      }
    ORDER BY t.folder, t.name, t.kind`)) as unknown as Record<string, unknown>[];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const out = rows.map((r) => {
    const row = {
      id: Number(r.id),
      kind: r.kind as TemplateKind,
      system: String(r.system),
      name: String(r.name),
      folder: String(r.folder),
      live: num(r.live),
      draft: num(r.draft),
      waiting: num(r.waiting),
      newestDefault: num(r.newest_default),
      by: (r.created_by as string | null) ?? null,
      origin: (r.origin as string | null) ?? null,
      at: r.created_at ? new Date(r.created_at as string) : null,
      words: String(r.words ?? ""),
    };
    const status = statusOf({
      followsDefault: Boolean(r.follows_default),
      live: row.live === null ? null : { number: row.live },
      waiting: row.waiting,
      newestDefault: row.newestDefault === null ? null : { number: row.newestDefault },
    });
    return { ...row, status };
  });
  return opts.status ? out.filter((r) => r.status === opts.status) : out;
}

/** An ask waiting on a person's yes: the template and the version that would go live. */
export interface WaitingAsk extends TemplateRef {
  id: number;
  number: number;
  source: string;
  /** Who asked, and when. */
  by: string | null;
  at: Date;
}

/** Every template waiting on approval, oldest ask first: To approve's template rows. */
export async function waitingAsks(db: Queryable): Promise<WaitingAsk[]> {
  const rows = (await db.execute(sql`
    SELECT t.id, t.kind, t.system, t.name, t.waiting_by, w.number, w.source, t.updated_at
    FROM templates t JOIN template_versions w ON w.id = t.waiting_version_id
    ORDER BY t.updated_at`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as TemplateKind,
    system: String(r.system),
    name: String(r.name),
    number: Number(r.number),
    source: String(r.source),
    by: (r.waiting_by as string | null) ?? null,
    at: new Date(r.updated_at as string),
  }));
}

/** One version in a template's history. */
export interface VersionRow extends VersionHead {
  why: string | null;
  /** The number of the version it was opened from. */
  openedFrom: number | null;
  publishedAt: Date | null;
  publishedBy: string | null;
}

/** A template's versions, newest first; empty when there is no such template. */
export async function versionsOf(db: Queryable, ref: TemplateRef): Promise<VersionRow[]> {
  const rows = (await db.execute(sql`
    SELECT v.id, v.number, v.version, v.source, v.origin, v.why, v.created_by, v.created_at,
      v.published_at, v.published_by, o.number opened_from
    FROM templates t
    JOIN template_versions v ON v.template_id = t.id
    LEFT JOIN template_versions o ON o.id = v.opened_from
    WHERE t.kind = ${ref.kind} AND t.system = ${ref.system} AND t.name = ${ref.name}
    ORDER BY v.number DESC`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    number: Number(r.number),
    version: String(r.version),
    source: String(r.source),
    origin: r.origin as TemplateOrigin,
    why: (r.why as string | null) ?? null,
    openedFrom:
      r.opened_from === null || r.opened_from === undefined ? null : Number(r.opened_from),
    by: (r.created_by as string | null) ?? null,
    at: new Date(r.created_at as string),
    publishedAt: r.published_at ? new Date(r.published_at as string) : null,
    publishedBy: (r.published_by as string | null) ?? null,
  }));
}

/**
 * One default's words into this database: a new `default` version when the file moved (by its
 * hash), live at once when the template follows the default. A template made here follows it; one
 * made before defaults existed follows it when its live words are the file's. Again changes
 * nothing.
 */
export async function writeDefault(
  db: Queryable,
  ref: TemplateRef,
  source: string,
  opts: { hash: string; folder?: string; by?: string },
): Promise<{ written: boolean; live: boolean }> {
  const tpl = parseKind(ref.kind, ref.name, source);
  const by = opts.by ?? "sync:defaults";
  return atomic(db, async (tx) => {
    await setAuditActor(tx, by);
    await ensureTemplate(tx, ref, {
      followsDefault: true,
      ...(opts.folder !== undefined ? { folder: opts.folder } : {}),
    });
    const s = (await templateState(tx, ref, true)) as TemplateState;
    if (s.newestDefault) {
      const [d] = await tx
        .select({ hash: templateVersions.defaultHash })
        .from(templateVersions)
        .where(eq(templateVersions.id, s.newestDefault.id));
      if (d?.hash === opts.hash) return { written: false, live: s.followsDefault };
    }
    const made = await addVersion(tx, ref, tpl.version, {
      source,
      by,
      origin: "default",
      defaultHash: opts.hash,
    });
    // First default for copy that was here before: it follows when nobody changed the words.
    const follows =
      s.followsDefault ||
      (!s.newestDefault && (!s.live || (s.live.version === tpl.version && !s.draft)));
    if (follows) {
      await tx
        .update(templateVersions)
        .set({ publishedAt: sql`now()`, publishedBy: by })
        .where(eq(templateVersions.id, made.id));
      await tx
        .update(templates)
        .set({ liveVersionId: made.id, followsDefault: true, updatedAt: sql`now()` })
        .where(eq(templates.id, s.id));
    }
    return { written: true, live: follows };
  });
}

/** A prompt's words with its facts, byte for byte as written and given. */
export const renderPrompt = (live: Pick<LiveTemplate, "template">, facts: FactValues = {}) =>
  renderKind("prompt", live.template, facts, "prompt").body;
