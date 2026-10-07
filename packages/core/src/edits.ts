/**
 * Edits (designs/2026-10-06-edits-claude-templates.md, 1 and 2): one path for every record that
 * declares `edits` (`./records.ts`). A patch is checked against the record's schema, then its
 * check, then compare-and-swapped on the version of the values the editor started from, so two
 * people never overwrite each other. Each one that lands is a `changes` row: before, after, who,
 * and the run it came from. Undo writes a change's before back as a new change, once.
 *
 * Ask Claude on a record is a `runs` row (command `record-ask`) holding the prompt; `Ask/edit`
 * hands it to the desk's `claude` service (William's Mac, read only, $0) and keeps the answer:
 * a reply and a patch. Nothing lands until a person presses Accept, which is an edit like any
 * other with the run on it.
 */
import { createHash } from "node:crypto";
import { type Queryable, serializable } from "@wren/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { type ZodType, z } from "zod";
import { PortalRefusal } from "./portal.js";
import type { RecordEdits, RecordType, Values } from "./records.js";
import { type ChangeVia, changes, runs } from "./schema.js";

export type { Values };

export const ASK_COMMAND = "record-ask";
/** History lines a record's page shows. */
const HISTORY = 50;
/** Asks a record's page shows. */
const ASKS = 10;
/** People's last edits Claude learns from. */
const TAUGHT = 5;
export const ASK_MESSAGE_MAX = 2000;
/** Context past this is cut: the prompt stays a page or two. */
const CONTEXT_MAX = 12_000;

/** Object keys sorted, so the same values always hash and compare the same. */
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object" && !(v instanceof Date)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable((v as Values)[k])]),
        )
      : v;
const json = (v: unknown) => JSON.stringify(stable(v ?? null));
const same = (a: unknown, b: unknown) => json(a) === json(b);
const pick = (v: Values, keys: readonly string[]): Values =>
  Object.fromEntries(keys.map((k) => [k, v[k] ?? null]));

/** The editable values' version: what an editor started from, sent back as `expect`. */
export const versionOf = (values: Values): string =>
  createHash("sha256").update(json(values)).digest("base64url").slice(0, 12);

export function recordEdits(type: RecordType): RecordEdits {
  if (!type.edits) throw new PortalRefusal(`${type.name.many} can't be edited`, 400);
  return type.edits;
}

/** zod's first complaint, in words a person can act on. */
const problemOf = (err: z.ZodError): string => {
  const i = err.issues[0];
  if (!i) return "that change doesn't fit";
  if (i.code === "unrecognized_keys") return `it can't change ${i.keys.join(", ")}`;
  return i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
};

/** The patch for records whose edits are words only: each field a string up to its cap. */
export function wordsPatch(caps: Readonly<Record<string, number>>): ZodType<Values> {
  return z
    .object(Object.fromEntries(Object.entries(caps).map(([k, max]) => [k, z.string().max(max)])))
    .partial()
    .strict();
}

/** A patch as the record's schema reads it, or what's wrong. */
export function patchOf(type: RecordType, patch: unknown): Values {
  const got = recordEdits(type).patch.safeParse(patch);
  if (!got.success) throw new PortalRefusal(problemOf(got.error), 400);
  if (!Object.keys(got.data).length) throw new PortalRefusal("nothing to change", 400);
  return got.data;
}

/** What the web sends: a patch, the version it started from, and Claude's ask on Accept. */
export interface EditAsk {
  record: string;
  id: string | number;
  patch: Values;
  expect?: string | null;
  run?: string | null;
}
export interface UndoAsk {
  record: string;
  id: string | number;
  change: number;
}
export interface RecordAskAsk {
  record: string;
  id: string | number;
  message: string;
}

export interface EditOpts {
  patch: unknown;
  /** The version the editor started from; absent, the edit lands on whatever is there. */
  expect?: string | null;
  by: string;
  via?: ChangeVia;
  /** The ask whose patch this is. */
  run?: string | null;
  undoes?: number | null;
}
export interface Edited {
  values: Values;
  version: string;
  /** The change it made; null when the patch matched what was there. */
  change: number | null;
}

