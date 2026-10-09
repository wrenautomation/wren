import { describe, expect, it } from "vitest";
import { FakeMouth } from "./fakes.js";
import { pcm16, readAloud, readable, type Speakers, samples, sentencesOf } from "./reading.js";
import type { Frame } from "./types.js";

const words = (fs: Frame[]) => fs.map((f) => new TextDecoder().decode(f.data)).join(" ");

describe("reading aloud", () => {
  it("says markdown, links and lists the way a person would", () => {
    expect(readable("# Plan\n\n- **Call** Dana\n- See [the deck](https://x.test/d)\n")).toBe(
      "Plan. Call Dana, See the deck",
    );
    expect(readable("Read https://wren.test/a?b=1 now.")).toBe("Read a link now.");
  });

  it("cuts sentences, and a long one at a comma", () => {
    expect(sentencesOf("One. Two? Dr. Lee said three!")).toEqual([
      "One.",
      "Two?",
      "Dr. Lee said three!",
    ]);
    const long = `${"word ".repeat(50).trim()}, ${"more ".repeat(40).trim()}.`;
    const cut = sentencesOf(long, 300);
    expect(cut).toHaveLength(2);
    expect(cut.every((s) => s.length <= 300)).toBe(true);
  });

  it("keeps 16-bit samples through a frame", () => {
    const back = samples(pcm16(new Float32Array([0, 0.5, -0.5, 1, -1]), 24_000));
    expect([...back].map((n) => Math.round(n * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
  });

  it("plays each sentence in order, and stops when told", async () => {
    const heard: string[] = [];
    const at: number[] = [];
    const ctl = new AbortController();
    const speakers: Speakers = {
      play: async (fs) => {
        heard.push(words(fs));
        if (heard.length === 2) ctl.abort();
      },
    };
    await readAloud(new FakeMouth(), speakers, "First one. Second one. Third one.", ctl.signal, {
      sentence: (i, of) => at.push(i, of),
    });
    expect(heard).toEqual(["First one.", "Second one."]);
    expect(at).toEqual([0, 3, 1, 3]);
  });
});
