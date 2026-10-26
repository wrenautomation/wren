import type { MetroBody } from "@wren/pipeline/metro";
import { describe, expect, it } from "vitest";
import {
  attachHref,
  focusAtOf,
  focusHref,
  focusKey,
  focusNumbers,
  focusOf,
  focusPeople,
} from "./focus.js";
import type { MapData, NodeNumbers, Person } from "./model.js";

const SOP = { kind: "sop" as const, ref: "booking", label: "Booking SOP" };
const LINK = { kind: "link" as const, ref: "https://example.test/deck" };

const metro: MetroBody = {
  model: "metro",
  name: "Sample",
  lines: [
    { id: "yt", label: "YouTube", tier: "out" },
    { id: "web", label: "Webinar", tier: "front", offer: "starter", colour: 0, attach: [LINK] },
  ],
  stations: [
    { id: "post", label: "Post a video", kind: "att", line: "yt", column: "marketing" },
    { id: "hub", label: "First touch", kind: "hub", column: "marketing" },
    { id: "reply", label: "Replied", kind: "att", line: "web", column: "sales" },
    { id: "book", label: "Booked", kind: "time", line: "web", column: "sales", attach: [SOP] },
    { id: "pay", label: "Paid", kind: "cash", line: "web", column: "money" },
  ],
  tracks: [],
  groups: [{ id: "g1", label: "Talk", line: "web", stations: ["reply", "book"] }],
  frames: [],
  flows: [
    {
      id: "intake",
      label: "Intake",
      stations: [
        { id: "form", label: "Form", kind: "att", column: "delivery", attach: [LINK] },
      ] as MetroBody["stations"],
      tracks: [],
    },
  ],
};

const row = (id: string, n: Partial<NodeNumbers>): [string, NodeNumbers] => [
  id,
  {
    id,
    now: null,
    arrived: null,
    left: null,
    medianDays: null,
    opened: null,
    replied: null,
    booked: null,
    deals: null,
    collected: null,
    scheduled: null,
    ...n,
  },
];

const person = (id: string, node: string): Person => ({
  id,
  name: id,
  node,
  nodeName: node,
  movedAt: null,
  daysAtNode: 1,
});

const data = {
  metro,
  stations: new Map([row("reply", { now: 2, arrived: 3 }), row("book", { now: 1, left: 4 })]),
  lines: new Map(),
  people: [person("j1", "book"), person("j2", "post"), person("j3", "reply")],
} as unknown as MapData;

