import { columns, homeAt, mapAt, PathError, wholeAt } from "@wren/core/paths";
import type { MetroBody } from "@wren/pipeline/metro";
import { describe, expect, it } from "vitest";
import { type MetroSource, metroTree } from "./metro-tree.js";

// one line: find → (group "ask": ask, then a station also named "ask" under the line) → won;
// a hub on no line; a link that opens a shared flow; a group on no line
const BODY: MetroBody = {
  model: "metro",
  name: "Bakery map",
  lines: [
    { id: "cafes", label: "Cafes", tier: "out", offer: "wholesale" },
    { id: "later", label: "Later", tier: "core", planned: true },
  ],
  stations: [
    { id: "hub", label: "Hub", kind: "hub" },
    { id: "find", label: "Find cafes", kind: "att", line: "cafes", action: "email" },
    { id: "pitch", label: "Pitch", kind: "att", line: "cafes" },
    { id: "ask", label: "Ask again", kind: "att", line: "cafes" },
    { id: "won", label: "Won", kind: "cash", line: "cafes", planned: true },
    { id: "lost", label: "Lost", kind: "exit", line: "cafes", failure: true },
    { id: "go", label: "Go to call", kind: "link", line: "cafes", flow: "call" },
    { id: "spare", label: "Spare", kind: "att" },
  ],
  tracks: [
    { id: "t1", from: "hub", to: "find", by: "system" },
    { id: "t2", from: "find", to: "pitch", by: "system" },
    { id: "t3", from: "pitch", to: "won", by: "person", kind: "xfer" },
    { id: "t4", from: "pitch", to: "find", by: "system", kind: "back" },
    { id: "t5", from: "pitch", to: "lost", by: "system", kind: "exit" },
    { id: "t6", from: "pitch", to: "go", by: "system" },
    { id: "t7", from: "find", to: "ghost", by: "system" },
  ],
  groups: [
    { id: "ask", label: "Ask", line: "cafes", stations: ["pitch"] },
    { id: "deep", label: "Deep", parent: "ask", stations: ["won"] },
    { id: "loose", label: "Loose", stations: ["spare"] },
  ],
  frames: [],
  flows: [
    {
      id: "call",
      label: "Call",
      stations: [
        { id: "dial", label: "Dial", kind: "att" },
        { id: "talk", label: "Talk", kind: "time" },
      ],
      tracks: [{ id: "c1", from: "dial", to: "talk", by: "person" }],
    },
  ],
};

const source = (body: MetroBody | null = BODY, calls: string[] = []): MetroSource => ({
  shape: async () => {
    calls.push("shape");
    return body && { body, version: 7, at: "2026-11-13T08:00:00.000Z" };
  },
});
const rows = async (a: ReturnType<typeof metroTree>, path: string) =>
  (await a.children(path)).items.map((i) => `${i.kind} ${i.path}`);

