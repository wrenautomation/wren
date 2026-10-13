import { afterEach, describe, expect, it, vi } from "vitest";
import { callIds, commandOf, tellAutotrack } from "./autotrack.js";

afterEach(() => vi.unstubAllGlobals());

const posted = () => {
  const post = vi.fn();
  vi.stubGlobal("postMessage", post);
  vi.stubGlobal("location", { origin: "https://app.example.test" });
  return post;
};

describe("autotrack", () => {
  it("keeps record ids only, never other body fields", () => {
    expect(
      callIds({
        client: "c1",
        leadId: 42,
        ids: ["x", "y"],
        messageIds: ["a", "b", { x: 1 }],
        body: "secret text",
        identity: "x",
        input: { draftId: 9, text: "private words", ids: ["z"] },
      }),
    ).toEqual({ client: "c1", leadId: 42, ids: ["x", "y"], messageIds: ["a", "b"], draftId: 9 });
    expect(callIds({ note: "hi" })).toBeNull();
  });

  it("clips long ids and counts", () => {
    const got = callIds({ id: "x".repeat(500), ids: Array.from({ length: 30 }, (_, i) => i) });
    expect(String(got?.id).length).toBe(80);
    expect(got?.ids).toHaveLength(10);
  });

  it("names commands and skips reads", () => {
    expect(commandOf("marketing/approveDraft", {})).toBe("marketing/approveDraft");
    expect(commandOf("console/recordsEdit", {})).toBe("console/recordsEdit");
    expect(commandOf("console/recordsList", {})).toBeNull();
    expect(commandOf("console/recordsCounts", {})).toBeNull();
    expect(commandOf("delivery/me", {})).toBeNull();
    expect(commandOf("learn/search", {})).toBeNull();
    expect(commandOf("console/call", { service: "ContentDesk", handler: "approve" })).toBe(
      "console/call:ContentDesk.approve",
    );
    expect(commandOf("console/call", { service: "ContentDesk", handler: "listIdeas" })).toBeNull();
  });

  it("posts the command, ids and outcome to this origin", () => {
    const post = posted();
    tellAutotrack("marketing/approveDraft", { ids: [7], text: "private" }, 200);
    expect(post).toHaveBeenCalledWith(
      {
        autotrack: {
          v: 1,
          action: "marketing/approveDraft",
          detail: { ids: { ids: [7] }, ok: true },
        },
      },
      "https://app.example.test",
    );
  });

  it("says a failure with a short code, never the server's words", () => {
    const post = posted();
    tellAutotrack("documents/send", { id: "d1" }, 403);
    tellAutotrack("documents/send", { id: "d1" }, 0);
    const details = post.mock.calls.map((c) => c[0].autotrack.detail);
    expect(details).toEqual([
      { ids: { id: "d1" }, ok: false, error: "http_403" },
      { ids: { id: "d1" }, ok: false, error: "offline" },
    ]);
  });

  it("says nothing for a read", () => {
    const post = posted();
    tellAutotrack("console/recordsList", { client: "c1" }, 200);
    expect(post).not.toHaveBeenCalled();
  });
});
