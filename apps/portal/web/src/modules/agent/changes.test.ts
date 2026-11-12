import type { AgentMessage } from "@wren/ui";
import { describe, expect, it, vi } from "vitest";

// the reads touch the browser: only the words are under test here
vi.mock("../../api.js", () => ({ call: vi.fn() }));
vi.mock("../../load.js", () => ({ useCall: vi.fn() }));

import { askOf, type ChangeLine, tableWord, turnsOf } from "./changes.js";

const line = (id: string, at: string, turn: string | null, more: Partial<ChangeLine> = {}) =>
  ({
    id,
    at,
    turn,
    table: "companies",
    area: "data",
    op: "update",
    row: id,
    change: "country: empty → CA",
    undone: false,
    keyed: true,
    ...more,
  }) satisfies ChangeLine;

describe("tableWord", () => {
  it("one row, in words", () => {
    expect(tableWord("companies")).toBe("Company");
    expect(tableWord("delivery.wise_credits")).toBe("Wise credit");
    expect(tableWord("addresses")).toBe("Address");
    expect(tableWord("access")).toBe("Access");
  });
});

describe("turnsOf", () => {
  const messages: AgentMessage[] = [
    {
      id: "u1",
      role: "user",
      at: "2026-11-12T10:00:00Z",
      parts: [{ type: "text", text: "Fix the countries\nall of them" }],
    },
    { id: "r1", role: "assistant", at: "2026-11-12T10:00:00Z", parts: [] },
    {
      id: "u2",
      role: "user",
      at: "2026-11-12T10:05:00Z",
      parts: [{ type: "text", text: "Now tag them" }],
    },
    { id: "r2", role: "assistant", at: "2026-11-12T10:05:00Z", parts: [] },
  ];
  const turns = turnsOf(
    [
      line("3", "2026-11-12T10:05:09Z", "t2", { op: "insert", table: "tags", change: null }),
      line("2", "2026-11-12T10:00:30Z", "t1"),
      line("1", "2026-11-12T10:00:20Z", "t1", { keyed: false }),
    ],
    messages,
  );

  it("groups by turn, newest first, each to the message sent before it", () => {
    expect(turns.map((t) => [t.id, t.said, t.reply, t.lines.length])).toEqual([
      ["t2", "Now tag them", "r2", 1],
      ["t1", "Fix the countries", "r1", 2],
    ]);
  });

  it("a line with no key can't be undone", () => {
    expect(turns[1]?.lines[1]?.fixed).toBeTruthy();
    expect(turns[1]?.lines[0]?.what).toBe("Company · 2");
  });

  it("a turn before any message in view still shows", () => {
    const [t] = turnsOf([line("9", "2026-11-12T09:00:00Z", null)], messages);
    expect(t?.said).toBe("An earlier message");
    expect(t?.reply).toBeNull();
  });
});

describe("askOf", () => {
  it("pending asks; used reads as yes", () => {
    const row = {
      id: "a1",
      act: "send" as const,
      client: "wren",
      what: "Send 12 emails",
      args: { command: "crm approve", argv: ["--all"] },
      state: "pending" as const,
      decidedBy: null,
      decidedAt: null,
      at: "2026-11-12T10:00:00Z",
    };
    expect(askOf(row).state).toBe("asks");
    expect(askOf({ ...row, state: "used" }).state).toBe("yes");
    expect(askOf(row).facts[0]).toEqual(["Runs", "crm approve --all"]);
  });
});
