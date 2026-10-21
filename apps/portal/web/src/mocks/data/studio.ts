/**
 * Studio's fakes: the drafts that wait (ContentDesk.waiting) and a shape with two offer lines.
 * Synthetic data only: invented lines and words, no client, no amounts.
 */
import type { ShapeBody } from "@wren/pipeline/model";
import type { Answers } from "../api.js";
import { metroFor, SHAPE_GRAPH } from "./journeys.js";
import { shapeAnswers } from "./map.js";

const HOUR = 3_600_000;
const iso = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const draft = (
  id: string,
  platform: string,
  text: string,
  hoursAgo: number,
  slotIn: number | null,
  more: Record<string, unknown> = {},
) => ({
  id,
  platform,
  text,
  title: null,
  state: "draft",
  error: null,
  edited: false,
  own: true,
  at: iso(-hoursAgo),
  slot: slotIn === null ? null : iso(slotIn),
  ...more,
});

/** Five ideas: a post past its slot, a thread, a carousel, a story and a post with no line. */
export const STUDIO_WAITING = {
  ideas: [
    {
      ideaId: "i1",
      idea: "Most service sites list seven things they do. The ones that book calls list one.",
      line: "signed",
      drafts: [
        draft(
          "d1",
          "linkedin",
          "Most service sites list seven things they do.\n\nThe ones that book calls list one.\n\nLast month I rebuilt an offer page down to a single line: who it is for, what changes in 30 days, the price. Three fewer sections.",
          26,
          -3,
        ),
        draft(
          "d2",
          "x",
          "Most service sites list seven things they do.\n\nThe ones that book calls list one.",
          26,
          -3,
        ),
      ],
    },
    {
      ideaId: "i2",
      idea: "Why a one-line offer page beats a seven-section one",
      line: "signed",
      drafts: [
        draft(
          "d3",
          "x",
          "1/ A one-line offer page books more calls than a seven-section one.\n---\n2/ Seven sections give a buyer seven places to stop.\n---\n3/ One line gives one: the reply button.",
          5,
          4,
          { thread: true },
        ),
      ],
    },
    {
      ideaId: "i3",
      idea: "Three steps to win back a quiet customer list",
      line: "react",
      drafts: [
        draft("d4", "instagram", "Three steps to win back a quiet customer list. Swipe.", 9, 22, {
          carousel: true,
        }),
        draft("d5", "linkedin", "Three steps to win back a quiet customer list.", 9, 23, {
          carousel: true,
        }),
      ],
    },
    {
      ideaId: "i4",
      idea: "Behind the scenes: rebuilding the offer page",
      line: "signed",
      drafts: [
        draft("d6", "instagram", "", 2, null, { story: true }),
        draft("d7", "facebook", "", 2, null, { story: true }),
      ],
    },
    {
      ideaId: "i5",
      idea: "What we changed after the first reply-rate test",
      drafts: [
        draft(
          "d8",
          "x",
          "We changed one thing after the first reply-rate test: the first line. Replies doubled.",
          30,
          46,
        ),
      ],
    },
  ],
};

/** The sample shape with two offer lines: Offer builder (the `signed` node) and Reactivation. */
export const STUDIO_GRAPH: ShapeBody = {
  ...SHAPE_GRAPH,
  nodes: [
    ...SHAPE_GRAPH.nodes.map((n) => (n.id === "signed" ? { ...n, name: "Offer builder" } : n)),
    { id: "react", kind: "offer", name: "Reactivation", offer: "reactivation", advance: [] },
  ],
  edges: [
    ...SHAPE_GRAPH.edges,
    { id: "booked_to_react", from: "booked", to: "react", kind: "flow" },
  ],
};

type Reply = (body: Record<string, unknown>) => unknown;

/** The answers a Studio story adds: the shape with the two lines in front of the shared ones. */
export const studioAnswers = (fallback: { get: Reply; list: Reply }): Answers =>
  shapeAnswers(fallback, metroFor(STUDIO_GRAPH));
