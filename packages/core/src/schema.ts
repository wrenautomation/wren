import { baseColumns, nonNegative } from "@wren/db/columns";
import { index, integer, pgTable, real, varchar } from "drizzle-orm/pg-core";

/** One row per LLM request, any channel. Source of truth for spend. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    ...baseColumns,
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    promptName: varchar("prompt_name", { length: 64 }).notNull(),
    promptHash: varchar("prompt_hash", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(), // draft | edit | research | judge
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    seconds: real("seconds").notNull().default(0),
    requestId: varchar("request_id", { length: 128 }),
  },
  (t) => [
    index("ix_llm_calls_created_at").on(t.createdAt),
    index("ix_llm_calls_stage").on(t.stage),
    ...nonNegative("llm_calls", {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheReadTokens: t.cacheReadTokens,
      costUsd: t.costUsd,
      seconds: t.seconds,
    }),
  ],
);
export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;
