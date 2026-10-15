import { describe, expect, it } from "vitest";
import { inLane } from "./lanes.js";

const same = (id: string) => id.slice(id.lastIndexOf(":") + 1);
const later = () => {
  let open: (v: string) => void = () => {};
  const p = new Promise<string>((r) => {
    open = r;
  });
  return { p, open };
};

describe("inLane", () => {
  it("runs a record's calls in the order made", async () => {
    const said: string[] = [];
    const save = later();
    const saving = inLane("set", { ids: ["draft:a"], text: "new" }, same, async () => {
      said.push("save starts");
      return save.p.then((v) => {
        said.push("saved");
        return v;
      });
    });
    const approving = inLane("approve", { ids: ["a"] }, same, async () => {
      said.push("approve");
      return "ok";
    });
    await Promise.resolve();
    save.open("done");
    expect(await Promise.all([saving, approving])).toEqual(["done", "ok"]);
    expect(said).toEqual(["save starts", "saved", "approve"]);
  });

  it("a double click runs once; after it lands, a new click runs again", async () => {
    let n = 0;
    const go = () => inLane("approve", { ids: ["b"] }, same, async () => ++n);
    expect(await Promise.all([go(), go()])).toEqual([1, 1]);
    expect(await go()).toBe(2);
  });

  it("a failed save doesn't stop the next call", async () => {
    const failed = inLane("set", { ids: ["c"] }, same, async () => {
      throw new Error("no");
    });
    const next = inLane("approve", { ids: ["c"] }, same, async () => "ran");
    await expect(failed).rejects.toThrow("no");
    expect(await next).toBe("ran");
  });
});
