import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRecordings, obsRecordingDir, parseIni } from "./obs.js";

async function obs(global: string, basic: string) {
  const home = await mkdtemp(join(tmpdir(), "obs-"));
  const root = join(home, "Library/Application Support/obs-studio");
  await mkdir(join(root, "basic/profiles/Talk"), { recursive: true });
  await writeFile(join(root, "user.ini"), global);
  await writeFile(join(root, "basic/profiles/Talk/basic.ini"), basic);
  return home;
}

describe("OBS recordings", () => {
  it("reads sections and keys", () => {
    expect(parseIni("[A]\nx=1\n; note\n[B]\ny = a=b\n")).toEqual({
      A: { x: "1" },
      B: { y: "a=b" },
    });
  });

  it("finds the folder from the current profile, simple or advanced", async () => {
    const simple = await obs(
      "[Basic]\nProfile=Talk\nProfileDir=Talk\n",
      "[Output]\nMode=Simple\n[SimpleOutput]\nFilePath=/rec/simple\n[AdvOut]\nRecFilePath=/rec/adv\n",
    );
    expect(await obsRecordingDir(simple)).toBe("/rec/simple");
    const adv = await obs(
      "[Basic]\nProfileDir=Talk\n",
      "[Output]\nMode=Advanced\n[AdvOut]\nRecType=Standard\nRecFilePath=/rec/adv\n",
    );
    expect(await obsRecordingDir(adv)).toBe("/rec/adv");
    expect(await obsRecordingDir(await mkdtemp(join(tmpdir(), "none-")))).toBeNull();
  });

  it("takes finished recordings only, never a camera file or one still written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rec-"));
    const now = Date.now();
    const file = async (name: string, ageS: number) => {
      await writeFile(join(dir, name), "x");
      const t = (now - ageS * 1000) / 1000;
      await utimes(join(dir, name), t, t);
    };
    await file("2026-10-06 10-00-00.mkv", 600);
    await file("2026-10-06 09-00-00.mp4", 900);
    await file("2026-10-06 11-00-00.mkv", 5);
    await file("webcam 2026-10-06 10-00-00.mkv", 600);
    await file("notes.txt", 600);
    expect(await findRecordings(dir, 60, now)).toEqual([
      join(dir, "2026-10-06 09-00-00.mp4"),
      join(dir, "2026-10-06 10-00-00.mkv"),
    ]);
  });
});
