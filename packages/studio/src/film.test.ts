import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { filmAssets, filmHistory, longFilm, shortFilm, wordsVtt } from "./film.js";
import type { VideoEdit } from "./schema.js";

/** A 100 s recording with a camera file, a word every 0.4 s, one cut, two Shorts, an overlay. */
const base = (): VideoEdit =>
  ({
    id: 7,
    title: "A talk",
    state: "edited",
    formats: ["long", "vertical"],
    tracks: {
      main: { path: "/r/screen.mkv", durationS: 100, width: 1920, height: 1080, fps: 30 },
      cam: { path: "/r/cam.mp4", durationS: 101, width: 1920, height: 1080, fps: 30, offsetS: 0.5 },
    },
    cuts: [
      { from: 10, to: 12, why: "silence", state: "cut" },
      { from: 30, to: 31, why: "filler", state: "proposed" },
    ],
    words: Array.from({ length: 240 }, (_, i) => ({ w: `w${i}`, s: i * 0.4, e: i * 0.4 + 0.3 })),
    layout: [{ from: 40, to: 50, show: "screen" }],
    captions: { style: "word", long: "screen", short: "screen" },
    stress: [],
    shorts: [
      { from: 20, to: 45, title: "First" },
      { from: 50, to: 80, title: "Second", card: false },
    ],
    overlays: [{ text: "Fish & <chips>", from: 5, to: 8, x: 0.5, y: 0.2, size: "m" }],
    crops: {},
    locked: [],
    files: {},
    keys: {},
  }) as unknown as VideoEdit;

/** OpenFilm's own strict reader, when npx has fetched it on this machine (`npx openfilm`). */
function openfilmReader(): string | null {
  const root = join(homedir(), ".npm", "_npx");
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) {
    const f = join(root, d, "node_modules", "openfilm", "src", "film-doc.mjs");
    if (existsSync(f)) return f;
  }
  return null;
}
const reader = openfilmReader();

const clips = (html: string) => [...html.matchAll(/<(video|iframe)\b[^>]*>/g)].map((m) => m[0]);

