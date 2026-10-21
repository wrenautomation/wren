/**
 * A fake workspace for the Inbox Overview (E): six queue records with rows that waited a set
 * number of hours (counted back from now, so "late" never drifts), and two period records whose
 * stats come back as a 30-day series. Synthetic data only.
 */
import { date, defineRecord, metaOf, name, type RecordMeta } from "@wren/core/records";
import type {
  ListAsk,
  Period,
  RecordsPage,
  RecordsStat,
  Row,
  StatsAsk,
} from "@wren/core/records/serve";
import type { OverviewTile } from "../overview.js";
import type { OverviewQueue } from "../overview-queues.js";
import type { RecordsApi } from "../records.js";
import { answer, fails, pending } from "./load.js";

const HOUR = 3_600_000;

const queueType = (id: string, wait: string, view: string) =>
  defineRecord({
    id,
    name: { one: "item", many: "items" },
    view: id.replace(".", "_"),
    key: "id",
    title: "who",
    app: "leads",
    channel: null,
    fields: { who: name("Who"), [wait]: date("Waiting since") },
    views: [{ id: view, label: "Waiting", sort: wait, at: wait }],
    related: [],
    actions: [],
  });

/** The six queues of the Inbox, as the module declares them (sample record ids). */
export const QUEUES: OverviewQueue[] = [
  {
    label: "Waiting on you",
    record: "demo.thread",
    view: "waiting",
    href: "#waiting",
    icon: "chat",
    line: 0,
    wait: "due",
    promise: "24h",
  },
  {
    label: "Issues for you",
    record: "demo.issue",
    view: "waiting",
    href: "#issues",
    icon: "alert",
    line: 2,
    wait: "at",
    promise: "24h",
  },
  {
    label: "To approve",
    record: "demo.approval",
    view: "waiting",
    href: "#approve",
    icon: "check",
    line: 1,
    wait: "due",
    promise: "24h",
  },
  {
    label: "Mail that needs you",
    record: "demo.mail",
    view: "needs_you",
    href: "#mail",
    icon: "mail",
    line: 3,
    wait: "at",
    promise: "24h",
  },
  {
    label: "Mentions",
    record: "demo.mention",
    view: "unread",
    href: "#mentions",
    icon: "at",
    wait: "at",
    promise: "24h",
  },
  {
    label: "Asks for access",
    record: "demo.ask",
    view: "waiting",
    href: "#asks",
    icon: "key",
    line: 1,
    wait: "at",
    promise: "24h",
  },
];

export const TILES: OverviewTile[] = [
  { label: "Replies", record: "demo.reply", href: "#replies?view=all", period: 30 },
  { label: "Booked", record: "demo.call", href: "#calls?view=all", period: 30 },
];

/** Hours each queue's rows have waited, oldest anywhere: two days, a day and a half, six hours... */
export const WAITS: Record<string, number[]> = {
  "demo.thread": [50, 30, 12, 3],
  "demo.issue": [30, 20, 9, 2],
  "demo.approval": [6, 4, 3, 2, 1],
  "demo.mail": [5, 1],
  "demo.mention": [3, 2, 2, 1],
  "demo.ask": [0.33],
};

const METAS: RecordMeta[] = [
  ...QUEUES.map((q) => metaOf(queueType(q.record, q.wait, q.view), false)),
  ...["demo.reply", "demo.call"].map((id) =>
    metaOf(
      defineRecord({
        id,
        name: { one: "item", many: "items" },
        view: id.replace(".", "_"),
        key: "id",
        title: "who",
        app: "leads",
        channel: null,
        fields: { who: name("Who"), at: date("When") },
        views: [{ id: "all", label: "All", sort: "-at", at: "at" }],
        related: [],
        actions: [],
      }),
      false,
    ),
  ),
];

type Mode = "ok" | "pending" | "fails";

export interface FakeOverviewOptions {
  /** Hours waited by record id; a record left out has nothing waiting. */
  waits?: Record<string, number[]>;
  /** The queue reads: `ok`, never (`pending`) or refused (`fails`). */
  list?: Mode;
  /** Record ids whose reads are refused, the rest answering. */
  failing?: string[];
  /** Replies and Booked: [this stretch, the one before]. */
  trends?: { reply: [number, number]; call: [number, number] };
  now?: number;
}

/** A series of `days` points that adds up to `total`, weighted so it has a shape. */
const series = (total: number, now: number, days: number): RecordsStat["series"] => {
  const weight = Array.from({ length: days }, (_, i) => 1 + ((i * 7) % 5));
  const sum = weight.reduce((x, y) => x + y, 0);
  let run = 0;
  let given = 0;
  return weight.map((w, i) => {
    run += (w / sum) * total;
    const value = Math.round(run) - given;
    given += value;
    return {
      at: new Date(now - (days - 1 - i) * 24 * HOUR).toISOString().slice(0, 10),
      value,
    };
  });
};

export function fakeOverview(o: FakeOverviewOptions = {}): RecordsApi {
  const waits = o.waits ?? WAITS;
  const now = o.now ?? Date.now();
  const trends = o.trends ?? { reply: [35, 21], call: [9, 6] };
  const list = (ask: ListAsk): RecordsPage => {
    const hours = [...(waits[ask.record] ?? [])];
    // The sort the page asks for: ascending by the wait date is the longest wait first.
    const rows: Row[] = hours
      .sort((a, b) => b - a)
      .slice(0, ask.limit ?? 50)
      .map((h, i) => {
        const wait = METAS.find((m) => m.id === ask.record)?.views[0]?.at ?? "at";
        return {
          id: i + 1,
          who: `Sample ${i + 1}`,
          [wait]: new Date(now - h * HOUR).toISOString(),
        };
      });
    return {
      record: ask.record,
      view: ask.view ?? null,
      rows,
      total: hours.length,
      counts: {},
      next: null,
      totals: {},
    };
  };
  const stats = (ask: StatsAsk): RecordsStat => {
    const [value, prior] = ask.record === "demo.reply" ? trends.reply : trends.call;
    const days = typeof ask.period === "number" ? ask.period : 30;
    return {
      record: ask.record,
      view: ask.view ?? null,
      value,
      prior,
      series: series(value, now, days as Exclude<Period, "month">),
      currency: null,
    };
  };
  const reads = (ask: { record: string }) =>
    o.failing?.includes(ask.record) ? fails<never>("Couldn't read this queue.")() : null;
  return {
    types: answer(METAS),
    list: (ask) =>
      reads(ask) ??
      (o.list === "pending"
        ? pending<RecordsPage>()()
        : o.list === "fails"
          ? fails<RecordsPage>()()
          : answer(list(ask))()),
    get: fails(),
    export: fails(),
    stats: (ask) => answer(stats(ask))(),
  };
}
