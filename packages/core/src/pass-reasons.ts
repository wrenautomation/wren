/**
 * Why he passed on a person, not on the words: they leave every reply queue and aren't proposed
 * again (`reach_passes`). "Not now" rests them; the rest are for good until lifted. Plain data:
 * the portal reads it.
 */
export const PASS_REASONS = [
  "not_lead",
  "not_worth",
  "spam",
  "competitor",
  "rude",
  "not_now",
] as const;
export type PassReason = (typeof PASS_REASONS)[number];

export const PASS_LABELS: Readonly<Record<PassReason, string>> = {
  not_lead: "Not a lead",
  not_worth: "Not worth a reply",
  spam: "Spam or a bot",
  competitor: "Competitor",
  rude: "Rude",
  not_now: "Not now (30 days)",
};

/** Days a pass rests them; none is for good. */
export const PASS_DAYS: Readonly<Partial<Record<PassReason, number>>> = { not_now: 30 };
