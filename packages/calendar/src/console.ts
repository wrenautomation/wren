/**
 * CalendarConsole: the Calendar app, Wren's and each client's. Won, Not yet, No-show and Not a
 * fit say how a past call went, on its mirror in `call_bookings` (one outcome for every call,
 * `@wren/core/calls`); Clear takes that back. Won and Not yet move the call on the spine
 * (`markOutcome`). Cancel cancels an upcoming one the way the booker's link does: Google drops
 * the event, `call_bookings` marks it and the booker gets the cancel mail (a client's only with
 * its sends on).
 *
 * No client named (or Wren's) is Wren's calendar, for Wren's team. A client named is that
 * client's, once `calendar.booking` is installed: its calls from its own database, and its calls
 * as records (`records*`) for the client's Calendar app.
 */
import * as restate from "@restatedev/restate-sdk";
import { markOutcome } from "@wren/channel-email/calls";
import { callBookings } from "@wren/channel-email/schema";
import { WREN } from "@wren/core/access";
import type { MeetingOutcome } from "@wren/core/calls";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, snapshot } from "@wren/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { callsBetween, mirrorUid } from "./book.js";
import { CALENDAR_CONSOLE_APPS, CALENDAR_CONSOLE_ROUTES } from "./console-routes.js";
import { CALENDAR_RECORDS } from "./records.js";
import {
  type CalendarDeps,
  type ClientCalendarDeps,
  calendarFlows,
  calendarOwner,
  ownerDeps,
} from "./restate.js";
import { CALENDAR, rulesOf } from "./rules.js";
import { openHours } from "./slots.js";

export interface IdsRequest extends PortalRequest {
  ids: string[];
  reason?: string | null;
}

const idsOf = (req: IdsRequest) => {
  const ids = (req.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw new PortalRefusal("nothing picked", 404);
  return ids;
};
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const IDS = { ...PORTAL_FIELDS, ids: z.array(z.string()) };
const MAX_RANGE = 62 * 24 * 3_600_000;

export interface RangeRequest extends PortalRequest {
  from: string;
  to: string;
}

export interface CalendarRange {
  zone: string;
  length: number;
  open: { start: string; end: string }[];
  calls: (Omit<Awaited<ReturnType<typeof callsBetween>>[number], "start" | "end"> & {
    start: string;
    end: string;
  })[];
}

/** A calendar's calls that touch [from, to) and its open hours there, as instants. */
export async function rangeOf(
  db: Db,
  calendar: string,
  settings: unknown,
  req: { from: string; to: string },
): Promise<CalendarRange> {
  const from = new Date(req.from);
  const to = new Date(req.to);
  const span = to.getTime() - from.getTime();
  if (!(span > 0 && span <= MAX_RANGE)) throw new PortalRefusal("a range up to 62 days", 400);
  let rules: ReturnType<typeof rulesOf>;
  try {
    rules = rulesOf(settings ?? {});
  } catch (err) {
    throw new PortalRefusal(`the calendar's settings don't parse: ${(err as Error).message}`, 503);
  }
  const calls = (await callsBetween(db, calendar, from, to)).map((c) => ({
    ...c,
    start: c.start.toISOString(),
    end: c.end.toISOString(),
  }));
  const open = openHours(rules, from, to).map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
  }));
  return { zone: rules.zone, length: rules.length, open, calls };
}

export interface CalendarConsoleDeps {
  /** Wren's own calendar, on main. */
  wren: CalendarDeps;
  /** Clients' calendars; unset = Wren's only. */
  clients?: ClientCalendarDeps;
}

/** Wren's own calendar for a request with no client named, else the client's. */
const isWren = (req: PortalRequest) => !req.client || req.client === WREN;

/** The client records half, as plain functions: the service wraps them, the preview calls them. */
export function calendarRecordsApi(main: Db, open: ClientCalendarDeps["open"]) {
  const installed = async (req: PortalRequest) => {
    if (isWren(req)) throw new PortalRefusal("Wren's calls are under the console", 404);
    const client = await pickClient(main, req);
    if (!Object.hasOwn(client.products ?? {}, CALENDAR))
      throw new PortalRefusal("Booking calendar is not installed", 404);
    return client;
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await installed(req);
    return snapshot(open(client), (tx) =>
      use(serveRecords(CALENDAR_RECORDS, tx, undefined, fenceFor(req, client.id))),
    );
  };
  return {
    installed,
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await installed(req)).id);
      return CALENDAR_RECORDS.filter((t) => !fence || opens(t, fence(t))).map((t) =>
        metaOf(t, false),
      );
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
    /** A client's week: its calls from its own database, its open hours from its settings. */
    range: async (req: RangeRequest) => {
      const client = await installed(req);
      return rangeOf(open(client), client.id, client.products[CALENDAR], req);
    },
  };
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };

