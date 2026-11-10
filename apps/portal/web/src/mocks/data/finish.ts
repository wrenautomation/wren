/**
 * A video to finish: 8 s of synthetic footage (`.storybook/public/finish/recording.mp4`, a box
 * that moves on a flat field, a tone), one cut, one text, a click sound and captions on.
 */
import { captionLines } from "@wren/starling-studio/finish";
import type { Cut } from "@wren/starling-studio/schema";
import type { FinishData, Word } from "../../modules/marketing/finish-data.js";
import type { Mark } from "../../modules/marketing/finish-marks.js";
import type { Presence } from "../../modules/marketing/finish-presence.js";

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

const mark = (m: Partial<Mark> & Pick<Mark, "id" | "start" | "text">): Mark => ({
  end: null,
  box: null,
  format: "long",
  tone: null,
  by: "Sam",
  at: "2026-11-10T15:00:00.000Z",
  done: null,
  ...m,
});

/** The edit pass with no moment yet, and a session agent on a range of the captions. */
export const FINISH_PRESENCE: Presence[] = [
  {
    who: "agent",
    start: null,
    end: null,
    part: "marks",
    doing: "Reads the video and 3 open marks",
    at: "2026-11-10T16:00:00.000Z",
  },
  {
    who: "session-7f3a",
    start: 4.5,
    end: 6,
    part: "captions",
    doing: "Rewrites the line so it fits on a phone",
    at: "2026-11-10T16:00:02.000Z",
  },
];

/** Marks in time order: a part of the picture at 0 s, a range to fix, one to keep, one closed. */
export const FINISH_MARKS: Mark[] = [
  mark({
    id: 1,
    start: 0,
    box: { x: 0.045, y: 0.31, w: 0.225, h: 0.38 },
    text: "Zoom in on this box while the first line plays.",
  }),
  mark({ id: 2, start: 2, end: 3, tone: "bad", text: "The pause before the cut is too long." }),
  mark({
    id: 3,
    start: 5,
    tone: "good",
    text: "Keep the stress on calls. It lands, and the long caption line that follows it reads well on a phone too.",
  }),
  mark({
    id: 4,
    start: 6.5,
    text: "The click sound is too loud.",
    done: {
      at: "2026-11-10T15:20:00.000Z",
      by: "agent",
      why: "Lowered the click sound by 6 dB.",
    },
  }),
];
