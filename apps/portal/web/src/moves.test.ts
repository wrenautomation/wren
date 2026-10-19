/** Today's moves: the sources in order, a person's moves under their journey, strangers last. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Module } from "./module.js";

const rows: Record<string, unknown[]> = {};
const asked: string[] = [];
vi.mock("./api.js", () => ({
  call: async (path: string, body: Record<string, unknown>) => {
    if (path === "console/recordsCounts") {
      const asks = body.asks as { record: string }[];
      return { totals: asks.map((a) => (rows[a.record] ?? []).length) };
    }
    asked.push(`${body.record}:${JSON.stringify(body.where)}`);
    return { rows: rows[String(body.record)] ?? [] };
  },
}));

const { groupMoves, movesOf, sourcesOf, SOURCES } = await import("./moves.js");
const { readApps } = await import("./waiting.js");

const page = (id: string, record: string, count: Record<string, string[]>, hidden = false) => ({
  id,
  label: id,
  template: "list",
  record,
  count,
  ...(hidden ? { hidden: true } : {}),
});
const app = (id: string, pages: unknown[], parked = false) =>
  ({
    id,
    name: id,
    icon: "inbox",
    blurb: "",
    pages,
    ...(parked ? { parked: true } : {}),
  }) as unknown as Module;

const APPS = [
  app("inbox", [
    page("waiting", "marketing.inbox", { status: ["open"] }),
    page("approve", "marketing.approval", { state: ["new", "waiting"] }),
    page("replies", "email.reply", { state: ["needs_you"] }, true),
    page("asks", "access.ask", { state: ["open"], yours: ["yes"] }, true),
    page("calls", "email.call", { soon: ["yes"] }, true),
  ]),
  app("deals", [page("journeys", "pipeline.journey", { flag: ["stale"] })]),
];
const ALL = Object.fromEntries(
  APPS.map((m) => [m.id, Object.fromEntries(m.pages.map((p) => [p.id, 1]))]),
);

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  asked.length = 0;
});

describe("sources", () => {
  it("run in the order calls, approvals, inbox, replies, asks, stale journeys", () => {
    expect(SOURCES.map((s) => s.id)).toEqual(["call", "approve", "inbox", "reply", "ask", "stale"]);
    expect(sourcesOf(APPS, ALL).map((x) => x.s.id)).toEqual(SOURCES.map((s) => s.id));
  });

  it("read only where the page counts rows, with the page's filter", () => {
    const some = sourcesOf(APPS, { inbox: { replies: 2 } });
    expect(some.map((x) => [x.s.id, x.where])).toEqual([["reply", { state: ["needs_you"] }]]);
  });

  it("skip a parked app", () => {
    const parked = [app("inbox", APPS[0]?.pages ?? [], true), APPS[1] as Module];
    expect(sourcesOf(parked, ALL).map((x) => x.s.id)).toEqual(["stale"]);
  });
});

describe("parked apps", () => {
  it("are not counted", async () => {
    const apps = [
      app("inbox", [page("waiting", "marketing.inbox", { status: ["open"] })], true),
      app("deals", [page("journeys", "pipeline.journey", { flag: ["stale"] })]),
    ];
    rows["marketing.inbox"] = [{}, {}];
    rows["pipeline.journey"] = [{}];
    const { out } = await readApps(apps, "wren", true, true);
    expect(out).toEqual({ deals: { journeys: 1 } });
  });

  it("do not stop a hidden page that lists a move from counting, once", async () => {
    const apps = [
      app("inbox", [page("replies", "email.reply", { state: ["needs_you"] }, true)]),
      app("other", [
        page("replies2", "email.reply", { state: ["needs_you"] }, true),
        page("hid", "notes.mention", { state: ["unread"] }, true),
      ]),
    ];
    rows["email.reply"] = [{}, {}, {}];
    rows["notes.mention"] = [{}];
    const { out } = await readApps(apps, "wren", true, true);
    expect(out).toEqual({ inbox: { replies: 3 }, other: {} });
  });
});

describe("movesOf", () => {
  it("makes a line per source row, approvals one per kind, in source order", async () => {
    rows["email.call"] = [
      { id: "c1", who: "Ada North", email: "ada@example.test", start: "2026-10-17T19:00:00Z" },
    ];
    rows["marketing.approval"] = [
      { type: "draft", who: "Ada North" },
      { type: "invite", who: "Cai Moreno" },
      { type: "invite", who: "Dee Okafor" },
      { type: "video", who: "Wren" },
    ];
    rows["marketing.inbox"] = [
      { id: "dm:1", type: "dm", who: "Fay Lin" },
      { id: "a:2", type: "activity", who: "Kit Alder" },
      { id: "email:3", type: "email", who: "Ada North", url: "/inbox/replies/3" },
    ];
    rows["email.reply"] = [{ id: 1, who: "Bo Fenwick", email: "bo@example.test" }];
    rows["access.ask"] = [{ id: 1, email: "ivy@example.test" }];
    rows["pipeline.journey"] = [
      {
        id: "j2",
        name: "Bo Fenwick",
        funnelName: "Sales",
        stageLabel: "Engaged",
        daysInStage: 17,
        email: "bo@example.test",
      },
    ];
    const got = await movesOf(APPS, ALL);
    const all = got.groups.flatMap((g) => g.moves);
    expect(got.count).toBe(all.length);
    const text = all.map((m) => `${m.verb}: ${m.what}`).join("|");
    // Activity, a reply shown with the replies, and a draft (it is in Write) are not moves.
    expect(text).not.toMatch(/Kit|draft/i);
    expect(all.filter((m) => m.verb === "Reply").map((m) => m.what)).toEqual(["Bo", "Fay"]);
    // Order of sources, whatever the grouping: sort by the source index.
    const order = ["Prepare call", "Approve", "Reply", "Answer", "Nudge or drop"];
    const verbs = [...all].sort((a, b) => order.indexOf(a.verb) - order.indexOf(b.verb));
    expect(verbs.map((m) => m.verb)).toEqual([
      "Prepare call",
      "Approve",
      "Approve",
      "Reply",
      "Reply",
      "Answer",
      "Nudge or drop",
    ]);
    const approve = all.filter((m) => m.verb === "Approve");
    expect(approve.map((m) => [m.n, m.href])).toEqual([
      [2, "/engage/approve?view=invites"],
      [1, "/engage/approve?view=videos"],
    ]);
    expect(approve[0]?.what).toBe("First messages to new connections, Cai, Dee");
  });

  it("puts a person's moves under their journey and strangers last", async () => {
    rows["email.call"] = [
      { id: "c1", who: "Hana Ruiz", email: "hana@example.test", start: "2026-10-17T19:00:00Z" },
    ];
    rows["email.reply"] = [
      { id: 1, who: "Ada North", email: "ADA@example.test" },
      { id: 2, who: "Bo Fenwick", email: "bo@example.test" },
    ];
    rows["pipeline.journey"] = [
      {
        id: "j1",
        name: "Ada North",
        funnelName: "Sales",
        stageLabel: "Engaged",
        email: "ada@example.test",
      },
      {
        id: "j2",
        name: "Bo Fenwick",
        funnelName: "Sales",
        stageLabel: "Booked",
        daysInStage: 20,
        email: "bo@example.test",
      },
    ];
    const got = await movesOf(APPS, ALL);
    expect(got.groups.map((g) => g.head?.person ?? "Others")).toEqual([
      "Ada North",
      "Bo Fenwick",
      "Others",
    ]);
    expect(got.groups[1]?.moves.map((m) => m.verb)).toEqual(["Reply", "Nudge or drop"]);
    expect(got.groups[1]?.head).toMatchObject({ funnel: "Sales", stage: "Booked" });
    expect(got.groups[2]?.moves.map((m) => m.verb)).toEqual(["Prepare call"]);
  });

  it("reads nothing when no page counts rows", async () => {
    const got = await movesOf(APPS, {});
    expect(asked).toEqual([]);
    expect(got).toEqual({ groups: [], count: 0 });
  });
});

describe("groupMoves", () => {
  const move = (key: string, emails: string[] = [], journey?: string) => ({
    key,
    icon: "mail" as const,
    verb: "Reply",
    what: key,
    href: "/x",
    n: 1,
    emails,
    ...(journey ? { journey } : {}),
  });
  const line = (id: string, person: string, emails: string[]) => ({
    id,
    person,
    funnel: "F",
    stage: "S",
    emails,
  });

  it("keeps move order inside a group and group order by first move", () => {
    const out = groupMoves(
      [move("a", ["x@e.test"]), move("b"), move("c", ["y@e.test"]), move("d", ["x@e.test"])],
      [line("jx", "X", ["x@e.test"]), line("jy", "Y", ["y@e.test"])],
    );
    expect(out.map((g) => [g.key, g.moves.map((m) => m.key)])).toEqual([
      ["jx", ["a", "d"]],
      ["jy", ["c"]],
      ["others", ["b"]],
    ]);
  });

  it("puts a journey's own move under it by id", () => {
    const out = groupMoves([move("a", [], "jx")], [line("jx", "X", [])]);
    expect(out[0]?.head?.person).toBe("X");
  });
});
