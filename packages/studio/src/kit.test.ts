import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { audioIds, loadBeds, stageSounds, uisfxDir, unknownSounds } from "./kit.js";
import { CUES, musicSchema, SOUND_RULES, STYLES, soundFile, soundsSchema } from "./sounds.js";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(uisfxDir(pkgDir), "manifest.json"), "utf8")) as {
  license: { audio: string };
  packs: { name: string }[];
  assets: { pack: string; cue: string; defaultVolume: number }[];
};

describe("the sound kit", () => {
  it("is uisfx: CC0 audio, the same styles and cues and volumes as its manifest", () => {
    expect(manifest.license.audio).toBe("CC0-1.0");
    expect([...STYLES]).toEqual(manifest.packs.map((p) => p.name));
    for (const a of manifest.assets)
      expect(CUES[a.cue as keyof typeof CUES], a.cue).toBe(a.defaultVolume);
    expect(Object.keys(CUES).length * STYLES.length).toBe(manifest.assets.length);
  });

  it("has the file each rule plays", () => {
    for (const r of SOUND_RULES)
      expect(existsSync(join(uisfxDir(pkgDir), "sounds", `${r.id}.ogg`)), r.id).toBe(true);
  });

  it("takes <style>/<cue> effects and bed- beds, and stages only kit files", () => {
    expect(soundsSchema.safeParse([{ at: 1, id: "studio/press" }]).success).toBe(true);
    expect(soundsSchema.safeParse([{ at: 1, id: "cinematic/toggle-on" }]).success).toBe(true);
    for (const id of ["click-1", "studio/zap", "loud/press", "studio/press.ogg"])
      expect(soundsSchema.safeParse([{ at: 1, id }]).success, id).toBe(false);
    expect(musicSchema.safeParse({ id: "bed-calm" }).success).toBe(true);
    expect(musicSchema.safeParse({ id: "studio/press" }).success).toBe(false);
    expect(soundFile("studio/press")).toBe("sfx/studio/press.ogg");
    expect(soundFile("bed-calm")).toBe("sfx/bed-calm.wav");
    expect(
      audioIds({
        sounds: [{ file: "sfx/studio/open.ogg", from: 0, volume: 1 }],
        music: { file: "track.mp3", volume: 1, duck: [], duckDb: 0 },
      }),
    ).toEqual(["studio/open"]);
    expect(unknownSounds([], ["studio/press", "bed-calm", "click-1"])).toEqual([
      "bed-calm",
      "click-1",
    ]);
  });

  it("copies the sounds an output plays into the public dir, and refuses one it lacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    const ids = audioIds({
      sounds: [
        { file: soundFile("studio/press"), from: 0, volume: 1 },
        { file: soundFile("studio/press"), from: 9, volume: 1 },
      ],
      music: null,
    });
    expect(await stageSounds(dir, ids, { pkgDir })).toBe(1);
    expect(existsSync(join(dir, "sfx/studio/press.ogg"))).toBe(true);
    await expect(stageSounds(dir, ["studio/zap"], { pkgDir })).rejects.toThrow(
      /not in the sound kit/,
    );
  });

  it("refuses a bed not pulled, and a bed out of the bucket", async () => {
    const kitDir = mkdtempSync(join(tmpdir(), "kit-"));
    mkdirSync(join(kitDir, "sfx"));
    writeFileSync(join(kitDir, "package.json"), "{}");
    const bed = {
      id: "bed-calm",
      file: "bed-calm.wav",
      tags: [],
      durationS: 60,
      licence: "Pixabay",
      source: "pixabay:1",
    };
    writeFileSync(join(kitDir, "sfx/kit.json"), JSON.stringify({ beds: [bed] }));
    await expect(loadBeds(kitDir)).rejects.toThrow();
    writeFileSync(
      join(kitDir, "sfx/kit.json"),
      JSON.stringify({ beds: [{ ...bed, where: "bucket" }] }),
    );
    const cache = join(kitDir, "cache");
    mkdirSync(cache);
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    await expect(stageSounds(dir, ["bed-calm"], { pkgDir: kitDir, cache })).rejects.toThrow(
      /sfx pull/,
    );
    expect(await loadBeds(pkgDir)).toEqual([]);
  });
});
