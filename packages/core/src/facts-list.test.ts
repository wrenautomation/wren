/** The facts list's checks and change counts, as the editor and the record use them. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACTS,
  FACT_MAX,
  FACTS_CAP,
  factsChange,
  factsChangeText,
  factsOf,
  factsProblem,
  factsText,
} from "./facts-list.js";

describe("facts list", () => {
  it("reads one fact a line, trimmed, blanks dropped", () => {
    expect(factsOf(" a \n\n b\n")).toEqual(["a", "b"]);
    expect(factsOf(factsText(DEFAULT_FACTS))).toEqual([...DEFAULT_FACTS]);
    expect(factsOf("")).toEqual([]);
  });

  it("says what stops a save", () => {
    expect(factsProblem(DEFAULT_FACTS)).toBeNull();
    expect(factsProblem(["ok", "", "  "])).toBeNull();
    expect(factsProblem(["ok", "x".repeat(FACT_MAX + 1)])).toBe(
      `Fact 2 is over ${FACT_MAX} characters`,
    );
    expect(factsProblem(Array.from({ length: FACTS_CAP + 1 }, (_, i) => `fact ${i}`))).toBe(
      `${FACTS_CAP} facts at most; this has ${FACTS_CAP + 1}`,
    );
    expect(factsProblem(["One.", "one. "])).toBe("Fact 2 says the same as one above it");
  });

  it("counts a change in words", () => {
    const text = (a: string[], b: string[]) => factsChangeText(factsChange(a, b));
    expect(text(["a", "b"], ["a", "b"])).toBe("No change");
    expect(text(["a", "b"], ["b", "a"])).toBe("Reordered");
    expect(text(["a"], ["a", "b", "c"])).toBe("Added 2");
    expect(text(["a", "b"], ["a"])).toBe("Removed 1");
    expect(text(["a", "b"], ["a", "B"])).toBe("Edited 1");
    expect(text(["a", "b", "c"], ["c", "x"])).toBe("Edited 1, removed 1");
  });
});
