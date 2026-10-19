/**
 * Wren's marketing, for Today and Marketing: pieces and their branches, and the week's cadence.
 * Synthetic data only.
 */
import type { Piece } from "@wren/content/pieces";
import type { Goal } from "../../modules/marketing/plan.js";
import { ago } from "./shell.js";

const branch = (
  id: string,
  platform: string,
  format: string,
  state: Piece["branches"][number]["state"],
  days: number | null,
) => ({
  id,
  platform,
  format,
  state,
  at: days === null ? null : ago(days),
  url: null,
  views: state === "live" ? 1200 - id.length * 40 : null,
  engaged: state === "live" ? 34 : null,
  error: state === "failed" ? "The platform refused the post." : null,
});

export const PIECES: Piece[] = [
  {
    id: "idea-1",
    kind: "long",
    title: "Why old customers are your cheapest leads",
    text: "A walk through one reactivation run, start to finish.",
    at: ago(0.3),
    branches: [branch("d1", "youtube", "long", "review", null)],
    children: [
      {
        id: "idea-1a",
        kind: "vertical",
        title: "The one text that books a call",
        text: "Clip from the long video.",
        at: ago(0.3),
        branches: [
          branch("d2", "tiktok", "short", "draft", null),
          branch("d3", "instagram", "reel", "live", 1),
        ],
        children: [],
      },
    ],
  },
  {
    id: "idea-2",
    kind: "written",
    title: "Three follow-ups that don't feel pushy",
    text: "Short post for LinkedIn and X.",
    at: ago(2),
    branches: [
      branch("d4", "linkedin", "post", "live", 2),
      branch("d5", "x", "post", "failed", null),
    ],
    children: [],
  },
];

const goal = (
  id: string,
  platform: string,
  label: string,
  piece: string,
  pieceName: string,
  done: number,
): Goal => ({
  id,
  platform,
  label,
  name: label,
  goal: 3,
  upTo: null,
  pace: "3 a week",
  how: "Post",
  piece,
  pieceName,
  starts: piece === "long" || piece === "vertical" ? "video" : "words",
  daily: null,
  done,
  today: 0,
  queued: 1,
  write: 1,
});

export const CADENCE: Goal[] = [
  goal("g1", "youtube", "YouTube", "long", "Long video", 1),
  goal("g2", "tiktok", "TikTok", "vertical", "Short video", 2),
  goal("g3", "linkedin", "LinkedIn", "written", "Written post", 3),
];

/** Studio's "waiting" read (ContentDesk): no idea has a draft waiting. */
export const STUDIO_WAITING = { ideas: [] };

/** Auto-reply's modes: Wren's own (InboxDesk through the console) and a client's alike. */
export const AUTO_REPLY = {
  modes: { text: "suggest", email: "suggest", dm: "off", comment: "auto" },
  held: false,
};