describe("film", () => {
  it("plays the kept spans of the raw recording, split where the layout changes", () => {
    const html = longFilm(base())["film.html"] as string;
    const screen = clips(html).filter((c) => c.includes('id="screen-'));
    // 0-10, 12-40 (a proposed cut stays), 40-50 screen, 50-100.
    expect(screen.map((c) => c.match(/#t=([^"]+)/)?.[1])).toEqual([
      "0,10",
      "12,40",
      "40,50",
      "50,100",
    ]);
    expect(screen.map((c) => c.match(/ at="([^"]+)"/)?.[1])).toEqual(["0", "10", "38", "48"]);
    expect(html).toContain('src="assets/main.mkv#t=0,10"');
    expect(html).toContain('<meta name="viewport" content="width=1920, height=1080">');
  });

  it("puts the camera in the corner, off under the screen layout, on its own clock and muted", () => {
    const html = longFilm(base())["film.html"] as string;
    const cam = clips(html).filter((c) => c.includes('id="cam-'));
    expect(cam).toHaveLength(3);
    expect(cam[0]).toContain('src="assets/cam.mp4#t=0.5,10.5"');
    expect(cam[0]).toContain('volume="0"');
    expect(cam.join("")).not.toContain("#t=40.5,50.5");
  });

  it("makes each overlay a page clip with its text, escaped", () => {
    const f = longFilm(base());
    const html = f["film.html"] as string;
    expect(html).toContain('title="Fish &amp; &lt;chips&gt;"');
    expect(html).toContain('src="pages/overlay-1.html#t=0,3"');
    expect(f["pages/overlay-1.html"]).toContain("window.film");
    expect(f["pages/overlay-1.html"]).toContain("Fish &amp; &lt;chips&gt;");
  });

  it("writes the words as WebVTT in the recording's seconds, a tag per word", () => {
    const vtt = wordsVtt(base());
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toMatch(/00:00:00\.000 --> 00:00:0\d\.\d{3}\nw0 <00:00:00\.400>w1/);
    // Words inside the cut are not heard, so no cue holds them.
    expect(vtt).not.toMatch(/>w26\b/);
    expect(longFilm(base())["assets/main.vtt"]).toBe(vtt);
  });

  it("frames a Short at 1080 x 1920 from its own start, face over screen", () => {
    const f = shortFilm(base(), 1);
    const html = f["film.html"] as string;
    expect(html).toContain('content="width=1080, height=1920"');
    const screen = clips(html).filter((c) => c.includes('id="screen-'));
    expect(screen[0]).toContain('#t=20,40" at="0"');
    expect(screen[0]).toContain("top: 960px");
    // Under the screen layout the recording fills the frame and the face goes.
    expect(screen[1]).toContain("top: 0px; width: 1080px; height: 1920px");
    expect(clips(html).filter((c) => c.includes('id="face-'))).toHaveLength(1);
    expect(f["pages/short-1-card.html"]).toContain("First");
    expect(shortFilm(base(), 2)["pages/short-2-card.html"]).toBeUndefined();
    expect(() => shortFilm(base(), 3)).toThrow(/no 3/);
  });

  it("splits a Short where only the Short knobs cut a pause", () => {
    const e: VideoEdit = {
      ...base(),
      shortCuts: [{ from: 25, to: 25.5, why: "silence", state: "cut" }],
    };
    const screen = clips(shortFilm(e, 1)["film.html"] as string).filter((c) =>
      c.includes('id="screen-'),
    );
    expect(screen[0]).toContain('#t=20,25" at="0"');
    expect(screen[1]).toContain('#t=25.5,40" at="5"');
    // The long video keeps that pause.
    expect(longFilm(e)["film.html"]).not.toContain("#t=25.5");
  });

  it("marks the tracks a person locked", () => {
    const e = { ...base(), locked: ["cuts", "shorts.2"] };
    expect(longFilm(e)["film.html"]).toMatch(/<section title="recording" locked>/);
    expect(longFilm(e)["film.html"]).toMatch(/<section title="text">/);
    expect(shortFilm(e, 2)["film.html"]).toMatch(/<section title="face" locked>/);
    expect(shortFilm(e, 1)["film.html"]).toMatch(/<section title="text">/);
  });

  it("plays the sounds on the cut clock in a sound track, the bed under it all", () => {
    const e = {
      ...base(),
      sounds: [
        { at: 5, id: "pop-1" },
        { at: 11, id: "click-1" },
        { at: 14, id: "click-1", only: "short" },
      ],
      music: { id: "bed-calm" },
    } as VideoEdit;
    const html = longFilm(e)["film.html"] as string;
    const audio = [...html.matchAll(/<audio\b[^>]*>/g)].map((m) => m[0]);
    // The click at 11 s is inside the 10-12 cut; the one at 14 is for Shorts only.
    expect(audio).toHaveLength(2);
    expect(audio[0]).toContain('src="sfx/pop-1.wav" at="5"');
    expect(audio[1]).toContain('id="music-1" src="sfx/bed-calm.wav#t=0,98" at="0"');
    // A 40 s bed under a 98 s film: three passes.
    const passes = (longFilm(e, { bedS: 40 })["film.html"] as string).match(/id="music-\d"[^>]*/g);
    expect(passes).toEqual([
      'id="music-1" src="sfx/bed-calm.wav#t=0,40" at="0" volume="0.158"',
      'id="music-2" src="sfx/bed-calm.wav#t=0,40" at="40" volume="0.158"',
      'id="music-3" src="sfx/bed-calm.wav#t=0,18" at="80" volume="0.158"',
    ]);
    expect(filmAssets(e).sounds).toEqual(["pop-1", "click-1", "bed-calm"]);
    const short = shortFilm(e, 1)["film.html"] as string;
    // Short 1 starts at 20 raw, 18 on the cut: nothing before it plays.
    expect(short).not.toContain("pop-1");
  });

  it("is a pure function of the row", () => {
    expect(longFilm(base())).toEqual(longFilm(JSON.parse(JSON.stringify(base()))));
    expect(filmAssets(base())).toEqual({
      sounds: [],
      main: "assets/main.mkv",
      cam: "assets/cam.mp4",
    });
  });

  it.skipIf(!reader)("reads in OpenFilm's own reader with no problem", async () => {
    const { readFilmFile } = await import(pathToFileURL(reader as string).href);
    const e = {
      ...base(),
      locked: ["cuts"],
      sounds: [{ at: 21, id: "pop-1" }],
      music: { id: "bed-calm" },
    } as VideoEdit;
    for (const f of [longFilm(e), shortFilm(e, 1), shortFilm(e, 2)]) {
      const got = readFilmFile(f["film.html"]);
      expect(got.problems).toEqual([]);
      expect(got.doc.tracks.length).toBeGreaterThan(0);
    }
  });

  it("shows each change as a diff of the films it moved, newest first", () => {
    const now = { ...base(), cuts: [], overlays: [] };
    const runs = [
      {
        run: "2",
        command: "video set",
        by: "william",
        at: "t2",
        before: { overlays: base().overlays },
      },
      { run: "1", command: "video-ask", by: "agent", at: "t1", before: { cuts: base().cuts } },
    ];
    const [last, first] = filmHistory(now, runs);
    expect(last?.diff).toContain('-  <iframe id="overlay-1"');
    expect(last?.diff).toContain("a/long/film.html");
    expect(last?.diff).not.toContain("short-2/film.html");
    expect(first?.diff).toContain('-  <video id="screen-1" src="assets/main.mkv#t=0,10"');
    expect(first?.diff).toContain('+  <video id="screen-1" src="assets/main.mkv#t=0,40"');
    expect(first?.fields).toEqual(["cuts"]);
  });
});
