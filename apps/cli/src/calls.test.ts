import { describe, expect, it } from "vitest";
import { recordingKey, segmentsOf } from "./calls.js";

const w = (word: string, s: number, e = s + 0.3) => ({ w: word, s, e });

describe("wren calls", () => {
  it("cuts the words into lines at sentence ends and long pauses", () => {
    const lines = segmentsOf([
      w("Hi", 0),
      w("there.", 0.4),
      w("How", 1),
      w("is", 1.4),
      w("work", 1.8),
      w("going", 5),
      w("lately?", 5.4),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Hi there.", "How is work", "going lately?"]);
    expect(lines[0]).toMatchObject({ start: 0, end: 0.7 });
  });

  it("keys a recording by its day and OBS name, so a retry lands on the same key", () => {
    const at = new Date("2026-10-16T14:02:11Z");
    expect(recordingKey("/Users/x/Movies/Wren calls/2026-10-16 14-02-11.mkv", at)).toBe(
      "calls/2026-10-16/2026-10-16-14-02-11.mp4",
    );
  });
});
