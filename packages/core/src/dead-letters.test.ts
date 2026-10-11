import { describe, expect, it } from "vitest";
import { failureOf, letterLine, pausedOf } from "./dead-letters.js";

describe("dead letters", () => {
  it("reads Restate's paused rows, skipping a row with no id", () => {
    const [p, ...rest] = pausedOf([
      {
        id: "inv_1",
        target: "Content/comments",
        target_service_key: "wren",
        last_failure: "",
        invoked_by: "ingress",
        modified_at: "2026-10-08T22:27:01.224Z",
      },
      { target: "X/y" },
    ]);
    expect(rest).toEqual([]);
    expect(p).toEqual({
      invocationId: "inv_1",
      target: "Content/comments",
      key: "wren",
      error: null,
      invokedBy: "ingress",
      pausedAt: new Date("2026-10-08T22:27:01.224Z"),
    });
  });

  it("finds the failure in a journal entry, escapes and all", () => {
    expect(
      failureOf('{"Call":{"result":{"Failure":{"code":502,"message":"said \\"no\\" twice"}}}}'),
    ).toBe('[502] said "no" twice');
    expect(failureOf('{"Run":{"result":{"Success":[1]}}}')).toBeNull();
    expect(failureOf(null)).toBeNull();
  });

  it("one line per letter, the error cut short", () => {
    const line = letterLine({ id: 3, target: "A/b", key: "k", error: `x\n${"y".repeat(300)}` });
    expect(line.startsWith("#3 A/b (k): x y")).toBe(true);
    expect(line.length).toBeLessThan(150);
  });
});
