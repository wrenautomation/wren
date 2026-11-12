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
  type TurnUndone,
  type UndoThroughChange,
  undoEvent,
  undoTurn,
} from "../../agent-changes.js";
import { findClient, normalEmail } from "../../clients/index.js";
import { undoChange } from "../../edits.js";
import { PortalRefusal, type PortalRequest, type SignedViewer, teamCan } from "../../portal.js";
import { changes } from "../../schema.js";
import type { ConsoleContext } from "./context.js";

export interface AgentChangesRequest extends PortalRequest {
  chat?: unknown;
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
    agentChanges: async (req: AgentChangesRequest): Promise<{ lines: AgentChangeLine[] }> => {
      team(req);
      const chat = chatOf(req);
      return { lines: await at(req, (db) => agentChanges(db, chat)) };
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
