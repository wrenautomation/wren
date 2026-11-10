import type { AgentMessage } from "@wren/ui";
import { describe, expect, it } from "vitest";
import { toolsDoneIn } from "./drive.js";

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
