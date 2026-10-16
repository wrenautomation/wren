/**
 * The seam (designs/2026-10-16-decide.md): `decide` asks a backend about one subject and keeps
 * the whole answer as a `decisions` row (`calls.ts` keeps William's own call beside it). Nothing
 * here changes what he sees approved or sent: a human call always wins.
 */
import { createHash } from "node:crypto";
import type { EntryType } from "@typesafe-ai/sdk";
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { settingsFor, setWrenSettings } from "../clients/index.js";
import { type DecisionRow, decisions } from "../decide-schema.js";
import { LIMITS } from "../restate/limits.js";
import { costOf, type DecideBackend, failureOf } from "./backends.js";
import {
  DECIDE_MODES,
  DECISION_KINDS,
  type DecideMode,
  type DecisionKind,
  KINDS,
  type LabelSpec,
  machineLabel,
} from "./kinds.js";

export const DECIDE_COMPONENT = "decide";
/** The daily cap before William sets one, in US dollars. */
export const DEFAULT_DAILY_USD = 1;

export const decideSettingsSchema = z
  .object({
    kinds: z
      .partialRecord(z.enum(DECISION_KINDS), z.object({ mode: z.enum(DECIDE_MODES) }).strict())
      .optional(),
    dailyUsd: z.number().min(0).max(100).optional(),
  })
  .strict();
export type DecideSettings = z.infer<typeof decideSettingsSchema>;

/** Wren's saved block; one that doesn't read is the defaults. */
export async function decideSettings(db: Queryable): Promise<DecideSettings> {
  const got = decideSettingsSchema.safeParse((await settingsFor(db, null))[DECIDE_COMPONENT] ?? {});
  return got.success ? got.data : {};
}

/** Each kind's mode: saved, else its default. */
export async function decideModes(db: Queryable): Promise<Record<DecisionKind, DecideMode>> {
  const s = await decideSettings(db);
  return Object.fromEntries(
    DECISION_KINDS.map((k) => [k, s.kinds?.[k]?.mode ?? KINDS[k].defaultMode]),
  ) as Record<DecisionKind, DecideMode>;
}

/** Set one kind's mode. `gate` is refused until the kind has a gate filter built. */
export async function setDecideMode(
  db: Queryable,
  kind: DecisionKind,
  mode: DecideMode,
  by: string,
): Promise<DecideSettings> {
  if (mode === "gate" && !KINDS[kind].gate)
    throw new Error(`${KINDS[kind].name} has no gate filter yet: recommend is the most it does`);
  const s = await decideSettings(db);
  const next: DecideSettings = { ...s, kinds: { ...s.kinds, [kind]: { mode } } };
  await setWrenSettings(db, DECIDE_COMPONENT, next, by);
  return next;
}

