/**
 * Portal speed (designs/2026-11-13-portal-speed.md): calls a caller waited on, per route and lane,
 * over the last day and week, from the runtime's `call_speed` view.
 */
import { date, defineRecord, duration, number, type RecordType, status, text } from "../records.js";
import type { AdminQuery } from "./runtime-admin.js";

const SPEED_SQL = "SELECT * FROM call_speed";

/** postgres numeric/float may come back as a string. */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export const speedRecord = (admin: AdminQuery): RecordType =>
  defineRecord({
    id: "console.speed",
    app: "office",
    channel: null,
    name: { one: "route", many: "routes" },
    rows: async () =>
      (await admin(SPEED_SQL)).map((r) => ({
        id: `${r.span}/${r.service}/${r.handler}/${r.lane}`,
        route: `${r.service}/${r.handler}`,
        span: r.span,
        lane: r.lane,
        calls: num(r.calls),
        p50: num(r.p50),
        p90: num(r.p90),
        p99: num(r.p99),
        wait_p90: num(r.wait_p90),
        run_p90: num(r.run_p90),
        failed: num(r.failed),
        last_at: r.last_at,
      })),
    key: "id",
    title: "route",
    subtitle: "lane",
    fields: {
      // a code name: kept as written, not split into words
      route: text("Route"),
      lane: status({
        box: { label: "Box", tone: "good" },
        lambda: { label: "Lambda", tone: "warn" },
        desk: { label: "Desk", tone: "neutral" },
      }),
      calls: number("Calls"),
      p50: duration("p50"),
      p90: duration("p90"),
      p99: duration("p99"),
      waitP90: duration("Wait p90"),
      runP90: duration("Run p90"),
      failed: number("Failed"),
      lastAt: date("Last call"),
      span: status({
        day: { label: "Today", tone: "neutral" },
        week: { label: "This week", tone: "neutral" },
      }),
    },
    views: [
      { id: "today", label: "Today", where: { span: "day" }, sort: "-p90", at: "lastAt" },
      { id: "week", label: "This week", where: { span: "week" }, sort: "-p90", at: "lastAt" },
    ],
  });
