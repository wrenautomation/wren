import { describe, expect, it } from "vitest";
import { SavePage } from "./page.js";

describe("SavePage", () => {
  it("flushes every box and answers true only when all saved", async () => {
    const page = new SavePage();
    const got: string[] = [];
    const saves = (name: string, ok: boolean) => async () => {
      got.push(name);
      return ok;
    };
    page.add({ flush: saves("a", true) });
    const off = page.add({ flush: saves("b", false) });
    expect(await page.flush()).toBe(false);
    expect(got).toEqual(["a", "b"]);
    off();
    expect(await page.flush()).toBe(true);
    expect(page.size).toBe(1);
  });

  it("a box that throws counts as not saved", async () => {
    const page = new SavePage();
    page.add({ flush: () => Promise.reject(new Error("offline")) });
    expect(await page.flush()).toBe(false);
  });
});
