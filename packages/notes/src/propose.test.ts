import { describe, expect, it } from "vitest";
import { PROPOSE_MAX, PROPOSE_TITLE_MAX, proposePrompt, readProposal } from "./propose.js";

const TEXT = [
  "Launch plan",
  "[ ] Book the venue by Friday",
  "[x] Pick a date",
  "Order the signs",
].join("\n");
const OWNERS = ["ada@example.test"];
const answer = (cards: unknown[]) => `Here you go:\n${JSON.stringify({ cards })}\n`;

describe("readProposal", () => {
  it("keeps titles, a mentioned owner, a real due and a line the note has", () => {
    const cards = readProposal(
      answer([
        {
          title: "Book the venue.",
          owner: "Ada@example.test",
          due: "2026-10-16",
          line: "[ ] Book the venue by Friday",
        },
        { title: "Order the signs", owner: "bob@example.test", due: "Friday", line: "Made up" },
      ]),
      { text: TEXT, owners: OWNERS },
    );
    expect(cards).toEqual([
      {
        title: "Book the venue",
        owner: "ada@example.test",
        due: "2026-10-16",
        line: "Book the venue by Friday",
      },
      { title: "Order the signs", owner: null, due: null, line: null },
    ]);
  });

  it("drops empty and repeated titles, clips long ones, and stops at the cap", () => {
    const many = Array.from({ length: PROPOSE_MAX + 5 }, (_, i) => ({ title: `Task ${i}` }));
    expect(readProposal(answer(many), { text: TEXT, owners: [] })).toHaveLength(PROPOSE_MAX);
    const cards = readProposal(
      answer([{ title: "" }, { title: "Same" }, { title: "same" }, { title: "x".repeat(400) }, 7]),
      { text: TEXT, owners: [] },
    );
    expect(cards.map((c) => c.title.length)).toEqual([4, PROPOSE_TITLE_MAX]);
  });

  it("reads nothing from an answer that isn't the JSON asked for", () => {
    expect(readProposal("no cards here", { text: TEXT, owners: [] })).toEqual([]);
    expect(readProposal("{ not json }", { text: TEXT, owners: [] })).toEqual([]);
    expect(readProposal('{"cards": "none"}', { text: TEXT, owners: [] })).toEqual([]);
    expect(
      readProposal(answer([{ title: "Ok", due: "2026-02-31" }]), { text: TEXT, owners: [] }),
    ).toEqual([{ title: "Ok", owner: null, due: null, line: null }]);
  });
});

describe("proposePrompt", () => {
  it("names who may own a card and carries the note", () => {
    const p = proposePrompt({
      title: "Launch",
      text: TEXT,
      owners: [{ id: "ada@example.test", label: "Ada" }],
      today: "2026-10-15",
    });
    expect(p).toContain("ada@example.test (shown as @Ada)");
    expect(p).toContain("Today is 2026-10-15");
    expect(p).toContain("Order the signs");
  });
});
