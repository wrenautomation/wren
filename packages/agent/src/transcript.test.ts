import { describe, expect, it } from "vitest";
import { compactedChain } from "./transcript.js";

const row = (uuid: string, parentUuid: string | null, more: Record<string, unknown> = {}) => ({
  type: "user",
  uuid,
  parentUuid,
  message: { role: "user", content: uuid },
  ...more,
});

describe("compacted chain", () => {
  it("reads across a boundary, keeps its numbers and the summary's flag", () => {
    const rows = [
      { type: "queue-operation" },
      row("a", null),
      row("att", "a", { type: "attachment" }),
      row("b", "att", { type: "assistant" }),
      row("side", "b", { isSidechain: true }),
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "c",
        parentUuid: null,
        logicalParentUuid: "b",
        compactMetadata: { trigger: "manual", preTokens: 900, postTokens: 90 },
      },
      row("d", "c", { isCompactSummary: true }),
      row("e", "d", { toolUseResult: { totalTokens: 5 } }),
    ];
    const out = compactedChain(rows, "s1");
    expect(out?.map((r) => r.uuid)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out?.[2]).toMatchObject({ subtype: "compact_boundary", session_id: "s1" });
    expect(out?.[3]?.isCompactSummary).toBe(true);
    expect(out?.[4]?.tool_use_result).toEqual({ totalTokens: 5 });
  });

  it("leaves a chat with no boundary to the SDK", () => {
    expect(compactedChain([row("a", null), row("b", "a")], "s1")).toBeUndefined();
  });
});