/** One edit, start to end: schema, version, check, write, and its `changes` row. */
export async function editRecord(
  db: Queryable,
  type: RecordType,
  id: string,
  o: EditOpts,
): Promise<Edited> {
  const e = recordEdits(type);
  const patch = patchOf(type, o.patch);
  return serializable(db, async (tx) => {
    const now = await e.read(tx, id);
    if (!now) throw new PortalRefusal(`no such ${type.name.one}`, 404);
    if (o.expect && versionOf(now) !== o.expect)
      throw new PortalRefusal(`this ${type.name.one} changed since you opened it; look again`, 409);
    const keys = Object.keys(patch).filter((k) => !same(now[k], patch[k]));
    if (!keys.length) return { values: now, version: versionOf(now), change: null };
    const problem = await e.check?.(patch, now, tx, id);
    if (problem) throw new PortalRefusal(problem, 400);
    await e.write(tx, id, pick(patch, keys), o.by);
    const after = (await e.read(tx, id)) ?? {};
    const version = versionOf(after);
    const [row] = await tx
      .insert(changes)
      .values({
        record: type.id,
        recordId: id,
        before: pick(now, keys),
        after: pick(after, keys),
        version,
        by: o.by,
        via: o.via ?? "person",
        runId: o.run ?? null,
        undoes: o.undoes ?? null,
      })
      .returning({ id: changes.id });
    return { values: after, version, change: row?.id ?? null };
  });
}

/** Put a change's before back, as a new change. Refused once undone, or when a newer one changed it since. */
export async function undoChange(
  db: Queryable,
  type: RecordType,
  id: string,
  change: number,
  by: string,
): Promise<Edited> {
  const e = recordEdits(type);
  return serializable(db, async (tx) => {
    const [c] = await tx
      .select()
      .from(changes)
      .where(and(eq(changes.id, change), eq(changes.record, type.id), eq(changes.recordId, id)));
    if (!c) throw new PortalRefusal("no such change", 404);
    const [done] = await tx
      .select({ id: changes.id })
      .from(changes)
      .where(eq(changes.undoes, c.id));
    if (done) throw new PortalRefusal("that change is undone already", 409);
    const now = await e.read(tx, id);
    if (!now) throw new PortalRefusal(`no such ${type.name.one}`, 404);
    if (Object.entries(c.after).some(([k, v]) => !same(now[k], v)))
      throw new PortalRefusal("it changed since; undo the newer change first", 409);
    return editRecord(tx, type, id, { patch: c.before, by, undoes: c.id });
  });
}

export interface ChangeLine {
  id: number;
  at: string;
  by: string;
  via: ChangeVia;
  before: Values;
  after: Values;
  /** The change this one put back. */
  undoes: number | null;
  /** Put back since. */
  undone: boolean;
}

/** A record's changes, newest first. */
export async function historyOf(
  db: Queryable,
  type: RecordType,
  id: string,
): Promise<ChangeLine[]> {
  const rows = await db
    .select()
    .from(changes)
    .where(and(eq(changes.record, type.id), eq(changes.recordId, id)))
    .orderBy(desc(changes.id))
    .limit(HISTORY);
  const ids = rows.map((r) => r.id);
  const undone = new Set(
    ids.length
      ? (
          await db
            .select({ undoes: changes.undoes })
            .from(changes)
            .where(inArray(changes.undoes, ids))
        ).map((r) => r.undoes)
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    by: r.by,
    via: r.via,
    before: r.before,
    after: r.after,
    undoes: r.undoes,
    undone: undone.has(r.id),
  }));
}

/** What Claude's patch would do now: checked, and each field it changes, before and after. */
export interface Proposal {
  patch: Values;
  /** Why Accept would be refused; null when it would land. */
  problem: string | null;
  diff: { field: string; before: unknown; after: unknown }[];
}

export async function proposalOf(
  db: Queryable,
  type: RecordType,
  id: string,
  now: Values,
  patch: unknown,
): Promise<Proposal | null> {
  if (patch === null || patch === undefined) return null;
  const e = recordEdits(type);
  const got = e.patch.safeParse(patch);
  if (!got.success) return { patch: {}, problem: problemOf(got.error), diff: [] };
  const diff = Object.keys(got.data)
    .filter((k) => !same(now[k], got.data[k]))
    .map((field) => ({ field, before: now[field] ?? null, after: got.data[field] ?? null }));
  if (!diff.length) return null;
  const problem = (await e.check?.(got.data, now, db, id)) ?? null;
  return { patch: got.data, problem, diff };
}

/** One Ask Claude turn on a record: what he asked, what Claude said, and its patch. */
export interface AskTurn {
  run: string;
  at: string;
  by: string;
  message: string;
  state: "thinking" | "answered" | "failed";
  reply: string | null;
  proposal: Proposal | null;
  /** The change Accept made from it. */
  accepted: number | null;
}

type Asked = { record: string; id: string; by: string; message: string };

