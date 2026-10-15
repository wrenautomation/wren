import "fake-indexeddb/auto";
import type { RecordsPage } from "@wren/core/records/serve";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { WRITES, type Write } from "../save/writes.js";
import { listChanged } from "./delta.js";
import { EDITS } from "./edits.js";
import { dropLocalCopy, fitted, indexedStore, startLocalCopy } from "./local.js";
import { cachedOf, keyOf, nameScope, QUERIES, writeThrough } from "./query.js";
import { indicatorOf, sendLineOf } from "./status.js";
import { type Edit, useEdit } from "./use-edit.js";

let n = 0;
const fresh = () => indexedStore(indexedDB, `wren-test-${++n}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await dropLocalCopy(null);
  EDITS.setClient(null);
});

describe("the device store", () => {
  it("keeps, lists by prefix, and clears", async () => {
    const s = fresh();
    await s?.setItem("edit:a", "1");
    await s?.setItem("edit:b", "2");
    await s?.setItem("copy:a", "3");
    expect(await s?.getItem("edit:a")).toBe("1");
    expect((await s?.entries("edit:"))?.map(([k]) => k)).toEqual(["edit:a", "edit:b"]);
    await s?.clear();
    expect(await s?.getItem("copy:a")).toBeNull();
  });
});

describe("the local copy", () => {
  it("paints a named scope's answers after a reload, keeps no unnamed ones, and wipes on sign-out", async () => {
    const storage = fresh();
    await startLocalCopy({ owner: "me@example.com", storage, tabs: false });
    const named = nameScope({}, "test-named");
    const own = {};
    await QUERIES.fetchQuery({
      queryKey: keyOf(named, "list"),
      queryFn: async () => ({ rows: [1, 2] }),
      meta: { keep: true },
    });
    await QUERIES.fetchQuery({
      queryKey: keyOf(own, "list"),
      queryFn: async () => ({ rows: [3] }),
      meta: { keep: false },
    });
    // The copy is written at most every 2 s.
    await wait(2300);
    // A reload: the cache is empty, the copy fills it.
    QUERIES.clear();
    await startLocalCopy({ owner: "me@example.com", storage, tabs: false });
    expect(cachedOf(named, "list")).toEqual({ rows: [1, 2] });
    expect(cachedOf(own, "list")).toBeUndefined();
    // Another person signs in on this browser: none of it is theirs.
    QUERIES.clear();
    await startLocalCopy({ owner: "other@example.com", storage, tabs: false });
    expect(cachedOf(named, "list")).toBeUndefined();
    await dropLocalCopy(storage);
    expect(await storage?.entries("")).toEqual([]);
  }, 10_000);

  it("keeps the newest answers that fit", () => {
    const q = (at: number, size: number) =>
      ({ state: { dataUpdatedAt: at, data: "x".repeat(size) }, queryKey: [String(at)] }) as never;
    const out = JSON.parse(
      fitted(
        { timestamp: 0, buster: "", clientState: { queries: [q(1, 50), q(2, 50)], mutations: [] } },
        120,
      ),
    );
    expect(out.clientState.queries.map((x: { queryKey: string[] }) => x.queryKey[0])).toEqual([
      "2",
    ]);
  });
});

describe("write-through", () => {
  it("patches every answer read under the scope, at once", () => {
    const scope = nameScope({}, "test-through");
    QUERIES.setQueryData(keyOf(scope, "a"), { name: "old" });
    QUERIES.setQueryData(keyOf(scope, "b"), { name: "other" });
    writeThrough(scope, (key, data) => (key === "a" ? { name: "new" } : data));
    expect(cachedOf(scope, "a")).toEqual({ name: "new" });
    expect(cachedOf(scope, "b")).toEqual({ name: "other" });
  });
});

describe("change-only list reads", () => {
  it("sends the hashes it holds and fills the stubs back in", async () => {
    const before = {
      record: "deals",
      rows: [{ id: 1, name: "Acme" }],
      hashes: ["aaaaaaaa"],
    } as unknown as RecordsPage;
    const asks: unknown[] = [];
    const got = await listChanged(
      async (ask) => {
        asks.push(ask);
        return { record: "deals", rows: [{ id: 1 }], hashes: ["aaaaaaaa"], same: [0] } as never;
      },
      { record: "deals" } as never,
      before,
    );
    expect(asks).toEqual([{ record: "deals", known: ["aaaaaaaa"] }]);
    expect(got.rows).toEqual([{ id: 1, name: "Acme" }]);
  });
});

/** Renders a box on `useEdit` once and hands back what the hook gave (a mount of the page). */
function mount(key: string, server: string, version?: string): Edit {
  let got: Edit | null = null;
  function Box() {
    got = useEdit(key, server, version ? { version } : {});
    return <textarea {...got.field} />;
  }
  renderToStaticMarkup(<Box />);
  if (!got) throw new Error("not rendered");
  return got;
}

describe("unsaved edits", () => {
  it("survive leaving the page and coming back", () => {
    EDITS.setClient("c1");
    mount("deal:9:name", "Acme").set("Acme West");
    // The page unmounted; another page, then back.
    const back = mount("deal:9:name", "Acme");
    expect(back.value).toBe("Acme West");
    expect(back.dirty).toBe(true);
  });

  it("survive a reload, from the device copy", async () => {
    const storage = fresh();
    await startLocalCopy({ owner: "me@example.com", storage, tabs: false });
    EDITS.setClient("c1");
    mount("note:3:title", "Plan").set("Plan for May");
    await wait(50);
    // A reload: this tab's memory is gone, the device keeps the words.
    EDITS.wipe();
    expect(mount("note:3:title", "Plan").value).toBe("Plan");
    await startLocalCopy({ owner: "me@example.com", storage, tabs: false });
    EDITS.setClient("c1");
    const back = mount("note:3:title", "Plan");
    expect(back.value).toBe("Plan for May");
    expect(back.restored).toBe(true);
  });

  it("are kept per client", () => {
    EDITS.setClient("c1");
    mount("deal:9:name", "Acme").set("Mine in c1");
    EDITS.setClient("c2");
    expect(mount("deal:9:name", "Acme").value).toBe("Acme");
  });

  it("show both when the server moved meanwhile, and the person picks", () => {
    EDITS.setClient("c1");
    mount("deal:9:stage", "new", "v1").set("won");
    const moved = mount("deal:9:stage", "lost", "v2");
    expect(moved.conflict).toEqual({ mine: "won", theirs: "lost" });
    expect(moved.value).toBe("won");
    moved.keepMine();
    const kept = mount("deal:9:stage", "lost", "v2");
    expect(kept.conflict).toBeNull();
    expect(kept.value).toBe("won");
    kept.takeTheirs();
    expect(mount("deal:9:stage", "lost", "v2").value).toBe("lost");
  });

  it("are cleared when saved or discarded, and what was typed past a save stays", () => {
    EDITS.setClient("c1");
    mount("deal:9:name", "Acme").set("Acme West");
    mount("deal:9:name", "Acme").saved("Acme West");
    expect(mount("deal:9:name", "Acme West").dirty).toBe(false);
    mount("deal:9:name", "Acme West").set("Acme West Co");
    mount("deal:9:name", "Acme West").saved("Acme We");
    const past = mount("deal:9:name", "Acme We");
    expect(past.value).toBe("Acme West Co");
    expect(past.conflict).toBeNull();
    past.discard();
    expect(mount("deal:9:name", "Acme We").dirty).toBe(false);
  });

  it("are wiped with the local copy", async () => {
    EDITS.setClient("c1");
    mount("deal:9:name", "Acme").set("Acme West");
    await dropLocalCopy(null);
    expect(mount("deal:9:name", "Acme").value).toBe("Acme");
  });
});

describe("the send line and the shell's mark", () => {
  const w = (o: Partial<Write>) => ({ id: "w1", status: "sending", error: null, ...o }) as Write;

  it("says why the server is trying again", () => {
    expect(sendLineOf(w({ retry: { count: 2, reason: "LinkedIn answered 429." } }))?.text).toBe(
      "Trying again (2): LinkedIn answered 429. It keeps trying even if you leave this page.",
    );
    expect(sendLineOf(w({ accepted: true }))?.text).toMatch(/^On its way\./);
    expect(sendLineOf(w({ status: "failed", error: "Too long." }))).toEqual({
      tone: "bad",
      text: "Not sent: Too long.",
    });
    expect(sendLineOf(w({ status: "sent" }))?.text).toBe("Sent.");
  });

  it("says offline and what waits", () => {
    expect(indicatorOf(true, 0)).toBeNull();
    expect(indicatorOf(true, 1)).toBe("Saving: 1 change waits for an answer.");
    expect(indicatorOf(false, 2)).toBe("Offline. 2 changes wait; they go when you're back.");
    expect(indicatorOf(false, 0)).toBe("Offline. Showing what's on this device.");
    expect(WRITES.pending).toBeGreaterThanOrEqual(0);
  });
});
