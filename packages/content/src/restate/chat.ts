/**
 * Chat (designs/2026-10-09-site-chat.md): the site bubble's two calls, through the portal Worker,
 * which names the owner from the host. `say` keeps a visitor's message; `read` hands back what's
 * new. A refusal comes back as `{ status, error }` for the Worker to answer with.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { type ChatLine, ChatRefusal, readChat, say } from "../chat/store.js";

export interface ChatDeps {
  db: Db;
  clientDb?: (client: string) => Db;
}

interface Req {
  /** The host's owner: a client, or null for Wren. */
  client: string | null;
  key?: unknown;
  body?: unknown;
  name?: unknown;
  contact?: unknown;
  page?: unknown;
  after?: unknown;
}

type Answer = { status: number; error: string } | { status: 200; key?: string; lines: ChatLine[] };

const refused = (e: unknown): Answer => {
  if (e instanceof ChatRefusal) return { status: e.status, error: e.message };
  throw e;
};

export function makeChat(deps: ChatDeps) {
  const dbOf = (client: string | null): Db => {
    if (!client) return deps.db;
    if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
    return deps.clientDb(client);
  };
  return restate.service({
    name: "Chat",
    handlers: {
      /** A visitor's message: kept, with what's new since `after`; the key once, on a new thread. */
      say: async (ctx: restate.Context, req: Req): Promise<Answer> =>
        ctx.run("say", async () => {
          try {
            const r = await say(dbOf(req.client ?? null), { ...req, body: req.body });
            return { status: 200 as const, key: r.key, lines: r.lines };
          } catch (e) {
            return refused(e);
          }
        }),
      /** What's new in the visitor's thread since `after`. A read only: no step to journal. */
      read: async (_ctx: restate.Context, req: Req): Promise<Answer> => {
        try {
          return {
            status: 200,
            lines: await readChat(dbOf(req.client ?? null), req.key, req.after),
          };
        } catch (e) {
          return refused(e);
        }
      },
    },
  });
}
export type Chat = ReturnType<typeof makeChat>;
