/** Fixtures for `card-grid.tsx` and `cards.ts`: a record type with cards and its rows. */
import type { RecordMeta, State, Thumb } from "@wren/core/records";
import { date, defineRecord, metaOf, name, number, prose, status, text } from "@wren/core/records";
import { WORST } from "./worst.js";

export const TWO = {
  a: { label: "A", tone: "neutral" as const },
  b: { label: "B", tone: "neutral" as const },
};
export const SITES = {
  x: { label: "X", tone: "neutral" as const, mark: "x" as const },
  li: { label: "LinkedIn", tone: "neutral" as const, mark: "linkedin" as const },
};
const STATES = {
  draft: { label: "Draft", tone: "neutral" as const },
  waiting: { label: "Waiting", tone: "warn" as const },
  posted: { label: "Posted", tone: "good" as const },
  failed: { label: "Failed", tone: "bad" as const },
};

/** A record type with a platform, two states, words, numbers and dates; the flags add parts. */
export const cardsMeta = (
  o: { site?: boolean; thumbs?: boolean; words?: boolean },
  states: Record<string, State> = TWO,
): RecordMeta =>
  metaOf(
    defineRecord({
      id: "t.cards",
      app: "marketing",
      channel: o.site ? { field: "platform" } : null,
      name: { one: "thing", many: "things" },
      rows: async () => [],
      key: "id",
      title: "who",
      ...(o.words ? { subtitle: "words" } : {}),
      fields: {
        who: name("Who"),
        platform: status(SITES, "Site"),
        kind: status(TWO, "Kind"),
        state: status(states, "State"),
        words: prose("Words"),
        note: text("Note"),
        count: number("Count"),
        city: text("City"),
        at: date("When"),
        seen: date("Seen"),
      },
      views: [{ id: "all", label: "All" }],
      ...(o.thumbs ? { thumbs: async () => ({}) } : {}),
    }),
    false,
  );

/** The type the stories draw: a platform mark, a state badge, a prose body, a picture. */
export const CARDS_META = cardsMeta({ site: true, thumbs: true, words: true }, STATES);

export type CardRow = Record<string, unknown>;

const STILL = (fill: string): Thumb => ({
  url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`)}`,
  kind: "image",
});

/** Pictures by row id: a flat colour each. */
export const CARD_THUMBS: Record<string, Thumb> = {
  c1: STILL("#c9d6e8"),
  c2: STILL("#e8d6c9"),
  c3: STILL("#d6e8c9"),
};

const days = (n: number) => new Date(Date.UTC(2026, 9, 17) - n * 86_400_000).toISOString();

export const CARD_ROWS: CardRow[] = [
  {
    id: "c1",
    who: "Spring launch post",
    platform: "li",
    kind: "a",
    state: "posted",
    words: "We shipped the spring release today. Here is what changed and why it matters.",
    note: "Pinned",
    count: 1240,
    city: "Austin",
    at: days(2),
    seen: days(1),
  },
  {
    id: "c2",
    who: "Pricing thread",
    platform: "x",
    kind: "b",
    state: "waiting",
    words: "Three things we learned from pricing the plans.",
    note: "",
    count: 88,
    city: "Berlin",
    at: days(5),
    seen: days(3),
  },
  {
    id: "c3",
    who: "Customer story",
    platform: "li",
    kind: "a",
    state: "draft",
    words: "",
    note: "Needs a quote",
    count: 0,
    city: "",
    at: days(9),
    seen: days(9),
  },
  {
    id: "c4",
    who: "Webinar recap",
    platform: "x",
    kind: "b",
    state: "failed",
    words: "The recording is up. Slides are linked below.",
    note: "Token expired",
    count: 12,
    city: "Lagos",
    at: days(12),
    seen: days(12),
  },
];

/** One row of the worst values: long title, long words, huge numbers, mixed scripts. */
export const WORST_CARD_ROWS: CardRow[] = [
  {
    id: "w1",
    who: WORST.longName,
    platform: "li",
    kind: "a",
    state: "failed",
    words: WORST.longText,
    note: WORST.longLabel,
    count: WORST.hugeCount,
    city: WORST.longCompany,
    at: days(400),
    seen: days(0),
  },
  {
    id: "w2",
    who: WORST.url,
    platform: "x",
    kind: "b",
    state: "waiting",
    words: WORST.nonLatin,
    note: WORST.email,
    count: WORST.negative,
    city: WORST.rtl,
    at: days(1),
    seen: days(1),
  },
  {
    id: "w3",
    who: WORST.emoji,
    platform: "x",
    kind: "a",
    state: "draft",
    words: WORST.emoji,
    note: "",
    count: WORST.zero,
    city: WORST.shortName,
    at: days(0),
    seen: days(0),
  },
  { id: "w4", who: WORST.empty, platform: "li", kind: "a", state: "draft" },
];
