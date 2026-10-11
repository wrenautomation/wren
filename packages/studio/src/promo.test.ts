import { describe, expect, it } from "vitest";
import {
  cameraAt,
  countAt,
  entranceAt,
  fitBox,
  framing,
  PROMO_FPS,
  promoProps,
  promoScript,
  scatterAt,
  secondsOf,
  wordsIn,
} from "./promo.js";

const script = promoScript.parse({
  scenes: [
    { kind: "text", lines: ["You got 22 leads.", "Which video sent them?"], accent: ["video"] },
    { kind: "toasts", items: [{ title: "Call booked" }, { title: "New lead", body: "Guide" }] },
    { kind: "screen", image: "shot.png", moves: [{ at: 0.5, x: 0.2, y: 0.3, zoom: 2 }] },
    { kind: "stat", items: [{ value: 30797, label: "Revenue", prefix: "$" }] },
    { kind: "end", title: "Wren", url: "wrenautomation.com", seconds: 2 },
  ],
});

describe("promo script", () => {
  it("lays scenes back to back at their lengths", () => {
    const p = promoProps(script);
    expect(p.width).toBe(1920);
    expect(p.scenes.map((s) => s.from)).toEqual([0, 114, 225, 345, 441]);
    expect(p.durationInFrames).toBe(441 + 2 * PROMO_FPS);
    expect(p.look.accent).toBe("#7969a3");
  });

  it("gives text time by its words, within 2 to 6 seconds", () => {
    const plain = { accent: [] as string[], layout: "stack" as const, enter: "rise" as const };
    expect(secondsOf({ kind: "text", lines: ["Hi"], ...plain })).toBe(2);
    const long = { kind: "text" as const, lines: [Array(30).fill("word").join(" ")], ...plain };
    expect(secondsOf(long)).toBe(6);
  });

  it("refuses a screen with both or neither of image and url", () => {
    expect(() => promoScript.parse({ scenes: [{ kind: "screen" }] })).toThrow();
    expect(() =>
      promoScript.parse({ scenes: [{ kind: "screen", image: "a.png", url: "https://x.co" }] }),
    ).toThrow();
  });

  it("wants a url captured before it lays out", () => {
    const s = promoScript.parse({ scenes: [{ kind: "screen", url: "https://x.co" }] });
    expect(() => promoProps(s)).toThrow(/no image yet/);
  });

  it("carries each screen image's size", () => {
    const p = promoProps(script, { "shot.png": [2880, 1800] });
    expect(p.scenes[2]?.size).toEqual([2880, 1800]);
    expect(p.scenes[0]?.size).toBeUndefined();
  });

  it("takes a tall format and a partial look", () => {
    const p = promoProps(
      promoScript.parse({ format: "tall", look: { accent: "#f00" }, scenes: script.scenes }),
    );
    expect([p.width, p.height]).toEqual([1080, 1920]);
    expect(p.look.accent).toBe("#f00");
    expect(p.look.background).toBe("#f3f1ec");
  });
});

