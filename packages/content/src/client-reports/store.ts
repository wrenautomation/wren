/**
 * Client reports (designs/2026-10-09-client-reports.md): save and list them, work out when each
 * runs, read one period's numbers through `recordsStats`, keep the run, mail each member theirs.
 */
import { reach } from "@wren/core/access";
import { type Client, clients, listMembers } from "@wren/core/clients";
import { whoIs } from "@wren/core/portal";
import type { RecordType } from "@wren/core/records";
import { type Fence, type Period, serveRecords, statWindows } from "@wren/core/records/serve";
import { canonicalZone, wallClock, zonedInstant } from "@wren/core/time";
import { type Db, snapshot } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ClientReport,
  type ClientReportSend,
  clientReportSends,
  clientReports,
} from "./schema.js";
import {
  changeOf,
  MAX_RECIPIENTS,
  MAX_REPORTS,
  REPORT_HOUR,
  REPORT_TILES,
  type ReportEvery,
  type ReportLine,
  type ReportTileId,
  shown,
} from "./tiles.js";

export class ReportRefusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** One plain message from portal@. */
export interface ReportMail {
  to: string;
  subject: string;
  text: string;
}

export interface ReportDeps {
  main: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** The record types a client's Marketing serves. */
  records: readonly RecordType[];
  /** Mail from portal@; absent or `on` false keeps runs unmailed. */
  mail?: { send: (m: ReportMail) => Promise<void>; on: boolean; portal: string } | undefined;
}

export interface ReportInput {
  name: string;
  tiles: readonly string[];
  every: ReportEvery;
  zone: string;
  recipients: readonly string[];
  on: boolean;
}

/** The runs kept per report on its page. */
export const SENDS_SHOWN = 12;

const norm = (e: string) => e.trim().toLowerCase();

/** The next run strictly after `now`: Monday (or the 1st) at 9:00 in `zone`. */
export function nextRunAt(every: ReportEvery, zone: string, now: Date): Date {
  const w = wallClock(zone, now);
  for (let i = 0; i <= 62; i++) {
    // Walk calendar days from today in the zone: UTC noon keeps the date math off DST edges.
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + i, 12));
    const hit = every === "week" ? d.getUTCDay() === 1 : d.getUTCDate() === 1;
    if (!hit) continue;
    const at = zonedInstant(
      zone,
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      REPORT_HOUR,
    );
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error(`no ${every} run within two months of ${now.toISOString()}`);
}

/**
 * The period a run reads, as `stats` takes it: `now` is the instant the stat reads up to. A
 * closed run ends at the midnight that started its day (Monday's, the 1st's), so it reads the
 * whole week or month before. Run now reads the last 7 days, or this month so far.
 */
export function periodOf(
  every: ReportEvery,
  zone: string,
  at: Date,
  closed: boolean,
): { period: Period; now: Date; from: Date; to: Date } {
  const period: Period = every === "week" ? 7 : "month";
  let now = at;
  if (closed) {
    const w = wallClock(zone, at);
    now = new Date(zonedInstant(zone, w.year, w.month, w.day).getTime() - 1);
  }
  return { period, now, from: statWindows(period, zone, now).from, to: now };
}

const checkZone = (zone: string) => {
  const z = canonicalZone(zone);
  if (!z) throw new ReportRefusal("no such time zone");
  return z;
};

/** The tiles a type list serves, in the catalog's order. */
const tilesOf = (ids: readonly string[]): ReportTileId[] => {
  const known = REPORT_TILES.filter((t) => ids.includes(t.id)).map((t) => t.id);
  if (!known.length) throw new ReportRefusal("pick at least one number");
  if (known.length !== new Set(ids).size) throw new ReportRefusal("that number isn't in reports");
  return known;
};

/** Reports, their last runs, and the members who may get them. */
export async function reportsOf(main: Db, client: string) {
  const reports = await main
    .select()
    .from(clientReports)
    .where(eq(clientReports.client, client))
    .orderBy(clientReports.id);
  const sends = reports.length
    ? await main
        .select()
        .from(clientReportSends)
        .where(
          inArray(
            clientReportSends.reportId,
            reports.map((r) => r.id),
          ),
        )
        .orderBy(desc(clientReportSends.at))
    : [];
  const members = (await listMembers(main, client)).map((m) => ({ email: m.email, role: m.role }));
  return {
    reports: reports.map((r) => ({
      ...view(r),
      sends: sends
        .filter((s) => s.reportId === r.id)
        .slice(0, SENDS_SHOWN)
        .map(sendView),
    })),
    members,
  };
}