/** A record's asks, newest first, each patch checked against the values now. */
export async function askTurns(
  db: Queryable,
  type: RecordType,
  id: string,
  now: Values,
): Promise<AskTurn[]> {
  const rows = await db
    .select({
      id: runs.id,
      argv: runs.argv,
      at: runs.startedAt,
      done: runs.finishedAt,
      stats: runs.stats,
    })
    .from(runs)
    .where(
      and(
        eq(runs.command, ASK_COMMAND),
        sql`${runs.argv}->>'record' = ${type.id}`,
        sql`${runs.argv}->>'id' = ${id}`,
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(ASKS);
  const accepted = new Map(
    rows.length
      ? (
          await db
            .select({ run: changes.runId, id: changes.id })
            .from(changes)
            .where(
              and(
                isNotNull(changes.runId),
                inArray(
                  changes.runId,
                  rows.map((r) => r.id),
                ),
              ),
            )
        ).map((c) => [c.run, c.id])
      : [],
  );
  const out: AskTurn[] = [];
  for (const r of rows) {
    const a = r.argv as Asked;
    const s = (r.stats ?? {}) as { reply?: string; patch?: unknown; error?: string };
    const taken = accepted.get(r.id) ?? null;
    out.push({
      run: r.id,
      at: r.at.toISOString(),
      by: a.by,
      message: a.message,
      state: !r.done ? "thinking" : s.error ? "failed" : "answered",
      reply: s.error ?? s.reply ?? null,
      // Once accepted, the patch is what landed; its diff against now says nothing.
      proposal: taken || !r.done ? null : await proposalOf(db, type, id, now, s.patch),
      accepted: taken,
    });
  }
  return out;
}

/** The last edits people made here: Claude learns their taste from them. */
async function taught(db: Queryable, type: RecordType, id: string) {
  return db
    .select({ before: changes.before, after: changes.after, by: changes.by })
    .from(changes)
    .where(and(eq(changes.record, type.id), eq(changes.recordId, id), eq(changes.via, "person")))
    .orderBy(desc(changes.id))
    .limit(TAUGHT);
}

const SYSTEM = `You change one record in Wren's portal for Wren's team. You read the record, what it's for, its context and the team's last edits, then answer what was asked.
You never change anything yourself: a person reviews your patch as a diff and presses Accept.
Answer with one JSON object and nothing else: {"reply": "<one to three plain sentences>", "patch": <an object setting only the keys the schema allows, whole values, or null when nothing should change>}.
Match the team's voice from their edits. Short plain sentences, no em dashes, no filler. Never invent facts the record and context don't hold.`;

/** The question and system for Claude on one record. */
export async function askPrompt(
  db: Queryable,
  type: RecordType,
  id: string,
  row: object,
  message: string,
  by: string,
): Promise<{ question: string; system: string; values: Values }> {
  const e = recordEdits(type);
  const values = await e.read(db, id);
  if (!values) throw new PortalRefusal(`no such ${type.name.one}`, 404);
  const context = ((await e.context?.(db, id)) ?? "").slice(0, CONTEXT_MAX);
  const schema = z.toJSONSchema(e.patch, { io: "input", unrepresentable: "any" });
  const edits = await taught(db, type, id);
  const question = [
    `${by} asks about one ${type.name.one} (${type.id} ${id}):`,
    message,
    e.about ? `What it is: ${e.about}` : null,
    `The record as the page shows it:\n${JSON.stringify(row, null, 1)}`,
    `The values a patch may set, now:\n${JSON.stringify(values, null, 1)}`,
    `The patch's JSON schema:\n${JSON.stringify(schema)}`,
    context ? `Context:\n${context}` : null,
    edits.length
      ? `The team's last edits here, newest first:\n${edits
          .map((x) => `- ${x.by}: ${JSON.stringify(x.before)} -> ${JSON.stringify(x.after)}`)
          .join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { question, system: SYSTEM, values };
}

const ANSWER = z.object({ reply: z.string(), patch: z.record(z.string(), z.unknown()).nullish() });

/** Claude's `{reply, patch}`; words without JSON are a reply with no patch. */
export function askAnswerOf(text: string): { reply: string; patch: Values | null } {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  try {
    const got = ANSWER.safeParse(JSON.parse(text.slice(from, to + 1)));
    if (from >= 0 && got.success)
      return { reply: got.data.reply.trim(), patch: got.data.patch ?? null };
  } catch {
    // Not JSON: said in words.
  }
  return { reply: text.trim(), patch: null };
}

/** What a record's page gets to edit it: the values, their version, its history and asks. */
export interface EditState {
  values: Values;
  version: string;
  history: ChangeLine[];
  asks: AskTurn[];
}

export async function editState(
  db: Queryable,
  type: RecordType,
  id: string,
): Promise<EditState | null> {
  if (!type.edits) return null;
  const values = await type.edits.read(db, id);
  if (!values) return null;
  return {
    values,
    version: versionOf(values),
    history: await historyOf(db, type, id),
    asks: await askTurns(db, type, id, values),
  };
}
