import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoCamera, clip } from "./camera.js";
import { CURSOR, cursorAt, cursorTrack } from "./cursor.js";
import { cameraAt, promoProps, promoScript, TAKE_SOUNDS } from "./promo.js";
import {
  besideAt,
  eventsIn,
  paneOf,
  paneSeconds,
  readTake,
  type Take,
  type TakePane,
} from "./take.js";

const T0 = 1_800_000_000_000;
/** A browser pane: moves to a field, types "a b", Enter, then clicks a link that loads a page. */
const web: TakePane = {
  name: "web-1",
  file: "web-1.mp4",
  kind: "web",
  start: T0,
  end: T0 + 12_000,
  size: [1000, 500],
  scale: 2,
  events: [
    { kind: "load", t: 100, url: "https://example.com/" },
    { kind: "move", t: 2000, x: 100, y: 100 },
    { kind: "move", t: 2500, x: 300, y: 200 },
    { kind: "focus", t: 3000, box: { x: 250, y: 180, w: 100, h: 40 } },
    { kind: "key", t: 3200, key: "a" },
    { kind: "key", t: 3400, key: " " },
    { kind: "key", t: 3600, key: "Enter" },
    { kind: "move", t: 6500, x: 600, y: 400 },
    { kind: "down", t: 7000, x: 600, y: 400 },
    { kind: "up", t: 7080, x: 600, y: 400 },
    { kind: "load", t: 7200, url: "https://example.com/next/" },
  ],
};
/** A terminal opened 2 s before the browser, typing. */
const term: TakePane = {
  name: "term",
  file: "term.mp4",
  kind: "term",
  start: T0 - 2000,
  end: T0 + 14_000,
  size: [800, 500],
  scale: 2,
  events: [
    { kind: "key", t: 500, key: "l" },
    { kind: "key", t: 600, key: "s" },
    { kind: "key", t: 700, key: "Enter" },
  ],
};
const take: Take = { dir: "t1", panes: { term, "web-1": web }, order: ["term", "web-1"] };

describe("take", () => {
  it("reads a filmed folder and refuses one with a pane's video missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "take-"));
    mkdirSync(join(root, "t1"));
    writeFileSync(
      join(root, "t1/take.json"),
      JSON.stringify({ version: 1, panes: ["term", "web-1"] }),
    );
    for (const p of [term, web]) writeFileSync(join(root, `t1/${p.name}.json`), JSON.stringify(p));
    writeFileSync(join(root, "t1/term.mp4"), "");
    await expect(readTake(root, "t1")).rejects.toThrow(/web-1.mp4 is missing/);
    writeFileSync(join(root, "t1/web-1.mp4"), "");
    expect(await readTake(root, "t1")).toEqual(take);
    await expect(readTake(root, "none")).rejects.toThrow(/no take.json/);
  });

  it("picks the first web pane, and names the panes it has when asked for one it has not", () => {
    expect(paneOf(take).name).toBe("web-1");
    expect(paneOf(take, "term").name).toBe("term");
    expect(() => paneOf(take, "web-2")).toThrow(/it has term, web-1/);
    expect(paneSeconds(web)).toBe(12);
  });

  it("cuts a pane's log to a shot in seconds, with a lead before the cut", () => {
    expect(eventsIn(web, 3, 4).map((e) => Math.round(e.t * 10) / 10)).toEqual([0, 0.2, 0.4, 0.6]);
    expect(eventsIn(web, 3, 4, 1).map((e) => Math.round(e.t * 10) / 10)).toEqual([
      -1, -0.5, 0, 0.2, 0.4, 0.6,
    ]);
    // Both panes are on one clock: 3 s into the browser is 5 s into the terminal.
    expect(besideAt(web, term, 3)).toBe(5);
    expect(besideAt(term, web, 1)).toBe(-1);
  });
});

