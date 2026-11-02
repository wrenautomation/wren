import { describe, expect, it } from "vitest";
import { turnOf } from "./records.js";

describe("turnOf: what a DM thread waits on", () => {
  it("their unread reply first, then a draft of ours, then sent once ours is last", () => {
    expect(turnOf(true, "a draft", "in")).toBe("reply");
    expect(turnOf(false, "a draft", "out")).toBe("draft");
    expect(turnOf(false, "  ", "out")).toBe("sent");
    expect(turnOf(false, null, "out")).toBe("sent");
    expect(turnOf(false, null, "in")).toBeNull();
    expect(turnOf(false, null, null)).toBeNull();
  });
});
