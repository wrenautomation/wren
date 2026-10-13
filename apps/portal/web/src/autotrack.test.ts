import { afterEach, describe, expect, it, vi } from "vitest";
import { callIds, tellAutotrack } from "./autotrack.js";

afterEach(() => vi.unstubAllGlobals());

describe("autotrack", () => {
  it("keeps record ids only, never other body fields", () => {
    expect(
      callIds({
        client: "c1",
        leadId: 42,
        messageIds: ["a", "b", { x: 1 }],
        body: "secret text",
        identity: "x",
      }),
    ).toEqual({ client: "c1", leadId: 42, messageIds: ["a", "b"] });
    expect(callIds({ note: "hi" })).toBeNull();
  });

  it("posts the route, status and time to this origin", () => {
    const post = vi.fn();
    vi.stubGlobal("postMessage", post);
    vi.stubGlobal("location", { origin: "https://app.example.test" });
    tellAutotrack("reactivation/approve", { leadId: 7, text: "no" }, 200, 31);
    expect(post).toHaveBeenCalledWith(
      {
        autotrack: {
          v: 1,
          action: "reactivation/approve",
          detail: { status: 200, ms: 31, ids: { leadId: 7 } },
        },
      },
      "https://app.example.test",
    );
  });
});
