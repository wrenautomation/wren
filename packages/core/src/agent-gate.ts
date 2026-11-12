/**
 * The agent's risky acts and the person's say (designs/2026-11-11-agent-panel.md, D2). Each risky
 * act calls `gate` first. A person's own command passes. An agent's runs at its level for that act:
 * `auto` runs, `off` refuses, `approve` stops with a pending confirm until a person says Yes in the
 * portal; the same command run again then uses the Yes once.
 */
import { createHash, randomBytes } from "node:crypto";
import { type Queryable, serializable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { WREN } from "./access.js";
import { normalEmail, settingsFor } from "./clients/index.js";
import { operators } from "./clients/schema.js";
import { type AgentConfirm, agentConfirms, type RiskyAct } from "./confirms-schema.js";
import { PortalRefusal } from "./portal.js";

export type Autonomy = "auto" | "approve" | "off";
const LEVELS: readonly Autonomy[] = ["auto", "approve", "off"];

/** The settings block a client (or Wren, in `wren_settings`) keeps the dial in. */
export const AUTONOMY = "autonomy";

/** Who runs the command. An agent's actor is `claude-code` or `claude-code:<person>`. */
export interface Runner {
  actor: string;
  chat?: string | undefined;
  turn?: string | undefined;
}

const AGENT = /^claude-code(:|$)/;
export const isAgent = (actor: string): boolean => AGENT.test(actor);

/** The chat's person: null for a session outside the relay (the Mac owner's own Claude Code). */
const personOf = (actor: string): string | null => {
  const p = actor.match(/^claude-code:(.+)$/)?.[1];
  return p && p !== "local" ? normalEmail(p) : null;
};

/** Stopped for a person's Yes: the command exits with `needs-confirm <id>`. */
export class NeedsConfirm extends Error {
  constructor(
    readonly id: string,
    readonly act: RiskyAct,
    readonly what: string,
  ) {
    super(`needs-confirm ${id}: ${what}. A person says Yes in the chat; then run it again.`);
    this.name = "NeedsConfirm";
  }
}

/**
 * The agent's level for one act where it acts. The client's (or Wren's) setting wins; else by the
 * chat's person: an admin's agent, or a session outside the relay, runs `auto`; anyone else's
 * runs `approve`.
 */
export async function autonomyOf(
  main: Queryable,
  actor: string,
  act: RiskyAct,
  client: string,
): Promise<Autonomy> {
  const block = (await settingsFor(main, client === WREN ? null : client))[AUTONOMY] as
    | Record<string, unknown>
    | undefined;
  const set = block?.[act];
  if (typeof set === "string" && (LEVELS as readonly string[]).includes(set))
    return set as Autonomy;
  const person = personOf(actor);
  if (!person) return "auto";
  const [op] = await main
    .select({ role: operators.role })
    .from(operators)
    .where(eq(operators.email, person));
  return op?.role === "admin" ? "auto" : "approve";
}

const keyOf = (act: RiskyAct, client: string, argv: readonly string[]) =>
  createHash("sha256")
    .update(JSON.stringify([act, client, argv]))
    .digest("hex");

/**
 * Before a risky act. Passes for a person; for an agent, by its level. Under `approve`: uses a Yes
 * for this exact command once, else writes a pending row and throws `NeedsConfirm`.
 */
export async function gate(
  main: Queryable,
  runner: Runner,
  o: { act: RiskyAct; client: string; what: string; command: string; argv: readonly string[] },
): Promise<void> {
  if (!isAgent(runner.actor)) return;
  const level = await autonomyOf(main, runner.actor, o.act, o.client);
  if (level === "auto") return;
  if (level === "off")
    throw new PortalRefusal(
      `The agent may not ${o.act} here. A person changes that in the client's settings.`,
      403,
    );
  const key = keyOf(o.act, o.client, o.argv);
  const stop = await serializable(main, async (tx) => {
    const [yes] = await tx
      .update(agentConfirms)
      .set({ state: "used", usedAt: new Date() })
      .where(
        eq(
          agentConfirms.id,
          sql`(SELECT id FROM agent_confirms WHERE key = ${key} AND state = 'yes' ORDER BY at LIMIT 1)`,
        ),
      )
      .returning({ id: agentConfirms.id });
    if (yes) return null;
    // the same ask, still open: one card, not one per retry; a No holds for this command
    const [last] = await tx
      .select({ id: agentConfirms.id, state: agentConfirms.state })
      .from(agentConfirms)
      .where(and(eq(agentConfirms.key, key), inArray(agentConfirms.state, ["pending", "no"])))
      .orderBy(desc(agentConfirms.at))
      .limit(1);
    if (last?.state === "no")
      throw new PortalRefusal("A person said no to this. Ask them in the chat first.", 403);
    if (last) return last.id;
    const id = randomBytes(6).toString("base64url");
    await tx.insert(agentConfirms).values({
      id,
      chat: runner.chat ?? null,
      turn: runner.turn ?? null,
      act: o.act,
      client: o.client,
      what: o.what,
      args: { command: o.command, argv: [...o.argv] },
      key,
      askedBy: runner.actor,
    });
    return id;
  });
  if (stop) throw new NeedsConfirm(stop, o.act, o.what);
}

/** A chat's asks, newest first: the cards. */
export async function confirmsOf(main: Queryable, chat: string): Promise<AgentConfirm[]> {
  return main
    .select()
    .from(agentConfirms)
    .where(eq(agentConfirms.chat, chat))
    .orderBy(desc(agentConfirms.at))
    .limit(100);
}

/**
 * A person's Yes or No. Never an agent's. The chat's own person or an admin decides; once only.
 */
export async function decideConfirm(
  main: Queryable,
  o: { id: string; yes: boolean; by: string; admin: boolean },
): Promise<AgentConfirm> {
  if (isAgent(o.by)) throw new PortalRefusal("the agent can't answer its own ask", 403);
  return serializable(main, async (tx) => {
    const [c] = await tx.select().from(agentConfirms).where(eq(agentConfirms.id, o.id));
    if (!c) throw new PortalRefusal("no such ask", 404);
    const asker = personOf(c.askedBy);
    if (!o.admin && asker !== normalEmail(o.by))
      throw new PortalRefusal("only the chat's person or an admin can answer it", 403);
    if (c.state !== "pending") throw new PortalRefusal(`answered already: ${c.state}`, 409);
    const [row] = await tx
      .update(agentConfirms)
      .set({ state: o.yes ? "yes" : "no", decidedBy: normalEmail(o.by), decidedAt: new Date() })
      .where(eq(agentConfirms.id, o.id))
      .returning();
    if (!row) throw new PortalRefusal("no such ask", 404);
    return row;
  });
}

/** An agent may not move its own dial. */
export function guardAutonomyChange(actor: string, paths: readonly string[]): void {
  if (isAgent(actor) && paths.some((p) => p === AUTONOMY || p.startsWith(`${AUTONOMY}.`)))
    throw new PortalRefusal("the agent can't change its own autonomy; a person does", 403);
}