describe("cursor", () => {
  const track = cursorTrack(eventsIn(web, 0, 12));
  if (!track) throw new Error("no track");

  it("follows the hands' own points, in a straight line from each to the next", () => {
    expect(cursorAt(track, 2.25)).toMatchObject({ x: 200, y: 150 });
    expect(cursorAt(track, 9)).toMatchObject({ x: 600, y: 400 });
  });

  it("fades in on the first move and out after a still spell", () => {
    expect(cursorAt(track, 1).opacity).toBe(0);
    expect(cursorAt(track, 2.01 + CURSOR.inS).opacity).toBe(1);
    expect(cursorAt(track, 2.51 + CURSOR.idleS + CURSOR.outS).opacity).toBe(0);
    expect(track.runs).toEqual([
      [2, 2.5],
      [6.5, 7],
    ]);
  });

  it("shrinks on a press, springs back after it, and spreads a ring where it was pressed", () => {
    expect(track.presses).toEqual([[7, 7.08, 600, 400]]);
    expect(cursorAt(track, 7.07).scale).toBeCloseTo(0.85, 2);
    expect(cursorAt(track, 7.09 + CURSOR.releaseS).scale).toBe(1);
    expect(cursorAt(track, 7.1).ring).toMatchObject({ x: 600, y: 400 });
    expect(cursorAt(track, 7.01 + CURSOR.ringS).ring).toBeNull();
  });

  it("has no track without a pointer", () => {
    expect(cursorTrack(eventsIn(term, 0, 16))).toBeNull();
  });
});

describe("auto camera", () => {
  const keys = autoCamera(eventsIn(web, 0, 12), web.size, 12);

  it("pushes in before a run of acts, follows them, and pulls back after a hold", () => {
    const zoom = (t: number) => cameraAt(keys, t).zoom;
    expect(zoom(2)).toBe(1);
    expect(zoom(3)).toBe(1.8);
    // The field's middle: (300, 200) of 1000 by 500.
    expect(cameraAt(keys, 3.4)).toMatchObject({ x: 0.3, y: 0.4 });
    expect(zoom(3.6 + 1)).toBe(1.8);
    expect(zoom(3.6 + 1 + 0.6)).toBe(1);
    expect(zoom(7)).toBe(1.8);
  });

  it("pulls back at once when a click loads a page", () => {
    // The load at 7.2 s ends the hold the click started.
    expect(cameraAt(keys, 7.2).zoom).toBe(1.8);
    expect(cameraAt(keys, 7.8).zoom).toBe(1);
  });

  it("starts a shot cut inside a run where the camera is", () => {
    const cut = autoCamera(eventsIn(web, 3.3, 8, 4), web.size, 4.7);
    expect(cut[0]).toMatchObject({ at: 0, zoom: 1.8 });
    expect(cut.at(-1)?.at).toBe(4.7);
    expect(cut.every((k, i) => i === 0 || k.at >= (cut[i - 1]?.at ?? 0))).toBe(true);
  });

  it("keeps none without acts, and clips given keys to the shot", () => {
    expect(autoCamera(eventsIn(term, 0, 16), term.size, 16)).toEqual([]);
    const c = clip([{ at: 2, x: 0.2, y: 0.2, zoom: 2 }], 1);
    expect(c.map((k) => k.at)).toEqual([0, 1]);
    expect(c[1]?.zoom).toBe(1.5);
  });
});

