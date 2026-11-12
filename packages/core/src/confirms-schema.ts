/**
 * An agent's risky act waiting on a person (designs/2026-11-11-agent-panel.md, D2). Main only.
 * `gate` writes a pending row and stops the command; a person's Yes in the portal marks it; the
 * agent's same command, run again, finds the Yes and uses it once.
 */
import { oneOf } from "@wren/db/columns";
import { index, jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const RISKY_ACTS = ["send", "spend", "delete", "publish"] as const;
export type RiskyAct = (typeof RISKY_ACTS)[number];

/** pending → yes | no; yes → used when the command runs. */
export const CONFIRM_STATES = ["pending", "yes", "no", "used"] as const;
export type ConfirmState = (typeof CONFIRM_STATES)[number];

export const agentConfirms = pgTable(
  "agent_confirms",
  {
    id: varchar("id", { length: 16 }).notNull(),
    /** The agent chat (session id) that asked; null for a session outside the relay. */
    chat: text("chat"),
    turn: text("turn"),
    act: varchar("act", { length: 16, enum: RISKY_ACTS }).notNull(),
    /** Where it acts: a client id, or `wren`. */
    client: varchar("client", { length: 40 }).notNull(),
    /** What a person reads on the card: "Send 12 emails to Acme's list". */
    what: text("what").notNull(),
    /** The command as run: `{ command, argv }`. */
    args: jsonb("args").$type<{ command: string; argv: string[] }>().notNull(),
    /** sha256 of act, client and argv: the same command run again finds its Yes. */
    key: varchar("key", { length: 64 }).notNull(),
    state: varchar("state", { length: 8, enum: CONFIRM_STATES }).default("pending").notNull(),
    askedBy: text("asked_by").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_agent_confirms" }),
    oneOf("ck_agent_confirms_act", t.act, RISKY_ACTS),
    oneOf("ck_agent_confirms_state", t.state, CONFIRM_STATES),
    index("ix_agent_confirms_key").on(t.key, t.state),
    index("ix_agent_confirms_chat").on(t.chat, t.at),
  ],
);
export type AgentConfirm = typeof agentConfirms.$inferSelect;