const view = (r: ClientReport) => ({
  id: r.id,
  name: r.name,
  tiles: r.tiles,
  every: r.every,
  zone: r.zone,
  recipients: r.recipients,
  on: r.on,
  nextAt: r.on && r.nextAt ? r.nextAt.toISOString() : null,
  by: r.by,
  updatedAt: r.updatedAt.toISOString(),
});
const sendView = (s: ClientReportSend) => ({
  id: s.id,
  from: s.from.toISOString(),
  to: s.to.toISOString(),
  closed: s.closed,
  lines: s.lines,
  sentTo: s.sentTo,
  why: s.why,
  by: s.by,
  at: s.at.toISOString(),
});
export type ReportView = ReturnType<typeof view> & { sends: ReturnType<typeof sendView>[] };

/** A new report (no `id`) or a change to one; its next run is worked out from now. */
export async function saveReport(
  main: Db,
  o: { client: string; id?: number | null; input: ReportInput; by: string; now: Date },
): Promise<ClientReport> {
  const { input } = o;
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ReportRefusal("name it, in 120 characters or fewer");
  const zone = checkZone(input.zone);
  const tiles = tilesOf(input.tiles);
  const recipients = [...new Set(input.recipients.map(norm))];
  if (recipients.length > MAX_RECIPIENTS)
    throw new ReportRefusal(`${MAX_RECIPIENTS} people at most`);
  const members = new Set((await listMembers(main, o.client)).map((m) => norm(m.email)));
  const strangers = recipients.filter((e) => !members.has(e));
  if (strangers.length)
    throw new ReportRefusal(`${strangers.join(", ")} isn't in this workspace. Invite them first.`);
  const nextAt = input.on ? nextRunAt(input.every, zone, o.now) : null;
  const set = { name, tiles, every: input.every, zone, recipients, on: input.on, nextAt };
  if (o.id) {
    const [r] = await main
      .update(clientReports)
      .set({ ...set, updatedAt: o.now })
      .where(and(eq(clientReports.id, o.id), eq(clientReports.client, o.client)))
      .returning();
    if (!r) throw new ReportRefusal("no such report", 404);
    return r;
  }
  const [{ n } = { n: 0 }] = await main
    .select({ n: sql<number>`count(*)::int` })
    .from(clientReports)
    .where(eq(clientReports.client, o.client));
  if (n >= MAX_REPORTS) throw new ReportRefusal(`${MAX_REPORTS} reports at most`, 409);
  const [r] = await main
    .insert(clientReports)
    .values({ client: o.client, ...set, by: o.by })
    .returning();
  if (!r) throw new Error("report insert returned nothing");
  return r;
}

export async function deleteReport(main: Db, client: string, id: number): Promise<void> {
  const gone = await main
    .delete(clientReports)
    .where(and(eq(clientReports.id, id), eq(clientReports.client, client)))
    .returning({ id: clientReports.id });
  if (!gone.length) throw new ReportRefusal("no such report", 404);
}

export async function reportById(main: Db, id: number): Promise<ClientReport | null> {
  const [r] = await main.select().from(clientReports).where(eq(clientReports.id, id));
  return r ?? null;
}

/** When the chain wakes next, kept so the page can say it. */
export async function setNextAt(main: Db, id: number, at: Date | null): Promise<void> {
  await main.update(clientReports).set({ nextAt: at }).where(eq(clientReports.id, id));
}

