import { describe, expect, it } from "vitest";
import {
  deskUnreachable,
  failureOf,
  letterLine,
  pausedFailureOf,
  pausedOf,
  pausedUnder,
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
    const line = letterLine({ id: 3, target: "A/b", key: "k", error: `x\n${"y".repeat(3000)}` });
    expect(line.startsWith("#3 A/b (k): x y")).toBe(true);
    expect(line.length).toBeLessThan(1250);
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

  it("finds a paused call under an invocation, through the calls it made", async () => {
    const asked: string[] = [];
    const tree: Record<string, { id: string; target: string; status: string; parent: string }[]> = {
      inv_root: [{ id: "inv_sites", target: "sites/publish", status: "suspended", parent: "" }],
      inv_sites: [
        {
          id: "inv_desk",
          target: "desk/call",
          status: "paused",
          parent: "inv_root",
        },
      ],
    };
    const admin = async (q: string) => {
      asked.push(q);
      if (q.includes("WHERE id IN"))
        return [{ id: "inv_root", target: "Content/publish", status: "suspended" }];
      const parent = /invoked_by_id IN \('(\w+)'\)/.exec(q)?.[1] ?? "";
      const rows = tree[parent] ?? [];
      if (q.startsWith("SELECT entry_json")) return [];
      return rows.map((r) => ({
        ...r,
        last_failure: r.status === "paused" ? "connection reset" : null,
      }));
    };
    expect(await pausedUnder(admin)("inv_root")).toBe("desk/call: connection reset");
    // Nothing paused under it: null, and it stops when the calls run out.
    tree.inv_sites = [];
    expect(await pausedUnder(admin)("inv_root")).toBeNull();
    // An id is quoted as word characters only.
    const from = asked.length;
    await pausedUnder(admin)("inv_x'; DROP");
    expect(asked[from]).toContain("WHERE id IN ('inv_xDROP')");
  });
});