describe("focus", () => {
  it("reads a part from the address, and nothing else", () => {
    expect(focusAtOf(["map", "line", "web"])).toEqual({ parts: [{ kind: "line", id: "web" }] });
    expect(focusAtOf(["map", "column", "sales"])).toBeNull();
    expect(focusAtOf(["map", "line"])).toBeNull();
    expect(focusAtOf(["map", "line", "web", "x"])).toBeNull();
    expect(focusAtOf(["content", "line", "web"])).toBeNull();
  });

  it("reads a set of parts and a saved view from the address", () => {
    expect(focusAtOf(["map", "parts", "line:web,group:g%2C1"])).toEqual({
      parts: [
        { kind: "line", id: "web" },
        { kind: "group", id: "g,1" },
      ],
    });
    expect(focusAtOf(["map", "parts", "column:x"])).toBeNull();
    expect(focusAtOf(["map", "view", "12"])).toEqual({ view: 12 });
    expect(focusAtOf(["map", "view", "0"])).toBeNull();
    expect(focusAtOf(["map", "view", "x"])).toBeNull();
  });

  it("writes one part as its own address, a set under /map/parts, a view under /map/view", () => {
    const keep = new URLSearchParams("window=30");
    const one = { kind: "line", id: "web" } as const;
    expect(focusHref([one], keep)).toBe(focusHref(one, keep));
    const set = focusHref([one, { kind: "group", id: "g,1" }], keep);
    expect(set).toBe(`/map/parts/${encodeURIComponent("line:web,group:g%2C1")}?window=30`);
    // The router reads each path piece once, decoded; the set comes back whole.
    const piece = decodeURIComponent(set.split("?")[0]?.split("/")[3] ?? "");
    const back = focusAtOf(["map", "parts", piece]);
    expect(back && focusKey(back)).toBe("line:web,group:g,1");
    expect(focusHref({ view: 7 }, keep)).toBe("/map/view/7?window=30");
  });

  it("keeps only the window and the workspace in a part's address", () => {
    const keep = new URLSearchParams("window=90&client=acme&node=book");
    expect(focusHref({ kind: "group", id: "g1" }, keep)).toBe(
      "/map/group/g1?window=90&client=acme",
    );
    expect(focusHref(null, new URLSearchParams())).toBe("/");
  });

  it("leads a station's crumbs through its line and group, and Esc goes to the group", () => {
    const f = focusOf(metro, [{ kind: "station", id: "book" }]);
    expect(f?.crumbs.map((c) => c.label)).toEqual(["Map", "Webinar", "Talk", "Booked"]);
    expect(f?.up.part).toEqual({ kind: "group", id: "g1" });
    expect(f?.own).toEqual([SOP]);
    // A station's own list is not repeated under "inside".
    expect(f?.inside).toEqual([]);
  });

  it("lists a line's own attachments and each station's inside it", () => {
    const f = focusOf(metro, [{ kind: "line", id: "web" }]);
    expect(f?.crumbs.map((c) => c.label)).toEqual(["Map", "Webinar"]);
    expect(f?.up.part).toBeNull();
    expect(f?.own).toEqual([LINK]);
    expect(f?.inside).toEqual([
      { part: { kind: "station", id: "book" }, label: "Booked", attach: [SOP] },
    ]);
    expect(f?.stations.map((s) => s.id)).toEqual(["reply", "book", "pay"]);
  });

  it("gives a flow no list of its own, only its stations'", () => {
    const f = focusOf(metro, [{ kind: "flow", id: "intake" }]);
    expect(f?.word).toBe("Shared flow");
    expect(f?.own).toBeNull();
    expect(f?.inside.map((s) => s.part.id)).toEqual(["form"]);
  });

  it("is null for a part the body does not hold", () => {
    expect(focusOf(metro, [{ kind: "group", id: "gone" }])).toBeNull();
    expect(focusOf(metro, [{ kind: "flow", id: "gone" }])).toBeNull();
  });

  it("sums a group's numbers and lists the people on its stations", () => {
    const f = focusOf(metro, [{ kind: "group", id: "g1" }]);
    if (!f) throw new Error("no focus");
    expect(focusNumbers(data, f)).toEqual(["Now: 3", "Arrived: 3", "Left: 4"]);
    expect(focusPeople(data, f).map((p) => p.id)).toEqual(["j1", "j3"]);
  });

  it("draws a set as one view: its name, each part's list, then each station's", () => {
    const f = focusOf(metro, [
      { kind: "line", id: "web" },
      { kind: "station", id: "book" },
      { kind: "flow", id: "intake" },
    ]);
    expect(f?.word).toBe("View");
    expect(f?.name).toBe("Webinar + Booked + Intake");
    expect(f?.part).toBeNull();
    expect(f?.own).toBeNull();
    expect(f?.crumbs.map((c) => c.label)).toEqual(["Map", "Webinar + Booked + Intake"]);
    expect(f?.up.part).toBeNull();
    // Booked is in the line and is a part: once, under the parts.
    expect(f?.stations.map((s) => s.id)).toEqual(["reply", "book", "pay", "form"]);
    expect(f?.inside.map((a) => `${a.part.kind}:${a.part.id}`)).toEqual([
      "line:web",
      "station:book",
      "station:form",
    ]);
  });

  it("names a saved view by its name, and drops the parts the body lost", () => {
    const f = focusOf(
      metro,
      [
        { kind: "group", id: "g1" },
        { kind: "line", id: "gone" },
      ],
      "Talk",
    );
    expect(f?.name).toBe("Talk");
    expect(f?.parts).toEqual([{ kind: "group", id: "g1" }]);
    expect(focusOf(metro, [{ kind: "line", id: "gone" }], "Talk")).toBeNull();
  });

  it("opens a URL as it is and an SOP in the Library", () => {
    expect(attachHref(LINK)).toBe(LINK.ref);
    expect(attachHref(SOP)).toBe("/library/sops/booking");
    expect(attachHref({ kind: "doc", ref: "d1" })).toBeNull();
  });
});