describe("promo clock", () => {
  it("rises by default, and reads a pull-back and a wipe", () => {
    expect(script.scenes[0]).toMatchObject({ layout: "stack", enter: "rise" });
    expect(entranceAt("rise", 0, 90)).toMatchObject({ opacity: 0, clipPath: "none" });
    expect(entranceAt("pull-back", 0, 90).transform).toBe("scale(1.3500)");
    expect(entranceAt("pull-back", 18, 90).transform).toBe("scale(1.0000)");
    expect(entranceAt("wipe", 0, 90)).toMatchObject({
      opacity: 1,
      clipPath: "circle(0.00% at 50% 50%)",
    });
    expect(entranceAt("wipe", 14, 90).clipPath).toBe("circle(72.00% at 50% 50%)");
    expect(entranceAt("wipe", 90, 90).opacity).toBe(0);
  });

  it("carries a flow cut's rush over the cut: one scene's last frame is the next one's first", () => {
    const flowed = promoProps(
      promoScript.parse({
        finish: { dither: true },
        scenes: [
          { kind: "text", lines: ["One"], seconds: 2 },
          { kind: "text", lines: ["Two"], seconds: 2, enter: "flow" },
        ],
      }),
    );
    const [a, b] = flowed.scenes;
    expect([a?.next, b?.next]).toEqual(["flow", undefined]);
    expect(flowed.finish).toEqual({ glow: false, dither: true });
    const last = entranceAt("rise", 59, 60, "flow");
    const first = entranceAt("flow", 0, 60);
    expect(last).toEqual({ ...first, opacity: 1 });
    expect(first).toMatchObject({ transform: "scale(1.6000)", filter: "blur(18.00px)" });
    // Still until the cut is near, no fade: the rush is the exit.
    expect(entranceAt("rise", 40, 60, "flow")).toMatchObject({ opacity: 1, filter: "none" });
    expect(entranceAt("flow", 8, 60)).toMatchObject({ transform: "scale(1.0000)", filter: "none" });
    // A speed ramp: most of the settle in the first few frames.
    const k = (f: number) =>
      Number(/scale\(([\d.]+)\)/.exec(entranceAt("flow", f, 60).transform)?.[1]);
    expect(k(2) - 1).toBeLessThan((k(0) - 1) / 3);
  });

  it("scatters words down the frame in order, never on one spot", () => {
    const at = Array.from({ length: 6 }, (_, i) => scatterAt(i, 6));
    expect(at[0]).toEqual({ x: 0.07, y: 0.14 });
    expect(at.at(-1)?.y).toBe(0.86);
    expect(new Set(at.map((p) => p.x)).size).toBe(6);
    expect(at.every((p) => p.x >= 0.07 && p.x <= 0.67)).toBe(true);
    expect(scatterAt(0, 1)).toEqual({ x: 0.07, y: 0.5 });
  });

  it("shows words one every 4 frames", () => {
    expect(wordsIn(0, 5)).toBe(0);
    expect(wordsIn(2, 5)).toBe(1);
    expect(wordsIn(6, 5)).toBe(2);
    expect(wordsIn(200, 5)).toBe(5);
  });

  it("moves the camera from the whole frame to each mark, eased", () => {
    const moves = [{ at: 0.5, x: 0.2, y: 0.3, zoom: 2 }];
    expect(cameraAt(moves, 0)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(cameraAt(moves, 0.25)).toEqual({ x: 0.35, y: 0.4, zoom: 1.5 });
    expect(cameraAt(moves, 0.9)).toEqual({ x: 0.2, y: 0.3, zoom: 2 });
    expect(cameraAt([], 0.7)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  it("keeps the image covering the frame when zoomed near an edge", () => {
    expect(framing({ x: 0.5, y: 0.5, zoom: 1 }, 1000, 500)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(framing({ x: 0.5, y: 0.5, zoom: 2 }, 1000, 500)).toEqual({
      scale: 2,
      tx: -500,
      ty: -250,
    });
    expect(framing({ x: 0, y: 1, zoom: 2 }, 1000, 500)).toEqual({ scale: 2, tx: 0, ty: -500 });
  });

  it("fits the box to the image's shape", () => {
    expect(fitBox([2880, 1800], 1780, 820)).toEqual({ w: 1312, h: 820 });
    expect(fitBox(undefined, 1780, 820)).toEqual({ w: 1780, h: 820 });
  });

  it("counts up to the number as written", () => {
    const item = { value: 30797, prefix: "$", suffix: "", decimals: 0 };
    expect(countAt(item, 0)).toBe("$0");
    expect(countAt(item, 1)).toBe("$30,797");
    expect(countAt({ value: 6.5, prefix: "", suffix: "%", decimals: 1 }, 2)).toBe("6.5%");
  });
});
