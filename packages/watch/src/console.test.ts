import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IDS } from "./console.js";

describe("the Monitor's ids", () => {
  it("take a mail row's id as a number or as text", () => {
    const ids = z.looseObject(IDS).shape.ids;
    expect(ids.safeParse([3, "4"]).success).toBe(true);
    expect(ids.safeParse([{}]).success).toBe(false);
  });
});
