/**
 * An agent chat's Changes list and its Undo (`../../agent-changes.ts`). Lines live where the
 * writes went: Wren's database, or a client's for a chat that used `--client`.
 */
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { WREN } from "../../access.js";
import {
  type AgentChangeLine,
  agentChanges,
  chatOwner,
  recordsOfTables,
  type TurnUndone,
  type UndoThroughChange,
  undoEvent,
  undoTurn,
} from "../../agent-changes.js";
import {
  type Autonomy,
  autonomyOf,
  autonomySet,
  confirmsOf,
  decideConfirm,
  setAutonomy,
} from "../../agent-gate.js";
import { findClient, normalEmail } from "../../clients/index.js";
import type { AgentConfirm } from "../../confirms-schema.js";
import { RISKY_ACTS, type RiskyAct } from "../../confirms-schema.js";
import { undoChange } from "../../edits.js";
import { PortalRefusal, type PortalRequest, type SignedViewer, teamCan } from "../../portal.js";
import { changes } from "../../schema.js";
import type { ConsoleContext } from "./context.js";

export interface AgentChangesRequest extends PortalRequest {
  chat?: unknown;
}

export interface AgentDecideRequest extends PortalRequest {
  id?: unknown;
  yes?: unknown;
}

export interface AgentUndoRequest extends AgentChangesRequest {
  event?: unknown;
  turn?: unknown;
}

const chatOf = (req: AgentChangesRequest): string => {
  if (typeof req.chat !== "string" || !req.chat || req.chat.length > 100)
    throw new PortalRefusal("say which chat", 400);
  return req.chat;
};

export interface AgentAutonomyRequest extends PortalRequest {
  /** act → level; null clears it back to the default. */
  change?: unknown;
}

/** One client's dial: what is set, and what each act runs at for your own agent. */
export interface AutonomyView {
  set: Partial<Record<RiskyAct, Autonomy>>;
  yours: Record<RiskyAct, Autonomy>;
}

export function agentHandlers(ctx: ConsoleContext) {
  const { main, team, onClientDb, typesFor } = ctx;
  /** Wren's database, or the client's the request names. */
  const at = async <T>(req: PortalRequest, fn: (db: Queryable) => Promise<T>): Promise<T> => {
    if (!req.client || req.client === WREN) return fn(main);
    const client = await findClient(main, req.client);
    if (!client) throw new PortalRefusal("no such client", 404);
    return onClientDb(client, (db) => {
      if (!db) throw new PortalRefusal("this worker can't reach the client's database", 503);
      return fn(db);
    });
  };
  /** An edit made through `editRecord` undoes through `undoChange`, so its history stays whole. */
  const viaChange =
    (req: PortalRequest): UndoThroughChange =>
    async (tx, change, by) => {
      const [c] = await tx
        .select({ record: changes.record, id: changes.recordId })
        .from(changes)
        .where(eq(changes.id, change));
      const t = c && (await typesFor(req)).find((x) => x.id === c.record);
      if (!c || !t?.edits) throw new PortalRefusal("that edit's record can't be undone here", 409);
      await undoChange(tx, t, c.id, change, by);
    };
  return {
    /** A chat's asks for a person's Yes: its cards. Asks live on Wren's database. */
    agentConfirms: async (req: AgentChangesRequest): Promise<{ asks: AgentConfirm[] }> => {
      team(req);
      return { asks: await confirmsOf(main, chatOf(req)) };
    },
    /** A person's Yes or No to one ask; the agent's same command, run again, uses the Yes. */
    agentDecide: async (req: AgentDecideRequest): Promise<AgentConfirm> => {
      team(req);
      if (typeof req.id !== "string" || !req.id) throw new PortalRefusal("say which ask", 400);
      if (typeof req.yes !== "boolean") throw new PortalRefusal("say yes or no", 400);
      return decideConfirm(main, {
        id: req.id,
        yes: req.yes,
        by: normalEmail((req.viewer as SignedViewer).email),
        admin: teamCan(req, "manage", WREN),
      });
    },
    agentAutonomy: async (req: PortalRequest): Promise<AutonomyView> => {
      team(req);
      const client = req.client || WREN;
      const actor = `claude-code:${normalEmail((req.viewer as SignedViewer).email)}`;
      const levels = await Promise.all(RISKY_ACTS.map((a) => autonomyOf(main, actor, a, client)));
      return {
        set: await autonomySet(main, client),
        yours: Object.fromEntries(
          RISKY_ACTS.map((a, i) => [a, levels[i]]),
        ) as AutonomyView["yours"],
      };
    },
    /** A person moves one client's dial: `manage` on that client. */
    agentAutonomySet: async (req: AgentAutonomyRequest): Promise<AutonomyView["set"]> => {
      team(req);
      if (!req.change || typeof req.change !== "object")
        throw new PortalRefusal("say what to set", 400);
      return setAutonomy(
        main,
        req.client || WREN,
        req.change as Partial<Record<RiskyAct, Autonomy | null>>,
        normalEmail((req.viewer as SignedViewer).email),
      );
    },
    agentChanges: async (req: AgentChangesRequest): Promise<{ lines: AgentChangeLine[] }> => {
      team(req);
      const chat = chatOf(req);
      const types = await typesFor(req);
      return {
        lines: await at(req, async (db) => {
          const [lines, fed] = await Promise.all([
            agentChanges(db, chat),
            recordsOfTables(db, types),
          ]);
          return lines.map((l) => ({ ...l, records: fed.get(l.table) ?? [] }));
        }),
      };
    },
    /** One line (`event`) or a whole turn. The chat's own person, or an admin. */
    agentUndo: async (req: AgentUndoRequest): Promise<TurnUndone> => {
      team(req);
      const chat = chatOf(req);
      const by = normalEmail((req.viewer as SignedViewer).email);
      return at(req, async (db) => {
        const owner = await chatOwner(db, chat);
        if ((!owner || normalEmail(owner) !== by) && !teamCan(req, "manage", WREN))
          throw new PortalRefusal("only the chat's person or an admin can undo it", 403);
        // a client's database has no record types of Wren's: write the row back directly
        const through = db === main ? viaChange(req) : undefined;
        if (typeof req.event === "string" || typeof req.event === "number") {
          const event = String(req.event);
          await undoEvent(db, { chat, event, by, viaChange: through });
          return { undone: [event] };
        }
        if (typeof req.turn !== "string" || !req.turn)
          throw new PortalRefusal("say which change or turn", 400);
        return undoTurn(db, { chat, turn: req.turn, by, viaChange: through });
      });
    },
  };
}
