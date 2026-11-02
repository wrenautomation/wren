import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  capEvents,
  capNotReady,
  capProjectOf,
  capTracks,
  findCapProjects,
  parseKeyboard,
} from "./cap.js";
import { probe } from "./media.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Key presses as Cap 0.6 writes keyboard.bin: `CPKB01`, then bincode's varints and f64s. */
function keyboardBin(presses: { key: string; code: string; ms: number; down: boolean }[]) {
  const out: number[] = [...Buffer.from("CPKB01")];
  const varint = (n: number) => {
    if (n < 251) out.push(n);
    else out.push(251, n & 0xff, n >> 8);
  };
  const str = (s: string) => {
    const b = Buffer.from(s);
    varint(b.length);
    out.push(...b);
  };
  varint(presses.length);
  for (const p of presses) {
    str(p.key);
    str(p.code);
    const f = Buffer.alloc(8);
    f.writeDoubleLE(p.ms);
    out.push(...f, p.down ? 1 : 0);
  }
  return Buffer.from(out);
}

describe("Cap key presses", () => {
  it("reads the bincode file and the older JSON", () => {
    const bin = keyboardBin([
      { key: "a", code: "KeyA", ms: 100.5, down: true },
      { key: "x".repeat(300), code: "KeyX", ms: 2000, down: false },
    ]);
    expect(parseKeyboard(bin)).toEqual([
      { key: "a", timeMs: 100.5, down: true },
      { key: "x".repeat(300), timeMs: 2000, down: false },
    ]);
    const json = { presses: [{ key: "b", keyCode: "KeyB", timeMs: 40, down: true }] };
    expect(parseKeyboard(Buffer.from(JSON.stringify(json)))).toEqual(json.presses);
  });

  it("finds the project a track came from", () => {
    expect(capProjectOf("/r/Talk.cap/content/segments/segment-0/display.mp4")).toBe("/r/Talk.cap");
    expect(capProjectOf("/r/screen.mkv")).toBeNull();
  });
});

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
      const clicks = [
        { active_modifiers: [], cursor_num: 0, cursor_id: "0", time_ms: 200 + i * 100, down: true },
        {
          active_modifiers: [],
          cursor_num: 0,
          cursor_id: "0",
          time_ms: 260 + i * 100,
          down: false,
        },
      ];
      writeFileSync(join(project, seg, "cursor.json"), JSON.stringify({ clicks, moves: [] }));
      if (i === 0)
        writeFileSync(
          join(project, seg, "keyboard.json"),
          JSON.stringify({
            presses: [
              { key: "LShift", keyCode: "ShiftLeft", timeMs: 90, down: true },
              { key: "a", keyCode: "KeyA", timeMs: 100, down: true },
              { key: "a", keyCode: "KeyA", timeMs: 150, down: false },
            ],
          }),
        );
      else
        writeFileSync(
          join(project, seg, "keyboard.bin"),
          keyboardBin([{ key: "b", code: "KeyB", ms: 500, down: true }]),
        );
      return {
        cursor: `${seg}/cursor.json`,
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

  it("moves each segment's clicks and key taps onto the joined file", async () => {
    const one = (await probe(join(project, "content/segments/segment-0/display.mp4"), "ffmpeg"))
      .durationS;
    const ev = await capEvents(project, "ffmpeg");
    expect(ev.clicks[0]).toBeCloseTo(0.2);
    expect(ev.clicks[1]).toBeCloseTo(one + 0.3);
    expect(ev.keys).toHaveLength(2);
    expect(ev.keys[0]).toBeCloseTo(0.1);
    expect(ev.keys[1]).toBeCloseTo(one + 0.5);
  });
});
