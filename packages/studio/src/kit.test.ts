import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audioIds, KIT_DIR, kitPath, loadKit, stageSounds } from "./kit.js";
import { GAIN_DB, kindOf, SOUND_RULES, soundFile } from "./sounds.js";

describe("the sound kit", () => {
  it("has every repo file it names, each a 48 kHz mono wav", async () => {
    const kit = await loadKit();
    expect(kit.length).toBeGreaterThan(0);
    for (const e of kit.filter((k) => k.where !== "bucket")) {
      expect(existsSync(kitPath(e)), e.id).toBe(true);
      const b = readFileSync(kitPath(e));
      expect(b.toString("ascii", 0, 4)).toBe("RIFF");
      expect(b.readUInt16LE(22), `${e.id} channels`).toBe(1);
      expect(b.readUInt32LE(24), `${e.id} rate`).toBe(48000);
      expect(kindOf(e.id)).toBe(e.kind);
      expect(GAIN_DB[e.kind]).toBeDefined();
    }
  });

  it("has the sound each rule plays", async () => {
    const ids = new Set((await loadKit()).map((e) => e.id));
    for (const r of SOUND_RULES) expect(ids.has(r.id), r.id).toBe(true);
  });

  it("copies the sounds an output plays into the public dir, and refuses one it lacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    const ids = audioIds({
      sounds: [
        { file: soundFile("click-1"), from: 0, volume: 1 },
        { file: soundFile("click-1"), from: 9, volume: 1 },
      ],
      music: null,
    });
    expect(await stageSounds(dir, ids)).toBe(1);
    expect(existsSync(join(dir, "sfx/click-1.wav"))).toBe(true);
    await expect(stageSounds(dir, ["click-404"])).rejects.toThrow(/not in the sound kit/);
  });

  it("refuses a bucket sound not pulled, and a non-CC0 file in the repo", async () => {
    const kitDir = mkdtempSync(join(tmpdir(), "kit-"));
    const entry = {
      id: "bed-calm",
      file: "bed-calm.wav",
      kind: "bed",
      tags: [],
      durationS: 60,
      licence: "Pixabay",
      source: "pixabay:1",
    };
    writeFileSync(join(kitDir, "kit.json"), JSON.stringify({ sounds: [entry] }));
    await expect(loadKit(kitDir)).rejects.toThrow(/only CC0/);
    writeFileSync(
      join(kitDir, "kit.json"),
      JSON.stringify({ sounds: [{ ...entry, where: "bucket" }] }),
    );
    const cache = join(kitDir, "cache");
    mkdirSync(cache);
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    await expect(stageSounds(dir, ["bed-calm"], { kitDir, cache })).rejects.toThrow(/sfx pull/);
    expect(KIT_DIR).toMatch(/sfx$/);
  });
});
