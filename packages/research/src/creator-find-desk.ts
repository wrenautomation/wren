/**
 * The Mac's half of a Studio find (WA-1416 D2): the console sends here, this calls the desk's
 * pulled `studio` service, which runs `creator find` then `creator refresh` on the Mac. Private:
 * only CanonConsole sends.
 */
import type { Db } from "@wren/db";
import * as restate from "@wren/runtime";
import { findById, setFind } from "./creator-find.js";

export const CREATOR_FIND_DESK = { name: "CreatorFindDesk" } as const;
/** the Mac's studio service, as autobrowse's desk serves it; no import from that repo */
const STUDIO = { name: "studio" } as const;
type StudioCreators = {
  creatorFind: (ctx: restate.Context, req: { id: number }) => Promise<unknown>;
  creatorRead: (ctx: restate.Context, req: { ids: number[] }) => Promise<unknown>;
};

/** what the sheet says when the desk has no such handler yet */
const OLD_DESK = "the Mac runs an older desk";
const whyOf = (err: Error) =>
  /no (such )?handler|handler not found|not found|404/i.test(err.message)
    ? OLD_DESK
    : err.message.slice(-500);

export type CreatorFindDesk = {
  finding: (ctx: restate.Context, req: { id: number }) => Promise<void>;
  reading: (ctx: restate.Context, req: { ids: number[] }) => Promise<void>;
};

export function makeCreatorFindDesk(db: Db) {
  return restate.service({
    name: CREATOR_FIND_DESK.name,
    handlers: {
      finding: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: number }) => {
          try {
            await ctx.serviceClient<StudioCreators>(STUDIO).creatorFind({ id: req.id });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            const why = whyOf(err);
            await ctx.run("failed", async () => {
              // the CLI's own reason, when it got that far, says it best
              const f = await findById(db, req.id);
              if (f && f.state !== "found" && f.state !== "failed")
                await setFind(db, req.id, { state: "failed", step: null, error: why });
            });
          }
        },
      ),
      // a failed read lands on its creator row (`read_error`); nothing to write here
      reading: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { ids: number[] }) => {
          try {
            await ctx.serviceClient<StudioCreators>(STUDIO).creatorRead({ ids: req.ids });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
          }
        },
      ),
    },
  });
}