/** One period's numbers as a fence reads them; a type the fence shuts is left out. */
async function readLines(
  db: Db,
  records: readonly RecordType[],
  tiles: readonly ReportTileId[],
  p: { period: Period; now: Date },
  zone: string,
  fence?: Fence,
): Promise<ReportLine[]> {
  return snapshot(db, async (tx) => {
    const api = serveRecords(records, tx, undefined, fence);
    const out: ReportLine[] = [];
    for (const id of tiles) {
      const tile = REPORT_TILES.find((t) => t.id === id);
      const type = records.find((r) => r.id === tile?.record);
      if (!tile || !type) continue;
      const r = fence?.(type);
      if (r && r.ids.length === 0 && !(typeof type.channel === "object" && r.channels.length))
        continue;
      try {
        const view = type.views.some((v) => v.id === tile.view) ? tile.view : type.views[0]?.id;
        const s = await api.stats(
          { record: tile.record, ...(view ? { view } : {}), sum: tile.sum, period: p.period, zone },
          p.now,
        );
        out.push({
          tile: id,
          label: tile.label,
          value: s.value,
          prior: s.prior,
          currency: s.currency,
        });
      } catch (err) {
        out.push({
          tile: id,
          label: tile.label,
          value: null,
          prior: null,
          currency: null,
          error: err instanceof Error ? err.message.slice(0, 200) : "the read failed",
        });
      }
    }
    return out;
  });
}

const dayName = (d: Date, zone: string) =>
  d.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" });

/** The mail: one line a number, its change, and the link to the full view. */
export function reportText(o: {
  report: Pick<ClientReport, "name" | "zone">;
  client: string;
  from: Date;
  to: Date;
  lines: readonly ReportLine[];
  portal: string;
}): { subject: string; text: string } {
  const span = `${dayName(o.from, o.report.zone)} to ${dayName(o.to, o.report.zone)}`;
  const body = o.lines.map((l) => {
    const c = changeOf(l);
    return `${l.label}: ${shown(l)}${c && c !== "same" ? ` (${c === "new" ? "new" : `${c} on the period before`})` : ""}`;
  });
  return {
    subject: `${o.report.name}, ${span}`,
    text: [
      `${o.report.name} for ${o.client}, ${span}.`,
      "",
      ...body,
      "",
      `Every number, and past reports: ${o.portal.replace(/\/$/, "")}/marketing/reports`,
      "",
      "You get this because you're on this report in Wren. An owner can take you off it there.",
    ].join("\n"),
  };
}

/**
 * Run one report: read its period as the workspace sees it and keep that; a closed run with mail
 * on also mails each recipient the numbers their own access reaches.
 */
export async function runReport(
  deps: ReportDeps,
  o: { id: number; at: Date; closed: boolean; by?: string | null },
): Promise<ClientReportSend | null> {
  const { main } = deps;
  const r = await reportById(main, o.id);
  if (!r) return null;
  const client = await clientOf(main, r.client);
  if (!client) return null;
  const db = deps.open(client);
  const p = periodOf(r.every, r.zone, o.at, o.closed);
  const lines = await readLines(db, deps.records, r.tiles, p, r.zone);
  const sentTo: string[] = [];
  let why: string | null = null;
  if (!o.closed) why = "Run now: kept here, mailed to nobody";
  else if (!deps.mail?.on) why = "Kept, mail is off";
  else if (!r.recipients.length) why = "Nobody is on it";
  else {
    const failed: string[] = [];
    for (const email of r.recipients) {
      const who = await whoIs(main, { email }, r.client);
      if (!who || "demo" in who) {
        failed.push(`${email} left the workspace`);
        continue;
      }
      const fence: Fence = (t) =>
        reach(who, "read", { client: r.client, app: t.app, type: t.id, channel: t.channel });
      const theirs = await readLines(db, deps.records, r.tiles, p, r.zone, fence);
      if (!theirs.length) {
        failed.push(`${email} can't see these numbers`);
        continue;
      }
      try {
        await deps.mail.send({
          to: email,
          ...reportText({
            report: r,
            client: client.name,
            from: p.from,
            to: p.to,
            lines: theirs,
            portal: deps.mail.portal,
          }),
        });
        sentTo.push(email);
      } catch (err) {
        failed.push(`${email}: ${err instanceof Error ? err.message.slice(0, 120) : "not sent"}`);
      }
    }
    if (failed.length) why = failed.join("; ");
  }
  const [s] = await main
    .insert(clientReportSends)
    .values({
      reportId: r.id,
      from: p.from,
      to: p.to,
      closed: o.closed,
      lines,
      sentTo,
      why,
      by: o.by ?? null,
      at: o.at,
    })
    .returning();
  return s ?? null;
}

async function clientOf(main: Db, id: string) {
  const [c] = await main.select().from(clients).where(eq(clients.id, id));
  return c ?? null;
}

/** How long until `at`, never below zero. */
export const delayTo = (at: Date, now: Date) => Math.max(0, at.getTime() - now.getTime());
