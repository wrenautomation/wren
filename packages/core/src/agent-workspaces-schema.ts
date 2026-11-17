/**
 * Agent workspaces (designs/2026-11-05-variants.md, 11-17, W4): the project folders on William's
 * Mac where Vireo runs build a subject's samples, and the rules each run gets there. Main only;
 * written by the owner through `wren agent workspace set`, read by the relay on the Mac.
 */
import { jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const agentWorkspaces = pgTable(
  "agent_workspaces",
  {
    /** `portfolio`: lower case, `WORKSPACE_NAME` in @wren/agent/workspace */
    name: varchar("name", { length: 40 }).notNull(),
    /** `WorkspaceRules` in @wren/agent/workspace; checked there on every write */
    rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.name], name: "pk_agent_workspaces" })],
);
export type AgentWorkspaceRow = typeof agentWorkspaces.$inferSelect;
