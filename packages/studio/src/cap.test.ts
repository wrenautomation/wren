import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  // In a hook: a skipped describe's body still runs, and CI has no ffmpeg.
  beforeAll(() => {
    const segments = [0, 1].map((i) => {
      const seg = `content/segments/segment-${i}`;
      mkdirSync(join(project, seg), { recursive: true });
      ff("-i", "testsrc=size=320x180:rate=30:duration=2", join(project, seg, "display.mp4"));
      ff("-i", "testsrc=size=160x120:rate=30:duration=2", join(project, seg, "camera.mp4"));
      ff(
        "-i",
        "sine=frequency=440:duration=2",
        "-c:a",
        "libopus",
        join(project, seg, "audio-input.ogg"),
      );
      return {
        display: { path: `${seg}/display.mp4`, fps: 30, start_time: 0 },
        camera: { path: `${seg}/camera.mp4`, fps: 30, start_time: 0.1 },
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
    expect(main).toMatchObject({ width: 320, height: 180, audio: true });
    expect(main.durationS).toBeGreaterThan(3.8);
    const cam = await probe(t.cam as string, "ffmpeg");
    expect(cam).toMatchObject({ width: 160, height: 120, audio: false });
  });
});
