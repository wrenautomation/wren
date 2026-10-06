import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CUT_DEFAULTS, keepSegments, reviewCuts, toCutTime } from "./cuts.js";
import { silencePass } from "./media.js";
import type { Word } from "./schema.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Synthetic speech: 440 Hz bursts as words over a faint noise floor.
const TONES: [number, number][] = [
  [0.5, 1.2],
  [1.5, 2.0], // 0.3 s gap before: short, kept
  [3.5, 4.2], // 1.5 s gap before: cut
  [4.8, 5.5], // 0.6 s gap before: under 0.7, kept
  [7.5, 8.0], // 2.0 s gap before: cut
];
const DURATION = 8.3;
// Whisper-like drift: starts early, and word 4 starts late (a transcript gap of 0.8 s over 0.6 s of
// real silence, which must not cut).
const WORDS: Word[] = [
  { w: "one", s: 0.42, e: 1.25 },
  { w: "two", s: 1.4, e: 2.05 },
  { w: "three", s: 3.3, e: 4.2 },
  { w: "four", s: 5.0, e: 5.5 },
  { w: "five", s: 7.3, e: 8.05 },
];

describe.skipIf(!hasFfmpeg)("silence cuts on a synthetic track", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-cuts-"));
  const wav = join(dir, "fixture.wav");
  const on = TONES.map(([a, b]) => `between(t,${a},${b})`).join("+");
  execFileSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i"],
    `aevalsrc='0.5*sin(2*PI*440*t)*(${on})+0.002*sin(2*PI*97*t)':s=16000:d=${DURATION}`,
    wav,
  ]);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("cuts the long gaps only, the same way twice, never inside a word", async () => {
    const a = (await silencePass(wav, WORDS, DURATION, "ffmpeg", CUT_DEFAULTS)).cuts;
    const b = (await silencePass(wav, WORDS, DURATION, "ffmpeg", CUT_DEFAULTS)).cuts;
    expect(b).toEqual(a);
    expect(a).toHaveLength(2);
    const [first, second] = a as [(typeof a)[0], (typeof a)[0]];
    // Inside the real silence, with the air kept on each side of the sound.
    expect(first.from).toBeGreaterThanOrEqual(2.0 + CUT_DEFAULTS.airS);
    expect(first.to).toBeLessThanOrEqual(3.5 - CUT_DEFAULTS.airS);
    expect(second.from).toBeGreaterThanOrEqual(5.5 + CUT_DEFAULTS.airS);
    expect(second.to).toBeLessThanOrEqual(7.5 - CUT_DEFAULTS.airS);
    for (const c of a) {
      expect(WORDS.some((w) => w.s < c.to && w.e > c.from)).toBe(false);
      for (const [s, e] of TONES) expect(s < c.to && e > c.from).toBe(false);
    }
    expect(reviewCuts(a, WORDS).flatMap((r) => r.flags)).toEqual([]);
  });

  it("still cuts where whisper smears a word across the pause", async () => {
    // "two" runs on to the next word, "five" starts back at the end of "four": no transcript gap.
    const smeared = WORDS.map((w) =>
      w.w === "two" ? { ...w, e: 3.3 } : w.w === "five" ? { ...w, s: 5.5 } : w,
    );
    const { words, cuts } = await silencePass(wav, smeared, DURATION, "ffmpeg", CUT_DEFAULTS);
    expect(cuts).toHaveLength(2);
    for (const c of cuts) expect(words.some((w) => w.s < c.to && w.e > c.from)).toBe(false);
    expect(words.find((w) => w.w === "two")?.e).toBeLessThan(2.3);
    expect(words.find((w) => w.w === "five")?.s).toBeGreaterThan(7.2);
  });

  it("keeps the short gaps on the cut timeline", async () => {
    const cuts = (await silencePass(wav, WORDS, DURATION, "ffmpeg", CUT_DEFAULTS)).cuts;
    const keep = keepSegments(cuts, DURATION);
    for (const t of [1.3, 1.45, 4.3, 4.7]) expect(toCutTime(t, keep)).not.toBeNull();
    expect(toCutTime(2.8, keep)).toBeNull();
    expect(toCutTime(6.5, keep)).toBeNull();
  });
});

describe("cut review", () => {
  it("flags long cuts and cuts that touch a word", () => {
    const rows = reviewCuts(
      [
        { from: 8.3, to: 10.6, why: "silence", state: "cut" },
        { from: 4.9, to: 5.2, why: "manual", state: "cut" },
      ],
      WORDS,
    );
    expect(rows.map((r) => r.flags)).toEqual([["long"], ["touches a word"]]);
    expect(rows[0]?.before).toBe("two three four five");
  });
});
