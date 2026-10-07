/**
 * CalendarConsole: the Calendar app's buttons. Held and No-show say how a past call went (the
 * no-shows view reads it), and Clear takes that back. Cancel cancels an upcoming one the way
 * the booker's link does: Google drops the event, `call_bookings` marks it and the booker gets
 * the cancel mail.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { atomic, setAuditActor } from "@wren/db";
import { z } from "zod";
import { callsBetween, markShowed } from "./book.js";
import { CALENDAR_CONSOLE_ROUTES } from "./console-routes.js";
import { type CalendarDeps, calendarFlows } from "./restate.js";
import type { Showed } from "./schema.js";
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
  const showed = (ctx: restate.Context, req: IdsRequest, value: Showed | null) =>
    answer(async () => {
      const ids = idsOf(req);
      const now = new Date(await ctx.date.now());
      return ctx.run(`showed ${value ?? "unsaid"}`, () =>
        atomic(db, async (tx) => {
          await setAuditActor(tx, by(req));
          let changed = 0;
          for (const id of ids) if (await markShowed(tx, { id, showed: value, now })) changed++;
          return { changed };
        }),
      );
    });
  return portalService({
    name: "CalendarConsole",
    main: db,
    routes: CALENDAR_CONSOLE_ROUTES,
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
      held: serviceHandler({ input: z.looseObject(IDS) }, (ctx: restate.Context, req: IdsRequest) =>
        showed(ctx, req, "held"),
      ),
      noShow: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) => showed(ctx, req, "no_show"),
      ),
      /** Takes back Held or No-show: the undo for both. */
      clear: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) => showed(ctx, req, null),
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
