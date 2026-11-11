import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cutsTrust,
  filmFacts,
  filmFactsSchema,
  seedFilmFacts,
  seedStudySchema,
  shotStats,
  shotsOf,
} from "./film.js";

/** The seed study, public film facts committed beside the design. */
const seed = seedStudySchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../designs/studies/2026-10-25-launch-films.json"),
      "utf8",
    ),
  ),
);

describe("film facts", () => {
  it("builds shots from a cut list: the first at 0, the last to the end, cuts past the end dropped", () => {
    const shots = shotsOf([3.337, 7.3, 99], 12.5);
    expect(shots.map((s) => [s.t, s.len])).toEqual([
      [0, 3.34],
      [3.34, 3.96],
      [7.3, 5.2],
    ]);
    expect(shots.every((s) => s.src === "scene" && s.type === null && s.move === null)).toBe(true);
    expect(shotsOf([], 8).map((s) => s.len)).toEqual([8]);
  });

  it("median, nearest-rank p90 and cuts per 10 s", () => {
    const shots = shotsOf([2, 4, 6, 8, 10, 12, 14, 16, 18, 30], 40);
    expect(shotStats(shots, 40)).toEqual({
      shot_median_s: 2,
      shot_p90_s: 10,
      cuts_per_10s: [4, 5, 0, 1],
    });
  });

  it("trusts hash within 20% of a hand count, else within 2x of adaptive", () => {
    expect(cutsTrust(7, 0, 8)).toBe("ok");
    expect(cutsTrust(43, 10, 34)).toBe("low");
    expect(cutsTrust(23, 22)).toBe("ok");
    expect(cutsTrust(14, 6)).toBe("low");
    expect(cutsTrust(14, 0)).toBe("low");
  });

  it("reads a Mac read's facts: hash shots, no labels, vo from the speech", () => {
    const f = filmFacts(
      {
        duration_s: 20,
        audio: true,
        cuts_by: { ffmpeg: [], hash: [5, 10], adaptive: [5, 10, 15] },
      },
      { speech: false },
    );
    expect(filmFactsSchema.parse(f)).toEqual(f);
    expect(f).toMatchObject({
      cuts: 2,
      cuts_by_signal: { hash: 2, adaptive: 3, ffmpeg: 0 },
      cuts_trust: "ok",
      shot_median_s: 5,
      cuts_per_10s: [1, 1],
      music: null,
      vo: false,
      first_product_s: null,
    });
    expect(f.shots).toHaveLength(3);
  });

  it("gives every seed film facts on the same rule, matching the study's median", () => {
    expect(seed.films).toHaveLength(15);
    const raw = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../designs/studies/2026-10-25-launch-films.json"),
        "utf8",
      ),
    ) as {
      films: {
        slug: string;
        shot_median_s: number;
        cuts: number;
        labels: string;
      }[];
    };
    for (const film of seed.films) {
      const f = filmFactsSchema.parse(seedFilmFacts(film));
      const study = raw.films.find((x) => x.slug === film.slug);
      // The study rounded in Python (half to even); a tenth either way is the same median.
      expect(Math.abs(f.shot_median_s - (study?.shot_median_s ?? 0)), film.slug).toBeLessThan(0.11);
      expect(f.cuts, film.slug).toBe(study?.cuts);
      expect(f.shots.every((s) => s.src === (film.labels === "hand" ? "hand" : "scene"))).toBe(
        true,
      );
    }
    // The design's rule: a hand count judges the hash detector; the Linear films pass, Director does not.
    const trust = Object.fromEntries(seed.films.map((f) => [f.slug, seedFilmFacts(f).cuts_trust]));
    expect(trust["linear-agent"]).toBe("ok");
    expect(trust["browserbase-director2"]).toBe("low");
    expect(trust.comet).toBe("low");
    expect(trust["openai-dots"]).toBe("ok");
  });
});
