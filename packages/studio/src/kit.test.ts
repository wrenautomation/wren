import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FX } from "./fx.js";
import { audioFiles, loadBeds, stageSounds, unknownSounds } from "./kit.js";
import { PROMO_SOUNDS } from "./promo.js";
import { musicSchema, SOUND_RULES, soundFile, soundsSchema } from "./sounds.js";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = join(pkgDir, "sfx/fx");
const lock = JSON.parse(readFileSync(join(fx, "kit.lock.json"), "utf8")) as {
  earshot: string;
  roles: Record<string, { takes: { file: string }[] } | null>;
};

describe("the sound kit", () => {
  it("is earshot's launch kit as sfx/make.mjs made it: each take in the lock, each file its sha1", () => {
    expect(lock.earshot).toBe("0.4.0");
    const takes = Object.values(FX).flatMap((r) => r.takes);
    for (const [role, r] of Object.entries(FX))
      expect(
        r.takes.map((t) => t.file.replace(/\.ogg$/, ".wav")),
        role,
      ).toEqual(lock.roles[role]?.takes.map((t) => t.file));
    for (const t of takes)
      expect(
        createHash("sha1")
          .update(readFileSync(join(fx, t.file)))
          .digest("hex"),
        t.file,
      ).toBe(t.sha1);
    expect(readdirSync(fx).sort()).toEqual([...takes.map((t) => t.file), "kit.lock.json"].sort());
  });

  it("has the role each rule and each promo moment plays", () => {
    for (const id of [...SOUND_RULES.map((r) => r.id), ...Object.values(PROMO_SOUNDS)])
      expect(id in FX, id).toBe(true);
  });

  it("takes role effects and bed- beds, and stages only kit files", () => {
    expect(soundsSchema.safeParse([{ at: 1, id: "click" }]).success).toBe(true);
    expect(soundsSchema.safeParse([{ at: 1, id: "whoosh.short" }]).success).toBe(true);
    for (const id of ["studio/press", "suck", "click_1", "click.ogg"])
      expect(soundsSchema.safeParse([{ at: 1, id }]).success, id).toBe(false);
    expect(musicSchema.safeParse({ id: "bed-calm" }).success).toBe(true);
    expect(musicSchema.safeParse({ id: "click" }).success).toBe(false);
    expect(soundFile("hit_1.ogg")).toBe("sfx/fx/hit_1.ogg");
    expect(soundFile("bed-calm")).toBe("sfx/bed-calm.wav");
    expect(
      audioFiles({
        sounds: [{ file: "sfx/fx/pop_1.ogg", from: 0, volume: 1 }],
        music: { file: "track.mp3", volume: 1, duck: [], duckDb: 0 },
      }),
    ).toEqual(["sfx/fx/pop_1.ogg"]);
    expect(unknownSounds([], ["click", "bed-calm", "click-1"])).toEqual(["bed-calm", "click-1"]);
  });

  it("copies the sounds an output plays into the public dir, and refuses one it lacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-"));
    const files = audioFiles({
      sounds: [
        { file: soundFile("hit_1.ogg"), from: 0, volume: 1 },
        { file: soundFile("hit_1.ogg"), from: 9, volume: 1 },
      ],
      music: null,
    });
    expect(await stageSounds(dir, files, { pkgDir })).toBe(1);
    expect(existsSync(join(dir, "sfx/fx/hit_1.ogg"))).toBe(true);
    for (const bad of ["sfx/fx/zap_1.ogg", "sfx/fx/kit.lock.json", "sfx/fx/../make.mjs"])
      await expect(stageSounds(dir, [bad], { pkgDir }), bad).rejects.toThrow(
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
    await expect(stageSounds(dir, ["sfx/bed-calm.wav"], { pkgDir: kitDir, cache })).rejects.toThrow(
      /sfx pull/,
    );
    expect(await loadBeds(pkgDir)).toEqual([]);
  });
});
