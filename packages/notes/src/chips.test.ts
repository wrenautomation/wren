import { describe, expect, it } from "vitest";
import { type CardChip, CHIPS_PER_READ, chipCardId, chipWords, makeChips } from "./chips.js";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Timers run by hand, so a test says when the wait is over. */
function clock() {
  const due: (() => void)[] = [];
  return {
    after: (fn: () => void) => void due.push(fn),
    run: async () => {
      for (const fn of due.splice(0)) fn();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("chipCardId and chipWords", () => {
  it("finds the card behind a card chip, and nothing else", () => {
    expect(chipCardId({ id: `note:${ID(1)}`, label: "Card: To do" })).toBe(ID(1));
    expect(chipCardId({ id: `note:${ID(1)}`, label: "A plain note" })).toBeNull();
    expect(chipCardId({ id: "person:ada@example.test", label: "Card: x" })).toBeNull();
    expect(chipCardId({})).toBeNull();
  });

  it("says the current column, or what was saved", () => {
    const now: CardChip = { id: ID(1), column: "Doing", closed: false };
    expect(chipWords("Card: To do", now)).toBe("Card: Doing");
    expect(chipWords("Card: To do", undefined)).toBe("Card: To do");
  });
});

describe("makeChips", () => {
  it("reads every card of the note in one call", async () => {
    const calls: string[][] = [];
    const t = clock();
    const chips = makeChips(
      async (ids) => {
        calls.push(ids);
        return ids.map((id) => ({ id, column: "Doing", closed: false }));
      },
      { after: t.after },
    );
    chips.ask([ID(1), ID(2)]);
    chips.ask([ID(2), ID(3)]);
    expect(calls).toHaveLength(0);
    await t.run();
    expect(calls).toEqual([[ID(1), ID(2), ID(3)]]);
    expect(chips.get(ID(2))).toEqual({ id: ID(2), column: "Doing", closed: false });
  });

  it("asks again only for new cards, and for all of them on refresh", async () => {
    const calls: string[][] = [];
    const t = clock();
    const chips = makeChips(
      async (ids) => {
        calls.push(ids);
        return ids.map((id) => ({ id, column: "Done", closed: true }));
      },
      { after: t.after },
    );
    chips.ask([ID(1)]);
    await t.run();
    chips.ask([ID(1), ID(2)]);
    await t.run();
    chips.refresh();
    await t.run();
    expect(calls).toEqual([[ID(1)], [ID(2)], [ID(1), ID(2)]]);
    expect(chips.get(ID(1))?.closed).toBe(true);
  });

  it("splits a big note into as few reads as the cap allows", async () => {
    const sizes: number[] = [];
    const t = clock();
    const chips = makeChips(
      async (ids) => {
        sizes.push(ids.length);
        return [];
      },
      { after: t.after },
    );
    chips.ask(Array.from({ length: CHIPS_PER_READ + 5 }, (_, i) => ID(i)));
    await t.run();
    expect(sizes).toEqual([CHIPS_PER_READ, 5]);
  });

  it("tells watchers on a change only, and keeps the saved words when a read fails", async () => {
    const t = clock();
    let fail = false;
    let column = "To do";
    const chips = makeChips(
      async (ids) => {
        if (fail) throw new Error("down");
        return ids.map((id) => ({ id, column, closed: false }));
      },
      { after: t.after },
    );
    let told = 0;
    const stop = chips.watch(() => void told++);
    chips.ask([ID(1)]);
    await t.run();
    expect(told).toBe(1);
    chips.refresh();
    await t.run();
    expect(told).toBe(1);
    column = "Done";
    chips.refresh();
    await t.run();
    expect(told).toBe(2);
    fail = true;
    chips.refresh();
    await t.run();
    expect(told).toBe(2);
    expect(chips.get(ID(1))?.column).toBe("Done");
    stop();
    fail = false;
    column = "Doing";
    chips.refresh();
    await t.run();
    expect(told).toBe(2);
  });
});
