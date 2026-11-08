/**
 * Synthetic research runs for the chat cards and the graph: a standard run, a run on one channel,
 * one source read on its own, a live run and a worst case. No real site, person or number.
 */
import type { IconName } from "../icons.js";
import type { SourceRead } from "../research/cards.js";
import type { Finding, ResearchRun, ResearchSource } from "../research/model.js";
import { WORST } from "./worst.js";

const SHOP = [
  "An owner checks online orders on a tablet beside the oven.",
  "A baker prints each order because the screen times out.",
  "An owner answers order questions by text message after closing.",
  "A shop takes custom cake orders by phone only.",
  "A baker closes online orders at 4 pm for the next day.",
  "An owner asks for a deposit on orders over 12 boxes.",
  "A shop lists six products online out of forty.",
  "A baker says photos sell more than product text.",
  "An owner pays a nephew to keep the menu page current.",
  "A shop gets most online orders on Thursday and Friday.",
  "A baker stopped holiday pre-orders after a missed batch.",
  "An owner wants one screen for the counter and the web.",
];

const CLIP = [
  "The video shows the oven at full load.",
  "The caption names the flour by weight.",
  "The voice-over gives the bake time once.",
  "The last shot is the loaf cut in half.",
  "The video has no music under the voice.",
  "The first comment asks where the shop is.",
  "The video runs under one minute.",
  "The cover frame is the loaf on a board.",
];

/** A source: its findings in a claim, then `more` findings in none. */
function source(
  id: string,
  name: string,
  kind: string,
  icon: IconName,
  used: readonly [claim: number, text: string][],
  more: number,
  pool: readonly string[] = SHOP,
  cut = 1,
): ResearchSource {
  const at = id.length + name.length;
  const rest: Finding[] = Array.from({ length: more }, (_, i) => ({
    text:
      i < pool.length
        ? (pool[(at + i) % pool.length] as string)
        : `${pool[(at + i) % pool.length]} (${i + 1})`,
  }));
  return {
    id,
    name,
    kind,
    icon,
    cut,
    findings: [...used.map(([claim, text]) => ({ claim, text })), ...rest],
  };
}

const ORDER_SOURCES: ResearchSource[] = [
  source(
    "f1",
    "The Proof Room",
    "Forums",
    "chat",
    [
      [1, "An owner sold 14 loaves online that the counter had sold an hour before."],
      [1, "A baker turned the order page off on Saturdays after three oversold mornings."],
      [2, "An owner pays 27% of each marketplace order in fees."],
      [2, "A baker raised marketplace prices by 20% to cover the fee."],
      [3, "An owner wants customers to pick a 15-minute pickup slot."],
    ],
    28,
    SHOP,
    6,
  ),
  source(
    "f2",
    "Bakers' Bench",
    "Forums",
    "chat",
    [
      [1, "A two-shop owner counts stock by hand at noon so the order page stays right."],
      [4, "An owner moved to an own order page last spring and still uses it."],
    ],
    6,
  ),
  source(
    "f3",
    "Crumb Talk",
    "Forums",
    "chat",
    [[2, "A baker left a marketplace when its fees passed the margin on a box of six."]],
    9,
    SHOP,
    3,
  ),
  source(
    "f4",
    "Small Shop Owners",
    "Forums",
    "chat",
    [
      [3, "A cafe owner says the tool sold delivery and hid pickup behind a setting."],
      [3, "A baker tracks pickup times on paper beside the till."],
    ],
    5,
  ),
  source("f5", "Oven Floor", "Forums", "chat", [], 4),
  source(
    "f6",
    "Counter Service",
    "Forums",
    "chat",
    [
      [4, "A baker says repeat customers now order direct."],
      [4, "Two owners report that direct orders passed marketplace orders in four months."],
    ],
    3,
  ),
  source(
    "f7",
    "Flour and Till",
    "Forums",
    "chat",
    [[1, "An owner says the till and the order page each hold their own stock count."]],
    2,
  ),
  source("f8", "Morning Batch", "Forums", "chat", [], 2, SHOP, 0),
  source("f9", "Side Street Retail", "Forums", "chat", [], 1, SHOP, 2),
  source(
    "v1",
    "tillbright.example",
    "Vendors",
    "globe",
    [[2, "A vendor page lists marketplace fees from 15% to 30%."]],
    3,
  ),
  source(
    "v2",
    "ordernook.example",
    "Vendors",
    "globe",
    [[3, "A plan page lists delivery in each plan and pickup slots in the top plan only."]],
    5,
    SHOP,
    4,
  ),
  source("v3", "slotwise.example", "Vendors", "globe", [], 3),
  source(
    "t1",
    "Bakehouse Weekly",
    "Trade press",
    "news",
    [[2, "A survey of 212 bakeries puts the median marketplace fee at 22%."]],
    6,
  ),
  source("t2", "Shopfront Review", "Trade press", "news", [], 4, SHOP, 2),
  source(
    "t3",
    "The Retail Ledger",
    "Trade press",
    "news",
    [[4, "A trade report says 8 of 10 shops that moved to an own page kept it after a year."]],
    7,
  ),
  source(
    "y1",
    "Two Ovens",
    "Video",
    "video",
    [[1, "A baker shows a refund run after the order page sold out stock twice."]],
    5,
    SHOP,
    2,
  ),
  source("y2", "Mara Bakes", "Video", "video", [], 4),
  source("o1", "Recipe Swap", "Other", "globe", [], 0, SHOP, 3),
];

