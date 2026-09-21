/**
 * The Friday report (E8) as a Virtual Object with one key. A pass writes the
 * week's numbers to `reports`, mails them, and sleeps until the next Friday
 * 19:00 on the fleet's clock. A failed pass retries next Friday too: the
 * numbers are the same queries the operator can run by hand, and a report
 * that arrives twice teaches nothing a late one does not.
 */
import type * as restate from "@restatedev/restate-sdk";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { untilNextReport } from "../report/schedule.js";
import { runWeeklyReport, type WeeklyReportStats } from "../report/send.js";
import type { SendPolicy } from "../send/policy.js";
import type { Transport } from "../send/transport.js";

export interface ReportSchedulerDeps {
  db: Db;
  transport: Transport;
  mail: { to: string; from: string };
  policy: SendPolicy;
}

export const REPORT_KEY = "weekly";
export const REPORT_COMMAND = "report weekly";

export function makeReportScheduler(deps: ReportSchedulerDeps) {
  return makeLoopObject("ReportScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const delay = untilNextReport(deps.policy, now);
    return runPass<WeeklyReportStats>(ctx, deps.db, now, {
      name: "weekly report",
      ledger: { command: REPORT_COMMAND, argv: { daemon: true, to: deps.mail.to } },
      body: (runId) =>
        runWeeklyReport({ db: deps.db, transport: deps.transport, mail: deps.mail, now, runId }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  });
}

export type ReportScheduler = ReturnType<typeof makeReportScheduler>;
