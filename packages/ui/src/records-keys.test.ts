import type { RecordMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import { keyed, subtitleOf, titleOf } from "./records.js";

const act = (id: string, key: string, type: string, ask = false): Action => ({
  id,
  label: id,
  handler: id,
  key,
  when: { type: [type] },
  ...(ask ? { ask: { field: "draft", label: "Words" } } : {}),
});
const press = (key: string) => ({ key }) as KeyboardEvent;

describe("keyed", () => {
  // The Inbox mixes types: R is a draft's Reject and a DM's Reply.
  const actions = [
    act("reject", "r", "draft"),
    act("reply", "r", "dm", true),
    act("read", "m", "dm"),
  ];

  it("runs the first action with the key that applies to the row", () => {
    expect(keyed(press("r"), actions, { id: 1, type: "draft" })?.id).toBe("reject");
    expect(keyed(press("r"), actions, { id: 2, type: "dm" })?.id).toBe("reply");
  });
  it("runs nothing for a key no action on the row has, or with no row", () => {
    expect(keyed(press("m"), actions, { id: 1, type: "draft" })).toBeUndefined();
    expect(keyed(press("r"), actions, undefined)).toBeUndefined();
  });
  it("E edits through the row's action that asks for text", () => {
    expect(keyed(press("e"), actions, { id: 2, type: "dm" })?.id).toBe("reply");
    expect(keyed(press("e"), actions, { id: 1, type: "draft" })).toBeUndefined();
  });
});

describe("titleOf", () => {
  const meta = {
    title: "channel",
    subtitle: "page",
    fields: [
      { key: "channel", kind: "status", label: "Channel", states: { email: { label: "Email" } } },
      { key: "page", kind: "text", label: "Page" },
    ],
  } as unknown as RecordMeta;

  it("reads a state by its label, text as it is", () => {
    expect(titleOf(meta, { id: 1, channel: "email", page: "/" })).toBe("Email");
    expect(subtitleOf(meta, { id: 1, channel: "email", page: "/" })).toBe("/");
    expect(titleOf(meta, { id: 1, channel: "carrier pigeon" })).toBe("carrier pigeon");
  });
});