/** A standard run: 4 claims over 5 kinds of source. */
export const ORDER_RUN: ResearchRun = {
  id: "r-52",
  name: "Bakeries: what online ordering costs them",
  meta: "Nov 5 · $0.14",
  searches: 6,
  hits: 74,
  pages: 29,
  claims: [
    { n: 1, text: "Owners lose orders when the order page and the till hold stock apart" },
    { n: 2, text: "Marketplace fees take 15% to 30% of an order" },
    { n: 3, text: "Owners want pickup slots, and most tools sell delivery first" },
    { n: 4, text: "Owners who moved to their own order page kept it" },
  ],
  sources: ORDER_SOURCES,
  href: "#research/r-52",
  asks: [
    {
      ask: "Compare order page tools on pickup slots",
      why: "Claim 3 names the gap; no source priced the tools.",
    },
    {
      ask: "Find what bakeries pay per order on their own page",
      why: "Fees hold only for marketplaces (claim 2).",
    },
  ],
};

/** The same run part way: pages still come in, no review yet. */
export const LIVE_RUN: ResearchRun = {
  ...ORDER_RUN,
  id: "r-53",
  meta: "Nov 5 · $0.05 so far",
  hits: 74,
  pages: 11,
  live: true,
  claims: [],
  asks: undefined,
  sources: ORDER_SOURCES.slice(0, 8).map((s) => ({
    ...s,
    cut: 0,
    findings: s.findings.slice(0, 9).map((f) => ({ text: f.text })),
  })),
  href: undefined,
};

