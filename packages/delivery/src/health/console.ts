/**
 * HealthConsole: the Clients app's hands on health and flags (designs/2026-10-07-health.md).
 * Wren's rating and an override on a client's health; raise, take, assign, address and clear a
 * flag. Reading is the console's records (`./records.ts`). The demo changes nothing.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import { z } from "zod";
import { HEALTH_CONSOLE_APPS, HEALTH_CONSOLE_ROUTES } from "./console-routes.js";
import { addressFlag, clearFlag, FlagRefusal, ownFlag, raiseFlag } from "./flags.js";
import { clearOverride, overrideHealth, rateClient } from "./hand.js";
import { FLAG_SIDES, type FlagSide } from "./schema.js";

export interface IdsRequest extends PortalRequest {
  ids?: string[];
}
export interface RateRequest extends IdsRequest {
  score?: unknown;
  note?: string | null;
}
export interface OverrideRequest extends IdsRequest {
  score?: unknown;
  reason?: string | null;
}
export interface RaiseRequest extends IdsRequest {
  /** The client's id, from the flags list's form; else the health record's `ids`. */
  clientId?: string | null;
  side?: string | null;
  what?: string | null;
  owner?: string | null;
}
export interface OwnRequest extends IdsRequest {
  owner?: string | null;
}
export interface AddressRequest extends IdsRequest {
  note?: string | null;
}

const blank = (v: string | null | undefined) => v?.trim() || null;
const picked = (req: IdsRequest) => {
  const ids = (req.ids ?? []).map(String).filter(Boolean);
  if (!ids.length) throw new PortalRefusal("nothing picked", 404);
  return ids;
};
const flagIds = (req: IdsRequest) => {
  const ids = picked(req).map(Number);
  if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0))
    throw new PortalRefusal("no such flag", 404);
  return ids;
};
const whole = (v: unknown, what: string) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isInteger(n)) throw new PortalRefusal(`${what} is a whole number`, 400);
  return n;
};

/** The handlers as plain functions: the service wraps them, tests call them. */
export function healthConsoleApi(db: Db) {
  /** Who's writing, inside one transaction that logs them; a refusal is the caller's to read. */
  const write = async <T>(req: PortalRequest, fn: (tx: Tx, by: string) => Promise<T>) => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const by = (req.viewer as SignedViewer).email;
    return atomic(db, async (tx) => {
      await setAuditActor(tx, by);
      try {
        return await fn(tx, by);
      } catch (err) {
        if (err instanceof FlagRefusal) throw new PortalRefusal(err.message, 409);
        throw err;
      }
    });
  };
  const each = <T>(req: IdsRequest, fn: (tx: Tx, by: string, id: string) => Promise<T>) =>
    write(req, async (tx, by) => {
      const ids = picked(req);
      for (const id of ids) await fn(tx, by, id);
      return { done: ids };
    });

  return {
    /** Wren's 1 to 5 read of each picked client; it counts in sentiment from the next pass. */
    rate: async (req: RateRequest) => {
      const score = whole(req.score, "a rating");
      return each(req, (tx, by, clientId) =>
        rateClient(tx, { clientId, score, note: blank(req.note), by }),
      );
    },
    /** A score over the model's, with why; it stands until cleared. */
    override: async (req: OverrideRequest) => {
      const score = whole(req.score, "an override");
      return each(req, (tx, by, clientId) =>
        overrideHealth(tx, { clientId, score, reason: req.reason ?? "", by }),
      );
    },
    clearOverride: (req: IdsRequest) => each(req, (tx, by, id) => clearOverride(tx, id, by)),
    /** A person's flag about a client, from the flags list's form or a client's health. */
    flagRaise: (req: RaiseRequest) =>
      write(req, async (tx, by) => {
        const side = (blank(req.side)?.toLowerCase() ?? "risk") as FlagSide;
        if (!FLAG_SIDES.includes(side)) throw new PortalRefusal("a risk or an opportunity", 400);
        const clients = blank(req.clientId) ? [blank(req.clientId) as string] : picked(req);
        const done: string[] = [];
        for (const clientId of clients) {
          const f = await raiseFlag(tx, {
            clientId,
            side,
            what: req.what ?? "",
            owner: blank(req.owner),
            by,
          });
          done.push(String(f.id));
        }
        return { done, id: done[0] };
      }),
    /** The picked flags are the viewer's. */
    flagTake: (req: IdsRequest) =>
      write(req, async (tx, by) => {
        const ids = flagIds(req);
        for (const id of ids) await ownFlag(tx, id, by);
        return { done: ids.map(String) };
      }),
    /** Assigned to a teammate's address; blank is the team's. */
    flagOwn: (req: OwnRequest) =>
      write(req, async (tx) => {
        const owner = blank(req.owner);
        if (owner && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner))
          throw new PortalRefusal("an email address, or blank for the team", 400);
        const ids = flagIds(req);
        for (const id of ids) await ownFlag(tx, id, owner);
        return { done: ids.map(String) };
      }),
    flagAddress: (req: AddressRequest) =>
      write(req, async (tx, by) => {
        const ids = flagIds(req);
        for (const id of ids) await addressFlag(tx, id, by, blank(req.note));
        return { done: ids.map(String) };
      }),
    flagClear: (req: IdsRequest) =>
      write(req, async (tx, by) => {
        const ids = flagIds(req);
        for (const id of ids) await clearFlag(tx, id, by);
        return { done: ids.map(String) };
      }),
  };
}
export type HealthConsoleApi = ReturnType<typeof healthConsoleApi>;

export function makeHealthConsole(db: Db) {
  const api = healthConsoleApi(db);
  /** A write: journaled once, so a retry returns the same answer and never writes twice. */
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  const text = z.string().max(2000).nullish();
  const score = z.union([z.number(), z.string().max(8)]).describe("A whole number");
  const form = (more: z.ZodRawShape = {}) =>
    z.looseObject({
      ...PORTAL_FIELDS,
      ids: z.array(z.union([z.string(), z.number()])).optional(),
      ...more,
    });
  return portalService({
    name: "HealthConsole",
    main: db,
    routes: HEALTH_CONSOLE_ROUTES,
    apps: HEALTH_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      rate: serviceHandler({ input: form({ score, note: text }) }, write("rate", api.rate)),
      override: serviceHandler(
        { input: form({ score, reason: text }) },
        write("override", api.override),
      ),
      clearOverride: serviceHandler({ input: form() }, write("clearOverride", api.clearOverride)),
      flagRaise: serviceHandler(
        {
          input: form({
            clientId: z.string().max(64).nullish(),
            side: z.string().max(16).nullish(),
            what: text,
            owner: z.string().max(320).nullish(),
          }),
        },
        write("flagRaise", api.flagRaise),
      ),
      flagTake: serviceHandler({ input: form() }, write("flagTake", api.flagTake)),
      flagOwn: serviceHandler(
        { input: form({ owner: z.string().max(320).nullish() }) },
        write("flagOwn", api.flagOwn),
      ),
      flagAddress: serviceHandler(
        { input: form({ note: text }) },
        write("flagAddress", api.flagAddress),
      ),
      flagClear: serviceHandler({ input: form() }, write("flagClear", api.flagClear)),
    },
  });
}
