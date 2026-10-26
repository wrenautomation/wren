/**
 * Decide's two logs (designs/2026-10-16-decide.md): every machine answer, and every call William
 * made on the same thing. Append-only, in every database. The pair is the training set a model of
 * our own (Laya) learns from.
 */
import { oneOf } from "@wren/db/columns";
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * What a decision is about. A new kind is a new entry here and in `KINDS` (`decide/kinds.ts`).
 * `document` and `finding` are the ingestion engine's (designs/2026-10-25-ingestion-engine.md):
 * a read piece (`doc:<id>`) and one fact of it (its finding's key, `doc:<id>/<path>`).
 */
export const DECISION_KINDS = ["comment_quality", "document", "lead_fit", "finding"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/**
 * What a kind's answers do. `off`: not asked. `shadow`: logged only. `recommend`: a chip beside
 * the row. `gate`: filters what he sees (never what he approves).
 */
export const DECIDE_MODES = ["off", "shadow", "recommend", "gate"] as const;
export type DecideMode = (typeof DECIDE_MODES)[number];

export const decisions = pgTable(
  "decisions",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 40, enum: DECISION_KINDS }).notNull(),
    /** The thing judged: a draft's Inbox id (`thread:<id>`), `doc:<id>`. */
    subject: varchar("subject", { length: 200 }).notNull(),
    /** The kind's mode when it was asked: whether he saw the answer. */
    mode: varchar("mode", { length: 10, enum: DECIDE_MODES }).notNull(),
    /** `jev`, `laya`, `gateway`. */
    backend: varchar("backend", { length: 20 }).notNull(),
    /** The model that answered (`jev-1.13.0`), as the backend said. */
    model: varchar("model", { length: 100 }).notNull(),
    /** What it was shown. Never a handle or a name. */
    state: jsonb("state").notNull(),
    questions: jsonb("questions").notNull(),
    /** The backend's answers, whole; null when it failed. */
    answers: jsonb("answers"),
    /** The kind's label from the answers (`send`, `skip`). */
    label: varchar("label", { length: 40 }),
    /** Probability the thing is kept (`send` or `edit`; `worth`). */
    p: doublePrecision("p"),
    confidence: doublePrecision("confidence"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** US dollars this answer cost. */
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms"),
    /** Why it has no answer: the backend refused the input. */
    error: text("error"),
    /** `<kind>:<subject>:<backend>:<state hash>`: the same question is bought once. */
    ref: varchar("ref", { length: 300 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_decisions" }),
    unique("uq_decisions_ref").on(t.ref),
    index("ix_decisions_subject").on(t.kind, t.subject, t.at),
    index("ix_decisions_kind_at").on(t.kind, t.at),
    oneOf("ck_decisions_kind", t.kind, DECISION_KINDS),
    oneOf("ck_decisions_mode", t.mode, DECIDE_MODES),
  ],
);
export type DecisionRow = typeof decisions.$inferSelect;

export const decisionCalls = pgTable(
  "decision_calls",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 40, enum: DECISION_KINDS }).notNull(),
    subject: varchar("subject", { length: 200 }).notNull(),
    /** His call, in the kind's labels. */
    label: varchar("label", { length: 40 }).notNull(),
    /** Kept (sent, worth) or not: what agreement is counted on. */
    keep: boolean("keep").notNull(),
    /** Where it was made: `sent`, `rejected`, `star`, `archive`, `backfill:…`. */
    source: varchar("source", { length: 40 }).notNull(),
    /** His email, `cli`, `console`; null when the step didn't say. */
    by: varchar("by", { length: 320 }),
    /** The newest decision on the subject when he called it; null when none was asked yet. */
    decisionId: integer("decision_id"),
    /** He and the machine kept or dropped alike; null with no decision. */
    agreed: boolean("agreed"),
    /** He went against a pick he was shown (recommend or gate). */
    override: boolean("override").notNull().default(false),
    /** Unique when set: a replayed step or a second backfill adds nothing. */
    ref: varchar("ref", { length: 300 }),
    /** His words with the call, when he gave any ("no comment-a-word CTAs"). */
    comment: text("comment"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_decision_calls" }),
    unique("uq_decision_calls_ref").on(t.ref),
    index("ix_decision_calls_subject").on(t.kind, t.subject, t.at),
    index("ix_decision_calls_decision_id").on(t.decisionId),
    foreignKey({
      columns: [t.decisionId],
      foreignColumns: [decisions.id],
      name: "fk_decision_calls_decision_id_decisions",
    }).onDelete("set null"),
    oneOf("ck_decision_calls_kind", t.kind, DECISION_KINDS),
  ],
);
export type DecisionCallRow = typeof decisionCalls.$inferSelect;
