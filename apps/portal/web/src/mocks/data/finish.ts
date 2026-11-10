/**
 * A video to finish: 8 s of synthetic footage (`.storybook/public/finish/recording.mp4`, a box
 * that moves on a flat field, a tone), one cut, one text, a click sound and captions on.
 */
import { captionLines } from "@wren/starling-studio/finish";
import type { Cut } from "@wren/starling-studio/schema";
import type { FinishData, Word } from "../../modules/marketing/finish-data.js";

const SAID = "One line on the page books more calls than seven sections ever did for us here";
const DURATION_S = 8;
const STEP_S = 0.5;

export const FINISH_WORDS: Word[] = SAID.split(" ").map((w, i) => ({
  w,
  s: i * STEP_S,
  e: i * STEP_S + 0.4,
  ...(w === "calls" ? { stress: true } : {}),
}));
const CUTS: Cut[] = [{ from: 3, to: 4.5, why: "silence", state: "cut" }];

export const FINISH: FinishData = {
  fps: 30,
  durationS: DURATION_S,
  size: [640, 360],
  camSize: null,
  source: "/finish/recording.mp4",
  sourceCam: null,
  strip: null,
  bed: null,
  sounds: [{ at: 1, id: "click" }],
  music: null,
  picture: { source: "main", centre: { x: 0.5, y: 0.5 } },
  layout: [],
  lines: captionLines(FINISH_WORDS, CUTS, DURATION_S),
  rendered: [],
  shorts: [],
  camBox: null,
  face: false,
  stale: null,
  covers: {},
  saved: {
    cuts: CUTS,
    overlays: [{ text: "One line", from: 0.5, to: 2.5, x: 0.5, y: 0.2, size: "m" }],
    crops: {},
    captions: { style: "word", long: "screen", short: "screen" },
    thumbnail: null,
    formats: ["long", "vertical"],
  },
};

/** A recording that fails to load, as a link that ran out does (no request: no console error). */
export const FINISH_NO_FILE: FinishData = { ...FINISH, source: "data:video/mp4;base64,AAAA" };