/** Dollars spent since the start of `now`'s UTC day. */
export async function spentToday(db: Queryable, now: Date): Promise<number> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${decisions.costUsd}), 0)::float8` })
    .from(decisions)
    .where(gte(decisions.at, day));
  return Number(r?.usd ?? 0);
}

/** The key or account was refused: the pass stops, nothing else is tried. */
export class DecideStop extends Error {
  override name = "DecideStop";
}

const stateHash = (state: unknown) =>
  createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);

export interface DecideInput {
  kind: DecisionKind;
  subject: string;
  /** What the backend is shown, as JSON. Never a handle or a name. */
  state: Record<string, unknown>;
  mode: DecideMode;
  /** The first answers; the rest stand by for an outage. */
  chain: readonly DecideBackend[];
  /** The longest one call waits. */
  limitMs?: number;
}

/**
 * Ask about one subject and keep the answer. The same state under the same first backend is
 * bought once: a second ask returns the row already kept. A refused input is kept as an error
 * row (never asked again); an outage on every backend throws, and the next pass tries again.
 * Null when deciding is off.
 */
export async function decide(db: Queryable, d: DecideInput): Promise<DecisionRow | null> {
  const first = d.chain[0];
  if (d.mode === "off" || !first) return null;
  const ref = `${d.kind}:${d.subject}:${first.name}:${stateHash(d.state)}`;
  const [kept] = await db.select().from(decisions).where(eq(decisions.ref, ref));
  if (kept) return kept;
  const questions = KINDS[d.kind].questions;
  let lastErr: unknown = null;
  for (const b of d.chain) {
    const t0 = Date.now();
    try {
      const r = await b.ask(
        { state: d.state as EntryType, questions },
        { signal: AbortSignal.timeout(d.limitMs ?? LIMITS.http) },
      );
      const m = machineLabel(d.kind, r.answers);
      return await keep(db, {
        kind: d.kind,
        subject: d.subject,
        mode: d.mode,
        backend: b.name,
        model: r.model,
        state: d.state,
        questions,
        answers: r.answers,
        label: m?.label ?? null,
        p: m?.p ?? null,
        confidence: m?.confidence ?? null,
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        costUsd: costOf(b.price, r.usage),
        latencyMs: Date.now() - t0,
        error: m ? null : "no label in the answers",
        ref,
      });
    } catch (err) {
      const f = failureOf(err);
      if (f === "key")
        throw new DecideStop(`${b.name} refused the key: ${String(err).slice(0, 200)}`);
      if (f === "refused")
        return await keep(db, {
          kind: d.kind,
          subject: d.subject,
          mode: d.mode,
          backend: b.name,
          model: "-",
          state: d.state,
          questions,
          latencyMs: Date.now() - t0,
          error: String(err).slice(0, 500),
          ref,
        });
      lastErr = err;
    }
  }
  throw lastErr;
}

async function keep(db: Queryable, row: typeof decisions.$inferInsert): Promise<DecisionRow> {
  const [r] = await db
    .insert(decisions)
    .values(row)
    .onConflictDoNothing({ target: decisions.ref })
    .returning();
  if (r) return r;
  const [k] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.ref, row.ref ?? ""));
  if (!k) throw new Error("decision lost");
  return k;
}

/** The newest decision with an answer on a subject. */
export async function newestDecision(
  db: Queryable,
  kind: DecisionKind,
  subject: string,
): Promise<DecisionRow | null> {
  const [r] = await db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.kind, kind),
        eq(decisions.subject, subject),
        sql`${decisions.label} is not null`,
      ),
    )
    .orderBy(desc(decisions.at), desc(decisions.id))
    .limit(1);
  return r ?? null;
}

/** A pick as a list shows it: the label and the chance it is kept. */
export interface Pick {
  label: string;
  p: number | null;
}

/**
 * Each subject's newest pick, when the kind shows its picks (recommend or gate). In shadow or off
 * nothing shows, so this answers an empty map without reading.
 */
export async function picksOf(
  db: Queryable,
  kind: DecisionKind,
  subjects: readonly string[],
): Promise<Map<string, Pick>> {
  const shown = new Map<string, Pick>();
  if (!subjects.length) return shown;
  const mode = (await decideModes(db))[kind];
  if (mode !== "recommend" && mode !== "gate") return shown;
  const rows = (await db.execute(sql`
    select distinct on (subject) subject, label, p from decisions
    where kind = ${kind} and label is not null
      and subject in (${sql.join(
        subjects.map((s) => sql`${s}`),
        sql`, `,
      )})
    order by subject, at desc, id desc`)) as unknown as {
    subject: string;
    label: string;
    p: number | null;
  }[];
  for (const r of rows) shown.set(r.subject, { label: r.label, p: r.p });
  return shown;
}

/** A kind's labels as a list's status states: label, tone, what it means. */
export function pickStates(kind: DecisionKind) {
  return Object.fromEntries(
    Object.entries(KINDS[kind].labels).map(([id, l]) => [
      id,
      { label: l.name, tone: l.tone, about: l.about },
    ]),
  ) as Record<string, { label: string; tone: LabelSpec["tone"]; about: string }>;
}