/** A run on one channel, started from one of its reels. */
export const CHANNEL_RUN: ResearchRun = {
  id: "r-54",
  name: "Mara Bakes: what the channel does",
  meta: "Nov 5 · $0.09",
  searches: 2,
  hits: 31,
  pages: 14,
  claims: [
    { n: 1, text: "Each video shows the finished loaf in the first two seconds" },
    { n: 2, text: "One number carries each video: a price, a time or a weight" },
    { n: 3, text: "Viewers ask for the recipe card, and the channel sells it" },
  ],
  sources: [
    source(
      "c1",
      "How I price a sourdough loaf",
      "This channel",
      "video",
      [
        [1, "The first frame is the cut loaf on a board."],
        [2, "The price of one loaf stays on screen for the whole video."],
        [3, "The caption links a recipe card for sale."],
      ],
      4,
      CLIP,
    ),
    source(
      "c2",
      "A 4 am bake, start to finish",
      "This channel",
      "video",
      [
        [1, "The video opens on six baked loaves, then cuts to 4 am."],
        [2, "A clock shows 4:00 in the first shot."],
      ],
      5,
      CLIP,
    ),
    source(
      "c3",
      "What a market stall earns",
      "This channel",
      "video",
      [
        [2, "The day's takings show as one number at the end."],
        [3, "The caption says the stall plan is in the recipe card."],
      ],
      6,
      CLIP,
    ),
    source(
      "c4",
      "Six loaves, one oven",
      "This channel",
      "video",
      [[1, "The six finished loaves show before the first word."]],
      3,
      CLIP,
    ),
    source("c5", "Why my crust cracks", "This channel", "video", [], 4, CLIP),
    source(
      "c6",
      "Scoring patterns that sell",
      "This channel",
      "video",
      [[1, "Each pattern shows baked first, then the cut."]],
      2,
      CLIP,
    ),
    source("c7", "My starter at day 400", "This channel", "video", [], 2, CLIP),
    source(
      "c8",
      "Bagels for 40 people",
      "This channel",
      "video",
      [[2, "The count of 40 is the first word of the caption."]],
      3,
      CLIP,
    ),
    source("c9", "The mistake in my first shop", "This channel", "video", [], 1, CLIP, 0),
    source(
      "m1",
      "Comments: How I price a sourdough loaf",
      "Comments",
      "chat",
      [
        [3, "Eleven comments ask for the recipe."],
        [3, "The channel answers each one with the card's link."],
      ],
      3,
      CLIP,
    ),
    source(
      "m2",
      "Comments: What a market stall earns",
      "Comments",
      "chat",
      [[3, "Four comments ask what the card costs."]],
      2,
      CLIP,
    ),
    source("k1", "Two Ovens", "Channels like it", "video", [], 4, CLIP),
    source("k2", "Rye Diary", "Channels like it", "video", [], 3, CLIP),
    source("k3", "Night Shift Bakes", "Channels like it", "video", [], 0, CLIP, 2),
  ],
  href: "#research/r-54",
};

/** One reel read on its own: its findings, no run. */
export const REEL_READ: SourceRead = {
  by: "Mara Bakes",
  meta: "Reel · 0:48 · read Nov 5",
  asks: [
    { ask: "Research the whole channel", why: "One reel; the channel has 40 more on pricing." },
    {
      ask: "Research how small bakeries set prices",
      why: "Her loaf price sits 30% over the town's.",
    },
  ],
  source: {
    id: "reel",
    name: "How I price a sourdough loaf",
    kind: "Video",
    icon: "video",
    cut: 2,
    findings: [
      { at: "0:00", text: "The first frame is the cut loaf on a board." },
      { at: "0:03", text: "She says one loaf sells for $9 at the market." },
      { at: "0:11", text: "Flour, salt and starter cost her $1.40 a loaf." },
      { at: "0:19", text: "She counts 22 minutes of her own time for each loaf." },
      { at: "0:27", text: "The stall fee is $60 a day, spread over 70 loaves." },
      { at: "0:36", text: "She raised the price by $1 in spring and sold the same count." },
      { at: "0:44", text: "The caption links a recipe card for sale." },
    ],
  },
};

/** Many sources, long names, long claims. */
export const WORST_RUN: ResearchRun = {
  id: "r-99",
  name: WORST.longLabel,
  meta: "Nov 5 · $1.92",
  searches: 48,
  hits: 1_116,
  pages: 412,
  claims: Array.from({ length: 9 }, (_, i) => ({
    n: i + 1,
    text: i % 2 ? WORST.longLabel : `${WORST.longCompany} reports the same cost twice`,
  })),
  sources: Array.from({ length: 60 }, (_, i) =>
    source(
      `w${i}`,
      i % 7 === 0 ? WORST.url : i % 5 === 0 ? WORST.longCompany : `Source ${i + 1}`,
      ["Forums", "Vendors", "Trade press", "Video", "A kind of source with a long name"][
        i % 5
      ] as string,
      "globe",
      i % 3 === 0
        ? [[(i % 9) + 1, `Finding ${i + 1}: ${WORST.longLabel}.`]]
        : i % 4 === 0
          ? [
              [(i % 9) + 1, `Finding ${i + 1}: an owner reports the cost.`],
              [((i + 4) % 9) + 1, `Finding ${i + 1}: a second owner reports it too.`],
            ]
          : [],
      i === 0 ? 240 : (i * 7) % 23,
    ),
  ),
  href: "#research/r-99",
};
