import { describe, expect, it } from "vitest";
import {
  deskUnreachable,
  failureOf,
  letterLine,
  pausedFailureOf,
  pausedOf,
} from "./dead-letters.js";

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

  it("reads the failure off a Paused event", () => {
    expect(
      pausedFailureOf(
        '{"ty":"Paused","last_failure":{"error_code":500,"error_message":"error when calling \'http://127.0.0.1:9082/\': h2 pool connection error: connection reset"}}',
      ),
    ).toBe(
      "[500] error when calling 'http://127.0.0.1:9082/': h2 pool connection error: connection reset",
    );
    expect(pausedFailureOf('{"ty":"Paused"}')).toBeNull();
    expect(pausedFailureOf("not json")).toBeNull();
  });

  it("only Restate's transport errors on a desk call count as the Mac asleep", () => {
    const reset =
      "[500] error when calling 'http://127.0.0.1:9082/': h2 pool connection error: connection reset";
    expect(deskUnreachable({ target: "desk/call", error: reset })).toBe(true);
    expect(
      deskUnreachable({
        target: "desk/call",
        error: "[500] error when calling 'http://127.0.0.1:9082/': connection refused",
      }),
    ).toBe(true);
    // Same transport error on a wren service: wren is down, that pings.
    expect(deskUnreachable({ target: "Content/comments", error: reset })).toBe(false);
    // The desk answered with its own error: a real failure.
    expect(
      deskUnreachable({ target: "desk/call", error: "[500] gmail: connection reset by peer" }),
    ).toBe(false);
    expect(deskUnreachable({ target: "desk/call", error: null })).toBe(false);
  });
});
