import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { capNotReady, capTracks, findCapProjects } from "./cap.js";
import { probe } from "./media.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("Cap projects", () => {
  it("is ready only once Cap says Complete", () => {
    expect(capNotReady(null)).toMatch(/no recording-meta/);
    expect(capNotReady({ segments: [], status: { status: "InProgress" } })).toBe("InProgress");
    expect(capNotReady({ segments: [], status: { status: "NeedsRemux" } })).toMatch(/finishing/);
    expect(capNotReady({ status: { status: "Failed", error: "no mic" } })).toBe("failed: no mic");
    expect(capNotReady({ recording: true })).toBe("still recording");
    expect(capNotReady({ segments: [], status: { status: "Complete" } })).toBeNull();
    expect(capNotReady({ fps: 30 })).toBeNull();
  });
});

// The layout Cap 0.6 writes (crates/project/src/meta.rs): two segments, a pause between.
describe.skipIf(!hasFfmpeg)("a synthetic Cap project", () => {
  const root = mkdtempSync(join(tmpdir(), "cap-"));
  const project = join(root, "Talk 2026-10-06.cap");
  const ff = (...args: string[]) =>
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", ...args], { stdio: "ignore" });
  // In a hook: a skipped describe's body still runs, and CI has no ffmpeg. Each track is made
  // once, a second long at a low rate, and copied into both segments: six encodes ran past the
  // hook's limit on a loaded machine.
  beforeAll(() => {
    const made = join(root, "made");
    mkdirSync(made);
    const [display, camera, mic] = ["display.mp4", "camera.mp4", "audio-input.ogg"].map((f) =>
      join(made, f),
    ) as [string, string, string];
    ff("-i", "testsrc=size=64x36:rate=10:duration=1", display);
    ff("-i", "testsrc=size=32x24:rate=10:duration=1", camera);
    ff("-i", "sine=frequency=440:duration=1", "-c:a", "libopus", mic);
    const segments = [0, 1].map((i) => {
      const seg = `content/segments/segment-${i}`;
      mkdirSync(join(project, seg), { recursive: true });
      copyFileSync(display, join(project, seg, "display.mp4"));
      copyFileSync(camera, join(project, seg, "camera.mp4"));
      copyFileSync(mic, join(project, seg, "audio-input.ogg"));
      return {
        display: { path: `${seg}/display.mp4`, fps: 10, start_time: 0 },
        camera: { path: `${seg}/camera.mp4`, fps: 10, start_time: 0.1 },
        mic: { path: `${seg}/audio-input.ogg`, start_time: 0.05 },
      };
    });
    const meta = {
      platform: "MacOS",
      pretty_name: "Talk 2026-10-06",
      sharing: null,
      segments,
      cursors: {},
      status: { status: "Complete" },
    };
    writeFileSync(join(project, "recording-meta.json"), JSON.stringify(meta));
  });

  it("joins the screen with its mic and the camera, offset by Cap's start times", async () => {
    expect(await findCapProjects(root)).toEqual([project]);
    const t = await capTracks(project, "ffmpeg");
    expect(t.offsetS).toBeCloseTo(0.1);
    const main = await probe(t.main, "ffmpeg");
    expect(main).toMatchObject({ width: 64, height: 36, audio: true });
    expect(main.durationS).toBeGreaterThan(1.8);
    const cam = await probe(t.cam as string, "ffmpeg");
    expect(cam).toMatchObject({ width: 32, height: 24, audio: false });
  });
});
