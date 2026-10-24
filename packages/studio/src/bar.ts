/**
 * The edit bar (designs/2026-10-24-video-film-file.md, Decision 3): one list the edit pass works
 * to and the self-check judges a render by. Each rule has an id the check's answer names.
 */
export type BarFormat = "long" | "short";
/** The self-check's `runs` command (`video-check.ts`); here so the worker can read it. */
export const VIDEO_CHECK = "video check";

export interface BarRule {
  id: string;
  says: string;
  /** Only these formats; unset: every one. */
  only?: BarFormat;
}

export const BAR: readonly BarRule[] = [
  {
    id: "cuts",
    says: "Cuts fall in pauses. No clip starts on a clipped word or stops mid-thought.",
  },
  {
    id: "open",
    says: "It opens on its strongest real line, ends on its point and stands alone.",
    only: "short",
  },
  {
    id: "face",
    says: "The face is sharp and well framed: eye line near 40% from the top, the head not cut.",
  },
  {
    id: "text",
    says: "Text on screen reads at phone size. Nothing that matters sits under the platform's buttons or caption.",
  },
  {
    id: "private",
    says: "Nothing private in any frame: keys, tokens, emails, names, customer data, notifications, other tabs.",
  },
  {
    id: "captions",
    says: "Captions use one plain font, 2 to 3 words at a time, with no over-animation.",
  },
  { id: "plain", says: "No emoji or icons. A pop-up is a real screenshot and holds still." },
  { id: "hook", says: "No sentence wanders off the hook's point." },
  {
    id: "pace",
    says: "The picture changes at least every 10 s: a cut, a crop change or an overlay.",
    only: "short",
  },
  {
    id: "best",
    says: "It holds up next to the best clips on the platform. A clip you would scroll past is not done.",
  },
];

export const BAR_IDS = BAR.map((r) => r.id);

/** The bar as prompt lines, `- id: says`, for one format or all of them. */
export const barLines = (format?: BarFormat): string =>
  BAR.filter((r) => !format || !r.only || r.only === format)
    .map((r) => `- ${r.id}${r.only && !format ? ` (${r.only} only)` : ""}: ${r.says}`)
    .join("\n");