describe("metroTree", () => {
  it("homes stations under their line and groups, in body order", async () => {
    const a = metroTree(source());
    expect(await rows(a, "metro")).toEqual([
      "area metro/lines",
      "area metro/groups",
      "area metro/stations",
      "area metro/flows",
    ]);
    expect(await rows(a, "metro/lines")).toEqual([
      "metro-line metro/lines/cafes",
      "metro-line metro/lines/later",
    ]);
    // `ask` the group and `ask` the station share a parent: the station takes `station:ask`
    expect(await rows(a, "metro/lines/cafes")).toEqual([
      "station metro/lines/cafes/find",
      "group metro/lines/cafes/ask",
      "station metro/lines/cafes/station:ask",
      "station metro/lines/cafes/lost",
      "station metro/lines/cafes/go",
    ]);
    expect(await rows(a, "metro/lines/cafes/ask")).toEqual([
      "station metro/lines/cafes/ask/pitch",
      "group metro/lines/cafes/ask/deep",
    ]);
    expect(await rows(a, "metro/stations")).toEqual(["station metro/stations/hub"]);
    expect(await rows(a, "metro/groups")).toEqual(["group metro/groups/loose"]);
  });

  it("gives marks, counts and subs", async () => {
    const a = metroTree(source());
    expect(await a.item("metro/lines/later")).toMatchObject({ mark: "planned", count: 0 });
    expect(await a.item("metro/lines/cafes")).toMatchObject({
      sub: "outreach · wholesale",
      count: 5,
    });
    expect(await a.item("metro/lines/cafes/lost")).toMatchObject({ mark: "failure" });
    expect(await a.item("metro/lines/cafes/ask/deep/won")).toMatchObject({ mark: "planned" });
    expect(await a.item("metro/lines/cafes/find")).toMatchObject({ sub: "attention · email" });
    expect(await a.item("metro")).toMatchObject({ name: "Bakery map", sub: "version 7" });
  });

  it("turns tracks into relation folders each way, and drops a track to nowhere", async () => {
    const a = metroTree(source());
    const pitch = "metro/lines/cafes/ask/pitch";
    const rels = (await a.children(pitch)).items.map(
      (i) => `${i.path.split("/").at(-1)} ${i.count}`,
    );
    expect(rels).toEqual(["goes-to 2", "comes-from 1", "transfers-to 1", "loops-to 1"]);
    expect((await a.children(`${pitch}/transfers-to`)).items[0]).toMatchObject({
      original: "metro/lines/cafes/ask/deep/won",
    });
    const find = (await a.whole("metro/lines/cafes/find")).links.map((l) => `${l.rel} ${l.dir}`);
    expect(find).toEqual(["goes-to out", "comes-from in", "looped-from in"]);
    // a link opens its flow; the flow lists its stations, then who opens it
    expect(await rows(a, "metro/flows/call")).toEqual([
      "station metro/flows/call/dial",
      "station metro/flows/call/talk",
      "relation metro/flows/call/opened-by",
    ]);
  });

  it("walks a relation alias to its home", async () => {
    const a = metroTree(source());
    expect(await homeAt(a, "metro/stations/hub/goes-to/find")).toBe("metro/lines/cafes/find");
    const shown = await columns(a, "metro/lines/cafes/ask/pitch/transfers-to/won");
    expect(shown.error).toBeUndefined();
    expect(shown.whole?.name).toBe("Won");
  });

  it("finds a moved station by its id, with was", async () => {
    const a = metroTree(source());
    expect(await a.item("metro/lines/cafes/pitch")).toMatchObject({
      path: "metro/lines/cafes/ask/pitch",
      was: "metro/lines/cafes/pitch",
    });
    await expect(a.item("metro/lines/cafes/nope")).rejects.toBeInstanceOf(PathError);
  });

  it("reads key: value text and the raw station", async () => {
    const a = metroTree(source());
    const w = await wholeAt(a, "metro/lines/cafes/find");
    expect(w.body).toContain("kind: att");
    expect(w.body).toContain("action: email");
    expect(w.data).toMatchObject({ station: { id: "find" } });
    expect(await a.stamp?.()).toEqual({ version: 7, at: "2026-11-13T08:00:00.000Z" });
  });

  it("gives map edges by kind and finds by text", async () => {
    const a = metroTree(source());
    const e = (await a.edges?.("metro")) ?? [];
    expect(e.map((x) => `${x.id} ${x.rel}`)).toEqual([
      "track:t1 goes-to",
      "track:t2 goes-to",
      "track:t3 transfers-to",
      "track:t4 loops-to",
      "track:t5 goes-to",
      "track:t6 goes-to",
      "flow:call:c1 goes-to",
      "opens:go opens",
    ]);
    const map = await mapAt(a, { depth: 2, open: {} });
    expect(map.boxes.some((b) => b.path === "metro/lines")).toBe(true);
    expect((await a.find("call")).map((i) => i.path)).toContain("metro/flows/call");
  });

  it("loads the shape once, and reads no shape as empty", async () => {
    const calls: string[] = [];
    const a = metroTree(source(BODY, calls));
    await a.children("metro/lines");
    await a.whole("metro/lines/cafes/find");
    expect(calls).toEqual(["shape"]);
    const none = metroTree(source(null));
    expect(await rows(none, "metro")).toEqual([]);
    await expect(none.item("metro/lines/x")).rejects.toBeInstanceOf(PathError);
  });
});
