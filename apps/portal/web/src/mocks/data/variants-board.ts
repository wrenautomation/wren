/** A subject's board (vireo board design): a frame of picks, links, a picture, a sample, a note. Synthetic. */
import type { BoardView, PinView } from "../../modules/variants/board.js";
import type { Answers } from "../api.js";

/** a 4:5 picture drawn inline: no network in a story */
const shot = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><circle cx="200" cy="210" r="70" fill="#fff" fill-opacity=".35"/></svg>`,
  )}`;

const pin = (p: Partial<PinView> & Pick<PinView, "id" | "kind" | "x" | "y">): PinView => ({
  subjectId: 3,
  url: null,
  file: null,
  fileUrl: null,
  posterUrl: null,
  title: null,
  body: null,
  why: null,
  sampleId: null,
  frameId: null,
  w: null,
  h: null,
  z: p.id,
  by: "person@example.com",
  keptAt: null,
  canon: null,
  at: { x: p.x, y: p.y },
  ...p,
});

const PINS: PinView[] = [
  pin({ id: 1, kind: "frame", x: 0, y: 0, w: 560, h: 380, z: 0, title: "Openers that hold" }),
  pin({
    id: 2,
    kind: "link",
    frameId: 1,
    x: 24,
    y: 60,
    w: 240,
    h: 280,
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    title: "Night sky timelapse over a desert ridge, one take",
    posterUrl: shot("#2b3a67", "#e0a458"),
    why: "The slow push-in holds the first three seconds.",
  }),
  pin({
    id: 3,
    kind: "link",
    frameId: 1,
    x: 292,
    y: 60,
    w: 240,
    h: 280,
    url: "https://www.instagram.com/reel/AbCdEf123/",
    title: "Hand-drawn star map, sped up",
    posterUrl: shot("#6d5bd0", "#f2b366"),
    canon: "ref-example-star-map",
  }),
  pin({
    id: 4,
    kind: "image",
    x: 600,
    y: 20,
    w: 220,
    h: 260,
    file: "s3://bucket/media/a.png",
    fileUrl: shot("#d0475b", "#f2b366"),
    title: "palette-study.png",
    keptAt: "2026-11-16T10:00:00Z",
    canon: "add:41",
  }),
  pin({
    id: 5,
    kind: "sample",
    x: 600,
    y: 310,
    w: 220,
    h: 260,
    sampleId: 14,
    sample: {
      id: 14,
      batchId: 2,
      name: "Star system, slow orbit",
      mediaUrl: null,
      posterUrl: shot("#0f766e", "#a7f3d0"),
    },
  }),
  pin({
    id: 6,
    kind: "link",
    x: 860,
    y: 20,
    w: 240,
    h: 280,
    url: "https://example.com/a-very-long-article-address/on/space-backgrounds-for-hero-sections",
    title:
      "Space backgrounds for hero sections: what reads at 390 wide and what turns to mud on a phone",
  }),
  pin({
    id: 7,
    kind: "note",
    x: 860,
    y: 330,
    w: 240,
    h: 160,
    body: "Try the ridge opener with the orbit sample's colors.",
  }),
];

export const BOARD: BoardView = {
  subject: { id: 3, slug: "hero-background", name: "Hero background" },
  pins: PINS,
};

export const BOARD_ANSWERS: Answers = {
  "variants/board": BOARD,
  "variants/pin": (b: Record<string, unknown>) =>
    ((b.pins as Partial<PinView>[]) ?? []).map((p, i) =>
      pin({ id: 100 + i, kind: p.kind ?? "link", x: 0, y: 0, ...p }),
    ),
  "variants/pinMove": [],
  "variants/pinEdit": (b: Record<string, unknown>) => ({ ...PINS[1], ...b }),
  "variants/unpin": [],
  "variants/pinKeep": (b: Record<string, unknown>) => ({
    ...PINS.find((p) => p.id === b.id),
    keptAt: b.on === false ? null : "2026-11-16T12:00:00Z",
  }),
};
