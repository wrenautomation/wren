/**
 * CalendarConsole: the Calendar app's buttons. Won, Not yet, No-show and Not a fit say how a past
 * call went, on its mirror in `call_bookings` (one outcome for every call, `@wren/core/calls`);
 * Clear takes that back. Won and Not yet move the call on the spine (`markOutcome`). Cancel
 * cancels an upcoming one the way the booker's link does: Google drops the event,
 * `call_bookings` marks it and the booker gets the cancel mail.
 */
import type * as restate from "@restatedev/restate-sdk";
import { markOutcome } from "@wren/channel-email/calls";
import { callBookings } from "@wren/channel-email/schema";
import type { MeetingOutcome } from "@wren/core/calls";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { callsBetween, mirrorUid } from "./book.js";
import { CALENDAR_CONSOLE_APPS, CALENDAR_CONSOLE_ROUTES } from "./console-routes.js";
import { type CalendarDeps, calendarFlows } from "./restate.js";
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

export function makeCalendarConsole(deps: CalendarDeps) {
  const { db } = deps;
  const flows = calendarFlows(deps);
  /** Say how calls went: on each one's mirror, then on the spine. `done` are calendar ids. */
  const outcome = (ctx: restate.Context, req: IdsRequest, value: MeetingOutcome | null) =>
    answer(async () => {
      const ids = idsOf(req);
      const mirrors = await ctx.run("mirrors", async () =>
        (
          await db
            .select({ id: callBookings.id, uid: callBookings.uid })
            .from(callBookings)
            .where(inArray(callBookings.uid, ids.map(mirrorUid)))
        ).map((r) => [r.id, Number(r.uid.slice("wren-".length))] as const),
      );
      const ours = new Map(mirrors);
      const marked = await markOutcome(ctx, db, null, {
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
    main: db,
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
            const from = new Date(req.from);
            const to = new Date(req.to);
            const span = to.getTime() - from.getTime();
            if (!(span > 0 && span <= MAX_RANGE))
              throw new PortalRefusal("a range up to 62 days", 400);
            const rules = await flows.rulesNow(ctx);
            const calls = await ctx.run("calls", async () =>
              (await callsBetween(db, deps.calendar, from, to)).map((c) => ({
                ...c,
                start: c.start.toISOString(),
                end: c.end.toISOString(),
              })),
            );
            const open = openHours(rules, from, to).map((s) => ({
              start: s.start.toISOString(),
              end: s.end.toISOString(),
            }));
            return { zone: rules.zone, length: rules.length, open, calls };
          }),
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
