/**
 * BooksConsole: Wren's team sets where an account's spend counts (unit economics) from the
 * console: its bucket and its channel. Needs `money` at Wren (`console-routes.ts`), and refuses
 * whoever `seesInternal` rejects; the Worker keeps the write off the demo.
 */
import type * as restate from "@restatedev/restate-sdk";
import { CHANNELS } from "@wren/core/clients";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, serializable, setAuditActor } from "@wren/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { BOOKS_CONSOLE_ROUTES } from "./console-routes.js";
import { accounts, BUCKETS } from "./schema.js";

/** A record action on accounts: their ids, as `books.account` keys them. */
export interface AccountRequest extends PortalRequest {
  ids: string[];
  /** Left out: unchanged. Empty or null: none. */
  bucket?: string | null;
  channel?: string | null;
}

/** A value from a form: undefined when not sent, null when blank, else one of `allowed`. */
const oneOf = <T extends string>(v: string | null | undefined, allowed: readonly T[]) => {
  if (v === undefined) return undefined;
  const t = v?.trim().toLowerCase() ?? "";
  if (!t) return null;
  if (!(allowed as readonly string[]).includes(t))
    throw new PortalRefusal(`it's one of ${allowed.join(", ")}`, 400);
  return t as T;
};

/** The handler as a plain function: the service wraps it, tests call it. */
export function booksConsoleApi(db: Db) {
  return {
    async setAccount(req: AccountRequest): Promise<{ done: string[] }> {
      if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
      const bucket = oneOf(req.bucket, BUCKETS);
      const channel = oneOf(req.channel, CHANNELS);
      if (bucket === undefined && channel === undefined)
        throw new PortalRefusal("say a bucket or a channel", 400);
      const ids = (req.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
      if (!ids.length) throw new PortalRefusal("no such account", 404);
      const rows = await serializable(db, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        return tx
          .update(accounts)
          .set({
            ...(bucket !== undefined ? { bucket } : {}),
            ...(channel !== undefined ? { channel } : {}),
          })
          .where(inArray(accounts.id, ids))
          .returning({ id: accounts.id });
      });
      return { done: rows.map((r) => String(r.id)) };
    },
  };
}

export function makeBooksConsole(db: Db) {
  const api = booksConsoleApi(db);
  return portalService({
    name: "BooksConsole",
    main: db,
    routes: BOOKS_CONSOLE_ROUTES,
    unnamed: "wren",
    handlers: {
      setAccount: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ids: z.array(z.string()),
            bucket: z
              .string()
              .nullish()
              .describe(`${BUCKETS.join(", ")}; empty = none`),
            channel: z
              .string()
              .nullish()
              .describe(`${CHANNELS.join(", ")}; empty = shared`),
          }),
        },
        (_: restate.Context, req: AccountRequest) => answer(() => api.setAccount(req)),
      ),
    },
  });
}
