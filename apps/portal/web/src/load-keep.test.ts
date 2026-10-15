/** What the device keeps of each read: the newest read's answer, with later saves on it. */
import { describe, expect, it, vi } from "vitest";

vi.mock("./api.js", () => ({
  ApiError: class extends Error {},
  device: () => null,
  deviceOwner: () => null,
  viewing: null,
}));

const { recordPatch, tick } = await import("@wren/ui");
const { keep, keptOf, patchCalls } = await import("./load.js");

describe("keep", () => {
  it("an older read that lands late doesn't replace a newer one", () => {
    const older = tick();
    const newer = tick();
    keep("work:home", { open: 2 }, newer);
    keep("work:home", { open: 5 }, older);
    expect(keptOf("work:home")).toEqual({ open: 2 });
  });

  it("a save made while the read was out applies over its answer", () => {
    const left = tick();
    patchCalls((k, d) => (k === "deal:9" ? { ...(d as object), name: "Saved" } : d));
    keep("deal:9", { name: "Before" }, left);
    expect(keptOf("deal:9")).toEqual({ name: "Saved" });
  });

  it("a switch flip patches its row in every kept list, so neither key reads again", () => {
    const page = (state: string) => ({
      record: "console.automation",
      rows: [
        { id: "made:7", state },
        { id: "kw:2", state: "on" },
      ],
    });
    keep("automations:all", page("off"), tick());
    keep("automations:off:", page("off"), tick());
    patchCalls(recordPatch("console.automation", "made:7", { state: "on" }));
    for (const k of ["automations:all", "automations:off:"]) expect(keptOf(k)).toEqual(page("on"));
  });
});