export function makeCalendarConsole(deps: CalendarConsoleDeps) {
  const wren = calendarFlows(deps.wren);
  const records = deps.clients ? calendarRecordsApi(deps.clients.main, deps.clients.open) : null;
  const clientsOnly = () => {
    if (!records) throw new PortalRefusal("not found", 404);
    return records;
  };

  /** Where a request works: Wren's calendar (the team only), or a client's, read in one step. */
  const placeOf = async (ctx: restate.Context, req: PortalRequest, write: boolean) => {
    if (isWren(req)) {
      if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
      return { db: deps.wren.db, client: null, flows: wren };
    }
    const d = deps.clients;
    if (!d) throw new PortalRefusal("not found", 404);
    const id = await ctx.run("client", () =>
      answer(async () => {
        const c = write ? (await pickForWrite(d.main, req)).client : await pickClient(d.main, req);
        return c.id;
      }),
    );
    const owner = await ctx.run("owner", () =>
      answer(async () => {
        try {
          return await calendarOwner(d.main, d.portal, id);
        } catch (err) {
          if (err instanceof restate.TerminalError)
            throw new PortalRefusal("Booking calendar is not installed", 404);
          throw err;
        }
      }),
    );
    const cd = ownerDeps(d, owner);
    return { db: cd.db, client: owner.id, flows: calendarFlows(cd) };
  };

  /** Say how calls went: on each one's mirror, then on the spine. `done` are calendar ids. */
  const outcome = (ctx: restate.Context, req: IdsRequest, value: MeetingOutcome | null) =>
    answer(async () => {
      const ids = idsOf(req);
      const { db, client } = await placeOf(ctx, req, true);
      const mirrors = await ctx.run("mirrors", async () =>
        (
          await db
            .select({ id: callBookings.id, uid: callBookings.uid })
            .from(callBookings)
            .where(inArray(callBookings.uid, ids.map(mirrorUid)))
        ).map((r) => [r.id, Number(r.uid.slice("wren-".length))] as const),
      );
      const ours = new Map(mirrors);
      const marked = await markOutcome(ctx, db, client, {
        ids: [...ours.keys()],
        outcome: value,
        reason: req.reason ?? null,
        by: by(req),
      });
      if (!marked.changed && value)
        throw new PortalRefusal("only a booked call that has started can be marked", 409);
      return { changed: marked.changed, done: marked.done.map((id) => ours.get(id)) };
    });
  return portalService({
    name: "CalendarConsole",
    main: deps.wren.db,
    routes: CALENDAR_CONSOLE_ROUTES,
    apps: CALENDAR_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      /**
       * The Calendar app's week, day, month or list: the calls that touch [from, to), and the
       * open hours there as instants, so the app shades them on the viewer's own clock.
       */
      range: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            from: z.string().describe("ISO instant"),
            to: z.string().describe("ISO instant, at most 62 days after from"),
          }),
        },
        (ctx: restate.Context, req: RangeRequest) =>
          answer(async () => {
            if (!isWren(req)) return ctx.run("range", () => answer(() => clientsOnly().range(req)));
            if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
            const settings = await ctx.run("rules", async () => (await deps.wren.settings()) ?? {});
            return ctx.run("range", () =>
              answer(() => rangeOf(deps.wren.db, deps.wren.calendar, settings, req)),
            );
          }),
      ),
      recordsTypes: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => clientsOnly().recordsTypes(req)),
      ),
      recordsList: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => clientsOnly().recordsList(req)),
      ),
      recordsGet: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => clientsOnly().recordsGet(req)),
      ),
      recordsExport: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => clientsOnly().recordsExport(req)),
      ),
      recordsStats: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => clientsOnly().recordsStats(req)),
      ),
      won: serviceHandler({ input: z.looseObject(IDS) }, (ctx: restate.Context, req: IdsRequest) =>
        outcome(ctx, req, "won"),
      ),
      notYet: serviceHandler(
        {
          input: z.looseObject({
            ...IDS,
            reason: z.string().max(500).nullish().describe("Why not yet, in your words"),
          }),
        },
        (ctx: restate.Context, req: IdsRequest) => outcome(ctx, req, "not_yet"),
      ),
      noShow: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) => outcome(ctx, req, "no_show"),
      ),
      notFit: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) => outcome(ctx, req, "not_fit"),
      ),
      /** Takes an outcome back: the undo for all four. */
      clear: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) => outcome(ctx, req, null),
      ),
      cancel: serviceHandler(
        {
          input: z.looseObject({
            ...IDS,
            reason: z.string().max(500).nullish().describe("Why, kept on the call"),
          }),
          effect: "sends",
        },
        (ctx: restate.Context, req: IdsRequest) =>
          answer(async () => {
            const ids = idsOf(req);
            const { flows } = await placeOf(ctx, req, true);
            let cancelled = 0;
            for (const id of ids) {
              const v = await flows.cancel(ctx, id, {
                by: by(req),
                reason: req.reason?.trim() || null,
              });
              if (v.state === "cancelled") cancelled++;
            }
            return { cancelled };
          }),
      ),
    },
  });
}
