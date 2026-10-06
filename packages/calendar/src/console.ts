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
import { markShowed } from "./book.js";
import { CALENDAR_CONSOLE_ROUTES } from "./console-routes.js";
import { type CalendarDeps, calendarFlows } from "./restate.js";
import type { Showed } from "./schema.js";

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
