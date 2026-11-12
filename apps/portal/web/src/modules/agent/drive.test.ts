import type { AgentMessage } from "@wren/ui";
import { describe, expect, it, vi } from "vitest";
import { markChanged, toolsDoneIn, useChangedRecords } from "./drive.js";

// the hook's snapshot, read outside React through its getter
vi.mock("react", async (real) => ({
  ...(await real<typeof import("react")>()),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
}));

const tool = (id: string, result?: string) => ({
  type: "tool" as const,
  id,
  name: "Bash",
  input: { command: "shape edit d1 '{}'" },
  ...(result !== undefined ? { result } : {}),
});

describe("toolsDoneIn", () => {
  it("counts tool calls that have a result, over every turn", () => {
    const messages = [
      { id: "u1", role: "user", state: "done", parts: [{ type: "text", text: "rename it" }] },
      { id: "a1", role: "assistant", state: "done", parts: [tool("t1", "ok"), tool("t2", "")] },
      { id: "a2", role: "assistant", state: "streaming", parts: [tool("t3")] },
    ] as unknown as AgentMessage[];
    expect(toolsDoneIn(messages)).toBe(2);
  });
});

describe("markChanged", () => {
  it("marks each record for 5 s, and a newer change keeps it", () => {
    vi.useFakeTimers();
    markChanged(["books.spend"]);
    expect([...useChangedRecords()]).toEqual(["books.spend"]);
    vi.advanceTimersByTime(3000);
    markChanged(["books.spend", "leads.person"]);
    vi.advanceTimersByTime(2100);
    expect([...useChangedRecords()].sort()).toEqual(["books.spend", "leads.person"]);
    vi.advanceTimersByTime(3000);
    expect([...useChangedRecords()]).toEqual([]);
    vi.useRealTimers();
  });
});
