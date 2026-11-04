import { describe, expect, it } from "vitest";
import { triggerHears } from "./logic.js";
import { type TouchRow, touchFired } from "./touch-feed.js";

const row: TouchRow = {
  id: 41,
  kind: "dm",
  direction: "theirs",
  platform: "x",
  handle: "sam_synth",
  account: "x@wren",
  url: "https://x.example/dm/1",
  text: "hello",
  at: "2026-10-19T10:00:00.000Z",
  source: "reach_messages",
  profile: null,
};

describe("touchFired", () => {
  it("tells the touch by its id, on the person kind", () => {
    const f = touchFired(null, row);
    expect(f.client).toBeNull();
    expect(f.facts).toEqual({
      trigger: "trigger.touch",
      kind: "dm",
      direction: "theirs",
      platform: "x",
    });
    expect(f.event.subject).toBe("touch:41");
    expect(f.event.kind).toBe("person");
    expect(f.event.data).toMatchObject({
      touch: 41,
      kind: "dm",
      source: "reach_messages",
      "handle:x": "sam_synth",
    });
    expect(f.event.data).not.toHaveProperty("profile");
  });
  it("names the profile when the handle maps to one", () => {
    const f = touchFired("acme", { ...row, profile: 7 });
    expect(f.client).toBe("acme");
    expect(f.event.data.profile).toBe(7);
  });
  it("cuts long text", () => {
    const f = touchFired(null, { ...row, text: "x".repeat(9000) });
    expect((f.event.data.text as string).length).toBe(5000);
  });
  it("is heard by a Touch trigger that matches, not by one that does not", () => {
    const f = touchFired(null, row);
    const node = (w: Record<string, string>) => ({ id: "t", uses: "trigger.touch", with: w });
    expect(triggerHears(node({ kind: "dm", direction: "theirs", platform: "x" }), f.facts)).toBe(
      true,
    );
    expect(triggerHears(node({}), f.facts)).toBe(true);
    expect(triggerHears(node({ platform: "linkedin" }), f.facts)).toBe(false);
    expect(triggerHears(node({ direction: "ours" }), f.facts)).toBe(false);
  });
});
