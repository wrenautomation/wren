/**
 * `ClientReport/<id>` (designs/2026-10-09-client-reports.md): sleeps until the report's next
 * Monday or 1st at 9:00, runs it, sleeps again. A save starts a new chain; a turn from an older
 * chain does nothing, as ConnectorSync's.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  delayTo,
  nextRunAt,
  type ReportDeps,
  reportById,
  runReport,
  setNextAt,
} from "../client-reports/store.js";

type ClientReportObject = ReturnType<typeof makeClientReport>;
const REPORT = { name: "ClientReport" } as unknown as ClientReportObject;

/** Start (or restart) a report's chain: its next run, worked out from now. */
export const startReport = (ctx: restate.Context, id: number) =>
  ctx.objectSendClient(REPORT, String(id)).run({});

export function makeClientReport(deps: ReportDeps) {
  return restate.object({
    name: "ClientReport",
    handlers: {
      run: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (
          ctx: restate.ObjectContext,
          req: { chain?: string },
        ): Promise<{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null }> => {
          if (req.chain && req.chain !== (await ctx.get<string>("chain")))
            return { state: "stale", nextAt: null };
          const id = Number(ctx.key);
          const now = new Date(await ctx.date.now());
          const r = await ctx.run("report", async () => {
            const x = await reportById(deps.main, id);
            return x ? { on: x.on, every: x.every, zone: x.zone } : null;
          });
          if (!r?.on) {
            ctx.clear("chain");
            return { state: "off", nextAt: null };
          }
          // A turn of the chain is a due run; a start only works out when.
          if (req.chain)
            await ctx.run("run", async () => {
              await runReport(deps, { id, at: now, closed: true });
            });
          const next = nextRunAt(r.every, r.zone, now);
          await ctx.run("next", () => setNextAt(deps.main, id, next));
          const chain = ctx.rand.uuidv4();
          ctx.set("chain", chain);
          ctx
            .objectSendClient(REPORT, ctx.key)
            .run({ chain }, restate.rpc.sendOpts({ delay: delayTo(next, now) }));
          return { state: req.chain ? "ran" : "waiting", nextAt: next.toISOString() };
        },
      ),
    },
  });
}