describe("take scene", () => {
  const script = promoScript.parse({
    scenes: [
      { kind: "text", lines: ["Hi"], seconds: 2 },
      { kind: "take", take: "t1", from: 2, beside: "term" },
    ],
  });
  const p = promoProps(script, {}, { takes: { t1: take } });
  const s = p.scenes[1];

  it("plays at 60 frames a second, its scenes still on 30 beats", () => {
    expect(p.fps).toBe(60);
    expect(s).toMatchObject({ from: 60, frames: 300, to: 12 });
    expect(p.durationInFrames).toBe(720);
  });

  it("cuts the shot from the take: videos, the beside pane on its clock, the bar", () => {
    expect(s?.shot?.pane).toMatchObject({ video: "t1/web-1.mp4", at: 2, kind: "web" });
    expect(s?.shot?.pane.bar).toEqual([
      [-1.9, "example.com"],
      [5.2, "example.com/next"],
    ]);
    expect(s?.shot?.beside).toMatchObject({ video: "t1/term.mp4", at: 4, bar: [[0, "Terminal"]] });
    expect(s?.shot?.cursor?.presses).toEqual([[5, 5.08, 600, 400]]);
  });

  it("sounds each key and click of both panes, and a whoosh under each push in", () => {
    const sounds = s?.shot?.sounds.map(([t, id, db]) => [Math.round(t * 100) / 100, id, db]);
    expect(sounds).toContainEqual([1.2, TAKE_SOUNDS.key, undefined]);
    expect(sounds).toContainEqual([1.4, TAKE_SOUNDS[" "], undefined]);
    expect(sounds).toContainEqual([1.6, TAKE_SOUNDS.Enter, undefined]);
    expect(sounds).toContainEqual([5, TAKE_SOUNDS.down, undefined]);
    expect(sounds?.filter(([, id]) => id === TAKE_SOUNDS.zoom).length).toBe(2);
    // The terminal typed before the cut: not in the shot.
    expect(sounds?.filter(([t]) => (t as number) < 0)).toEqual([]);
  });

  it("plays soft: a low tap on each click under a -16 LUFS bed, and nothing else", () => {
    const soft = promoScript.parse({ ...script, sounds: "soft" });
    const quiet = promoProps(soft, {}, { takes: { t1: take } });
    const audio = quiet.audio;
    const loud = promoProps(script, {}, { takes: { t1: take } }).audio;
    expect(quiet.lufs).toBe(-16);
    expect(promoProps(script, {}, { takes: { t1: take } }).lufs).toBe(-14);
    expect(audio.sounds.length).toBe(1);
    expect(audio.sounds[0]?.file).toMatch(/land-light/);
    expect(loud.sounds.length).toBeGreaterThan(audio.sounds.length);
  });

  it("crops the window to part of the page, the camera's points in the crop", () => {
    const crop = { x: 200, y: 100, w: 400, h: 300 };
    const cut = promoScript.parse({
      scenes: [
        { kind: "take", take: "t1", from: 2, camera: [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }], crop },
      ],
    });
    const shot = promoProps(cut, {}, { takes: { t1: take } }).scenes[0]?.shot;
    expect(shot?.pane.crop).toEqual([200, 100, 400, 300]);
    expect(s?.shot?.pane.crop).toEqual([0, 0, ...web.size]);
    const k = shot?.moves[0];
    expect(k?.x).toBeCloseTo((0.5 * web.size[0] - 200) / 400);
    expect(k?.y).toBeCloseTo((0.5 * web.size[1] - 100) / 300);
    const wide = promoScript.parse({
      scenes: [{ kind: "take", take: "t1", crop: { ...crop, w: web.size[0] } }],
    });
    expect(() => promoProps(wide, {}, { takes: { t1: take } })).toThrow(/crop runs past/);
  });

  it("refuses a take not read, a pane it lacks and a cut past the pane's end", () => {
    expect(() => promoProps(script)).toThrow(/take t1 is not read yet/);
    const past = promoScript.parse({ scenes: [{ kind: "take", take: "t1", from: 2, to: 13 }] });
    expect(() => promoProps(past, {}, { takes: { t1: take } })).toThrow(/past the pane's end/);
    const pane = promoScript.parse({ scenes: [{ kind: "take", take: "t1", pane: "x" }] });
    expect(() => promoProps(pane, {}, { takes: { t1: take } })).toThrow(/no pane x/);
  });
});
