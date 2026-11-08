/** Weaver in the chat: one source read on its own. Made-up channel and numbers. */
import type { NextAsk, SourceRead } from "../research/run/card.js";

/** the agent's next asks under a run card */
export const RUN_ASKS: NextAsk[] = [
  {
    ask: "Compare cake order tools on deposits",
    why: "Claim 2 rests on deposits; no tool was read.",
  },
  { ask: "Read the top 3 shops' order pages", why: "Pricing claims come from forums, not shops." },
];

/** one reel read on its own: its findings, no run */
export const REEL_READ: SourceRead = {
  name: "How I price a sourdough loaf",
  by: "Mara Bakes",
  meta: "Reel · 0:48 · read Nov 5",
  cut: 2,
  asks: [
    { ask: "Research the whole channel", why: "One reel; the channel has 40 more on pricing." },
    {
      ask: "Research how small bakeries set prices",
      why: "Her loaf price sits 30% over the town's.",
    },
  ],
  findings: [
    { at: "0:00", text: "The first frame is the cut loaf on a board." },
    { at: "0:03", text: "She says one loaf sells for $9 at the market." },
    { at: "0:11", text: "Flour, salt and starter cost her $1.40 a loaf." },
    { at: "0:19", text: "She counts 22 minutes of her own time for each loaf." },
    { at: "0:27", text: "The stall fee is $60 a day, spread over 70 loaves." },
    { at: "0:36", text: "She raised the price by $1 in spring and sold the same count." },
    { at: "0:44", text: "The caption links a recipe card for sale." },
  ],
};
